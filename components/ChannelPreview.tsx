"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type Hls from "hls.js"; // type only — the library is imported lazily below
import { LogoImage } from "@/components/LogoImage";
import type { Channel } from "@/lib/types";

/** 16:9 at a size that reads from the couch without crowding the grid.
 *  Fixed pixels on purpose for the TV: `aspect-ratio` is Chrome 88+, and the TV
 *  is Chromium 63 — it would drop the declaration and collapse the box. The web
 *  variant below is free to use modern CSS. */
const W = 448;
const H = 252;

/** Web/mobile: don't let a resize shrink the tile past useful, and remember the
 *  label strip's height so the clamp keeps the WHOLE tile on screen, not just
 *  the video. */
const MIN_W = 220;
const FOOTER_H = 34;
/** Where a dragged/resized position is remembered. The component remounts on
 *  every channel change, so without this the tile would jump home each swap. */
const BOX_KEY = "tvspot_preview_box_v1";

function readBox(): { x: number; y: number; w: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BOX_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    return typeof b?.x === "number" && typeof b?.y === "number" && typeof b?.w === "number"
      ? b
      : null;
  } catch {
    return null;
  }
}

function writeBox(b: { x: number; y: number; w: number }) {
  try {
    localStorage.setItem(BOX_KEY, JSON.stringify(b));
  } catch {}
}

/** How many sources the preview will try before giving up.
 *
 *  Deliberately short. The full player probes up to 24 and picks the best; this
 *  is a glance, not a viewing session, and every extra attempt is another
 *  connection to a panel that the real player may want a slot on. If none of the
 *  first few work the preview says so and tuning in properly will do the full
 *  probe + failover. */
const MAX_SOURCES = 4;

function sourcesFor(channel: Channel): string[] {
  const merged = [
    ...(channel.verified_sources || []),
    channel.primary_url,
    ...(channel.backup_urls || []),
  ].filter((u): u is string => Boolean(u));
  return Array.from(new Set(merged)).slice(0, MAX_SOURCES);
}

/**
 * Small muted preview of a channel, pinned to the top-right of the guide.
 *
 * Interaction (driven by TvEpgGrid): the first Enter on a channel opens this;
 * a second Enter on the SAME channel tunes to it full-screen. Moving to another
 * channel and pressing swaps the preview rather than opening anything, so you
 * can walk the guide and see what's actually on before committing.
 *
 * Built for the 2019 Samsung (Tizen 5.0 / Chromium 63, ~368MB JS heap, and the
 * guide already carries ~3000 DOM nodes):
 *   - `capLevelToPlayerSize` so hls.js decodes a variant sized for a 448px box
 *     rather than the 1080p rendition the full player would pick;
 *   - a small forward buffer and no back buffer — a preview never needs to ride
 *     out an outage, and held media is the expensive part on this device;
 *   - the Hls instance is destroyed on every channel change and on unmount, so
 *     walking the guide can never leave a stack of live streams behind.
 *
 * Muted always. Autoplay with sound is blocked on most engines anyway, and a
 * guide that starts blaring while you browse is its own bug report.
 */
export default function ChannelPreview({
  channel,
  variant = "tv",
  onClose,
  watchHref,
}: {
  channel: Channel;
  /** "tv" = fixed 448px box for the 10-foot UI on Chromium 63.
   *  "web" = fluid box that fits a phone, sat below the app's top bar, with a
   *  close button (there's no Back key on web). */
  variant?: "tv" | "web";
  onClose?: () => void;
  /** Route to the full-screen channel. The "watch" label is a real link to it,
   *  so the second press isn't the only way in — you can go straight from the
   *  preview. A Link (not a button) so middle-click / cmd-click still open a new
   *  tab on web, and so the D-pad can focus it on the TV via data-tv. */
  watchHref?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  const urls = sourcesFor(channel);
  const src = urls[idx];

  // NOTE: this component is mounted with key={channel.name} (see TvEpgGrid), so
  // switching channels REMOUNTS it. That's deliberate — it resets the source
  // walk and runs the teardown below without a reset effect, and guarantees the
  // previous channel's Hls instance is destroyed before the next one attaches.

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let cancelled = false;
    let hls: Hls | null = null;

    /** Move to the next candidate, or report the preview as unavailable. */
    const nextSource = () => {
      if (cancelled) return;
      setIdx((i) => {
        if (i + 1 < urls.length) return i + 1;
        setFailed(true);
        return i;
      });
    };

    const supportsMSE =
      typeof window !== "undefined" &&
      ("MediaSource" in window || "ManagedMediaSource" in window);

    if (supportsMSE) {
      void (async () => {
        const HlsCtor = (await import("hls.js")).default;
        if (cancelled) return;
        if (!HlsCtor.isSupported()) {
          video.src = src;
          void video.play().catch(() => {});
          return;
        }
        hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          // Preview-sized buffers. The full player keeps ~60s to ride out relay
          // hiccups; here that would just be megabytes held for a glance.
          maxBufferLength: 10,
          maxMaxBufferLength: 15,
          backBufferLength: 0,
          // Same hole tolerance as the main player — the relay's remuxed TS has
          // sub-second gaps and PTS discontinuities that stall at the default.
          maxBufferHole: 1.5,
          // Decode a rendition sized for a 448px box, not 1080p.
          capLevelToPlayerSize: true,
        });
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (data.fatal) nextSource();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        void video.play().catch(() => {});
      })();
    } else {
      // iOS/Safari play HLS natively.
      video.src = src;
      void video.play().catch(() => {});
    }

    return () => {
      cancelled = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      // Detach so the element releases its buffers immediately rather than at
      // the next GC — this runs on every channel change while browsing.
      video.removeAttribute("src");
      try {
        video.load();
      } catch {}
    };
  }, [src, channel.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const web = variant === "web";

  // ── drag / resize (web + mobile) ───────────────────────────────────────────
  // `box` is null until the user actually moves or resizes it, so the default
  // docked position stays pure CSS (and stays responsive). Once set it pins the
  // tile explicitly. Persisted, because the component REMOUNTS on every channel
  // change (key={channel.name}) — without this, dragging it somewhere and then
  // previewing another channel would snap it back.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number } | null>(() => readBox());

  /** Keep the tile on screen — after a drag, a resize, or a viewport change. */
  const clamp = (b: { x: number; y: number; w: number }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.max(MIN_W, Math.min(b.w, vw - 8));
    const h = w * (9 / 16) + FOOTER_H; // video is 16:9, plus the label strip
    return {
      w,
      x: Math.max(4, Math.min(b.x, vw - w - 4)),
      y: Math.max(4, Math.min(b.y, vh - h - 4)),
    };
  };

  /** Current on-screen rect, so the first drag starts exactly where it sits. */
  const currentBox = () => {
    if (box) return box;
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width } : { x: 16, y: 64, w: 352 };
  };

  const startDrag = (e: React.PointerEvent) => {
    // Let the watch link / close button do their own thing.
    if ((e.target as HTMLElement).closest("a,button")) return;
    e.preventDefault();
    const start = currentBox();
    const ox = e.clientX - start.x;
    const oy = e.clientY - start.y;
    const move = (ev: PointerEvent) =>
      setBox(clamp({ x: ev.clientX - ox, y: ev.clientY - oy, w: start.w }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox((b) => { if (b) writeBox(b); return b; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = currentBox();
    const sx = e.clientX;
    const move = (ev: PointerEvent) =>
      setBox(clamp({ x: start.x, y: start.y, w: start.w + (ev.clientX - sx) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox((b) => { if (b) writeBox(b); return b; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // A stored position from a bigger window (or a rotated phone) can put the tile
  // off-screen; re-clamp whenever the viewport changes.
  useEffect(() => {
    if (!web) return;
    const onResize = () => setBox((b) => (b ? clamp(b) : b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [web]);

  return (
    <div
      ref={boxRef}
      data-channel-preview
      className={
        web
          ? // Fluid so it fits a phone (a fixed 448px box overflows a 390px
            // viewport). Sits below the app's top bar rather than over it —
            // until the user drags it, after which `box` pins it explicitly.
            `fixed z-40 rounded-lg overflow-hidden bg-[#0b1524] ring-1 ring-[#1399ff]/60 shadow-lg${
              box ? "" : " top-16 right-2 sm:right-4 w-[min(22rem,calc(100vw-1rem))] sm:w-[26rem]"
            }`
          : "fixed z-40 rounded-lg overflow-hidden bg-[#0b1524] ring-1 ring-[#1399ff]/60"
      }
      style={
        web
          ? box
            ? { left: box.x, top: box.y, width: box.w }
            : undefined
          : { width: W, top: 16, right: 16 }
      }
    >
      <div
        className={web ? "relative bg-black w-full aspect-video" : "relative bg-black"}
        style={web ? undefined : { width: W, height: H }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="w-full h-full object-contain"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
        />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={web ? "text-xs text-[#8197a4]" : "text-base text-[#8197a4]"}>
              {failed ? "Preview unavailable" : "Tuning…"}
            </span>
          </div>
        )}
      </div>
      {/* The label strip doubles as the drag handle on web/mobile. `touch-none`
          stops a drag from scrolling the page underneath on a phone. */}
      <div
        onPointerDown={web ? startDrag : undefined}
        className={
          web
            ? "flex items-center gap-2 px-2 py-1.5 cursor-move touch-none select-none"
            : "flex items-center gap-2 px-3 py-2"
        }
      >
        <div
          className={
            web
              ? "w-8 h-6 shrink-0 flex items-center justify-center rounded bg-[#121a24]"
              : "w-10 h-7 shrink-0 flex items-center justify-center rounded bg-[#121a24]"
          }
        >
          <LogoImage
            name={channel.name}
            logoUrl={channel.logo_url || channel.logo}
            className="w-full h-full p-0.5"
            fallbackClassName="text-xs font-bold text-white/80"
            eager
          />
        </div>
        <span className={web ? "text-xs text-white truncate" : "text-base text-white truncate"}>
          {channel.name}
        </span>
        {web ? (
          <>
            {watchHref ? (
              <Link
                href={watchHref}
                data-preview-watch
                className="ml-auto shrink-0 text-[10px] font-medium text-white px-2 py-1 rounded ring-1 ring-[#1399ff]/60 bg-[#1399ff]/15 hover:bg-[#1399ff]/30"
              >
                Tap again to watch →
              </Link>
            ) : (
              <span className="ml-auto shrink-0 text-[10px] text-[#8197a4]">Tap again to watch</span>
            )}
            {/* Web has no Back key, so the preview needs a way out. */}
            <button
              type="button"
              aria-label="Close preview"
              onClick={onClose}
              className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-[#8197a4] hover:text-white hover:bg-white/10"
            >
              ✕
            </button>
          </>
        ) : watchHref ? (
          // data-tv makes it reachable with the remote — TvNav's geometric
          // navigation will find it from the grid, and Enter activates a focused
          // <a> natively.
          <Link
            href={watchHref}
            data-tv
            className="ml-auto shrink-0 text-sm font-medium text-white px-3 py-1 rounded ring-1 ring-[#1399ff]/60 bg-[#1399ff]/15 focus:outline-none focus:ring-2 focus:ring-[#1399ff]"
          >
            Press again to watch →
          </Link>
        ) : (
          <span className="ml-auto shrink-0 text-sm text-[#8197a4]">Press again to watch</span>
        )}
      </div>

      {/* Resize grip — desktop only. Deliberately not on touch: a corner grab
          handle is a poor target on a phone and competes with the drag, so
          mobile is move-only. Width drives the size; the video keeps 16:9. */}
      {web && (
        <div
          onPointerDown={startResize}
          role="separator"
          aria-label="Resize preview"
          aria-orientation="vertical"
          className="hidden sm:block absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none"
          style={{
            background:
              "linear-gradient(135deg, transparent 0 50%, rgba(19,153,255,0.75) 50% 100%)",
          }}
        />
      )}
    </div>
  );
}
