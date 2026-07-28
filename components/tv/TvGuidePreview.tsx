"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js"; // type only — the library is imported lazily below
import { LogoImage } from "@/components/LogoImage";
import type { Channel } from "@/lib/types";

/** 16:9 at a size that reads from the couch without crowding the grid.
 *  Fixed pixels on purpose: `aspect-ratio` is Chrome 88+, and the TV is
 *  Chromium 63 — it would drop the declaration and collapse the box. */
const W = 448;
const H = 252;

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
export default function TvGuidePreview({ channel }: { channel: Channel }) {
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

  return (
    <div
      className="fixed z-40 rounded-lg overflow-hidden bg-[#0b1524] ring-1 ring-[#1399ff]/60"
      style={{ width: W, top: 16, right: 16 }}
    >
      <div className="relative bg-black" style={{ width: W, height: H }}>
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
            <span className="text-base text-[#8197a4]">
              {failed ? "Preview unavailable" : "Tuning…"}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-10 h-7 shrink-0 flex items-center justify-center rounded bg-[#121a24]">
          <LogoImage
            name={channel.name}
            logoUrl={channel.logo_url || channel.logo}
            className="w-full h-full p-0.5"
            fallbackClassName="text-xs font-bold text-white/80"
            eager
          />
        </div>
        <span className="text-base text-white truncate">{channel.name}</span>
        <span className="ml-auto shrink-0 text-sm text-[#8197a4]">
          Press again to watch
        </span>
      </div>
    </div>
  );
}
