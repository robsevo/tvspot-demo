"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type Hls from "hls.js"; // type only — the library is imported lazily below
import { Volume2, VolumeX, Captions } from "lucide-react";
import { LogoImage } from "@/components/LogoImage";
import { ccWordsOf, ccWrap } from "@/lib/captions";
import { useLiveCaptions } from "@/hooks/useLiveCaptions";
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

/** Preview sound + captions, remembered across channel swaps and sessions.
 *
 *  Separate from the full player's CC_PREF_KEY on purpose: the preview is a
 *  glance, and wanting captions on a 400px tile you're scanning the guide with
 *  is a different question from wanting them on the show you sat down to watch.
 *  Both default ON — the preview exists to answer "what's on this channel", and
 *  a silent, caption-less thumbnail answers it badly. */
const SOUND_KEY = "tvspot_preview_sound_v1";
const CC_KEY = "tvspot_preview_cc_v1";

function readFlag(key: string, dflt: boolean): boolean {
  if (typeof window === "undefined") return dflt;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? dflt : raw === "1";
  } catch {
    return dflt;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
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
 * Small live preview of a channel, pinned to the top-right of the guide.
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
 * Sound and captions are ON by default (see SOUND_KEY / CC_KEY), because the
 * preview's whole job is telling you what's on a channel and a silent tile does
 * that poorly. Both are one tap away from off, and the choice sticks.
 *
 * Unmuted autoplay is not guaranteed: engines block it unless the gesture that
 * opened the preview counts as activation. It usually does here — the preview is
 * only ever opened by an Enter/tap on a channel — but when play() is rejected we
 * fall back to muted, keep playing, and surface an "unmute" affordance rather
 * than showing a dead tile.
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
  const [soundOn, setSoundOn] = useState(() => readFlag(SOUND_KEY, true));
  const [ccOn, setCcOn] = useState(() => readFlag(CC_KEY, true));
  /** Set when the engine refused unmuted autoplay and we fell back to muted, so
   *  the button can read "unmute" rather than silently contradicting the pref. */
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  /** Read inside the play effect without making it a dependency — changing the
   *  sound setting must not tear down and re-attach the stream. */
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

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

    /** Start playback honouring the sound preference, and survive an engine that
     *  refuses it. A rejected unmuted play() must not leave a black tile: mute,
     *  retry, and let the UI offer to unmute (that tap IS activation, so it
     *  works). */
    const tryPlay = () => {
      video.muted = !soundRef.current;
      void video.play().catch(() => {
        if (cancelled || video.muted) return;
        video.muted = true;
        setAutoplayBlocked(true);
        // Retry directly, NOT through tryPlay — that would reset muted from the
        // preference and loop on an engine that keeps refusing.
        void video.play().catch(() => {});
      });
    };

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
          void tryPlay();
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
        void tryPlay();
      })();
    } else {
      // iOS/Safari play HLS natively — including the stream's own CEA-608, which
      // lands in video.textTracks the same way hls.js's decoded track does, so
      // useLiveCaptions finds it here too.
      video.src = src;
      void tryPlay();
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

  // ── sound ──────────────────────────────────────────────────────────────────
  // Kept out of the stream effect so toggling sound never re-attaches hls.js.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !soundOn;
    if (soundOn) {
      setAutoplayBlocked(false);
      // The toggle IS the user gesture, so this is exactly when an engine that
      // refused unmuted autoplay will finally allow it.
      void video.play().catch(() => {});
    }
  }, [soundOn]);

  // ── captions ───────────────────────────────────────────────────────────────
  const ccSource = useLiveCaptions(videoRef, ccOn, src);
  const videoBoxRef = useRef<HTMLDivElement | null>(null);
  const [ccMetrics, setCcMetrics] = useState({ widthPx: 0, fontPx: 11, font: "" });

  useEffect(() => {
    const el = videoBoxRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      // Same shape as the player's sizing but scaled for a tile — this box is
      // 448px on the TV and ~350px on a phone, so the player's 12-32px range
      // would bury the picture it's captioning.
      const fontPx = Math.round(Math.min(18, Math.max(9, w * 0.038)));
      const family = getComputedStyle(el).fontFamily || "sans-serif";
      setCcMetrics({
        // Gutters + .cc-box's 0.6em side padding, so a measured-to-the-pixel
        // line can't get wrapped a second time by the browser.
        widthPx: Math.max(60, w - 12 - fontPx * 1.2),
        fontPx,
        font: `500 ${fontPx}px ${family}`,
      });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [box, web]);

  // Re-wrapped for reading, exactly as the full player does it (see ccWrap).
  // `streaming: true` unconditionally — the preview only ever shows live.
  const ccLines = useMemo(() => {
    if (!ccSource.lines.length || ccMetrics.widthPx <= 0) return ccSource.lines;
    return ccWrap(
      ccWordsOf(ccSource.lines),
      ccMetrics.widthPx,
      ccMetrics.font,
      ccMetrics.fontPx,
      true,
    );
  }, [ccSource, ccMetrics]);

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
        ref={videoBoxRef}
        className={web ? "relative bg-black w-full aspect-video" : "relative bg-black"}
        style={web ? undefined : { width: W, height: H }}
      >
        <video
          ref={videoRef}
          playsInline
          autoPlay
          className="w-full h-full object-contain"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
        />
        {/* Captions, drawn by us from a `hidden` track — same .cc-box/.cc-line
            styling the full player uses, so they read identically. Sits above
            the picture but below nothing else; the tile has no controls to
            collide with. */}
        {ccOn && ccLines.length > 0 && (
          <div
            className="absolute inset-x-1.5 flex flex-col items-center justify-end pointer-events-none"
            // No flex `gap` here: that's Chrome 84+ and the 2019 Samsung is
            // Chromium 63. .cc-line is display:block with its own line-height,
            // which stacks the rows on every engine.
            style={{ fontSize: `${ccMetrics.fontPx}px`, bottom: "6%" }}
          >
            {/* ONE opaque box around all lines, exactly as the full player does
                it — a per-line pill lets burned-in subs bleed through and reads
                as two caption layers. */}
            <div className="cc-box">
              {ccLines.map((line, i) => (
                <span key={i} className="cc-line">
                  {line.map((seg, j) => (
                    <span
                      key={j}
                      className={`${seg.i ? "italic" : ""} ${seg.b ? "font-bold" : ""} ${seg.u ? "underline" : ""}`}
                    >
                      {seg.text}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        )}
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
        {/* Sound + captions. `data-tv` makes them reachable with the remote —
            TvNav's geometric navigation finds them from the grid, and Enter
            activates a focused <button> natively. On web they're plain taps. */}
        <div className="ml-auto shrink-0 flex items-center gap-1">
          <button
            type="button"
            data-tv={web ? undefined : ""}
            aria-label={soundOn ? "Mute preview" : "Unmute preview"}
            aria-pressed={soundOn}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              writeFlag(SOUND_KEY, next);
            }}
            className={
              (web ? "w-6 h-6" : "w-9 h-9") +
              " rounded flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#1399ff] " +
              (soundOn && !autoplayBlocked
                ? "text-white bg-[#1399ff]/20"
                : "text-[#8197a4] hover:text-white hover:bg-white/10")
            }
          >
            {soundOn && !autoplayBlocked ? (
              <Volume2 className={web ? "w-3.5 h-3.5" : "w-5 h-5"} />
            ) : (
              <VolumeX className={web ? "w-3.5 h-3.5" : "w-5 h-5"} />
            )}
          </button>
          <button
            type="button"
            data-tv={web ? undefined : ""}
            aria-label={ccOn ? "Hide captions" : "Show captions"}
            aria-pressed={ccOn}
            onClick={() => {
              const next = !ccOn;
              setCcOn(next);
              writeFlag(CC_KEY, next);
            }}
            className={
              (web ? "w-6 h-6" : "w-9 h-9") +
              " rounded flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#1399ff] " +
              (ccOn
                ? "text-white bg-[#1399ff]/20"
                : "text-[#8197a4] hover:text-white hover:bg-white/10")
            }
          >
            <Captions className={web ? "w-3.5 h-3.5" : "w-5 h-5"} />
          </button>
        </div>
        {web ? (
          <>
            {watchHref ? (
              <Link
                href={watchHref}
                data-preview-watch
                className="shrink-0 text-[10px] font-medium text-white px-2 py-1 rounded ring-1 ring-[#1399ff]/60 bg-[#1399ff]/15 hover:bg-[#1399ff]/30"
              >
                Tap again to watch →
              </Link>
            ) : (
              <span className="shrink-0 text-[10px] text-[#8197a4]">Tap again to watch</span>
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
            className="shrink-0 text-sm font-medium text-white px-3 py-1 rounded ring-1 ring-[#1399ff]/60 bg-[#1399ff]/15 focus:outline-none focus:ring-2 focus:ring-[#1399ff]"
          >
            Press again to watch →
          </Link>
        ) : (
          <span className="shrink-0 text-sm text-[#8197a4]">Press again to watch</span>
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
