"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import VideoPlayer from "@/components/VideoPlayer";

/**
 * VideoPlayer wrapped with VOD source-failure detection. Live TV has its own
 * failover in ChannelPlayer — this is the VOD equivalent, fixing the "press
 * play and nothing happens / the play button never goes away" class:
 *
 *  - player error (dead proxy URL, bad container, hls fatal) → onSourceFail
 *  - stall watchdog second-strike (plays then freezes)       → onSourceFail
 *  - play requested but NOTHING ever starts within 15s       → onSourceFail
 *    (a dead-slow source neither errors nor plays — the timeout is the only
 *    signal; cleared the instant playback actually begins)
 *
 * The parent advances to its next source and remounts with autoPlay so the
 * user doesn't have to press play again.
 */
interface Props {
  src: string;
  poster?: string;
  title?: string;
  initialTime?: number;
  autoPlay?: boolean;
  onProgress?: (currentTime: number, duration: number) => void;
  /** This source is dead — advance. Receives the last playback position so
   *  the parent can resume the NEXT source there instead of restarting. */
  onSourceFail?: (lastTime: number) => void;
}

// Remux sources get a longer runway: a cold relay ffmpeg spawn takes ~20-24s
// to produce the first manifest (the relay holds the request meanwhile), and
// failing over AWAY from the last-resort source because it was still warming
// up defeats its purpose. Direct sources are double-proxied (vod-stream →
// stream-proxy → origin) and a cold chain regularly needs >15s to first frame —
// killing them at 15s cycled the player through GOOD sources ("keeps
// restarting" while the same URL played fine via Open, which has no timeout).
const NEVER_STARTED_MS = 25_000;
const NEVER_STARTED_REMUX_MS = 35_000;

// VOD stall window (VideoPlayer's watchdog runs two strikes of this). Wider
// than the live default: a cold proxied file rebuffering 10-20s is normal and
// self-recovers — the user sees the buffering ring/notice meanwhile — whereas a
// false failover restarts the movie on another source.
const STALL_MS = 15_000;

export default function VodPlayer({
  src,
  poster,
  title,
  initialTime,
  autoPlay = false,
  onProgress,
  onSourceFail,
}: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);
  const lastTime = useRef(0);
  const [started, setStarted] = useState(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const fail = useCallback(() => {
    if (failed.current) return; // one verdict per source
    failed.current = true;
    clear();
    onSourceFail?.(lastTime.current);
  }, [onSourceFail]);

  const arm = useCallback(() => {
    clear();
    const ms = src.includes("/remux.m3u8") ? NEVER_STARTED_REMUX_MS : NEVER_STARTED_MS;
    timer.current = setTimeout(() => {
      if (!failed.current && !started) fail();
    }, ms);
    // `started` is intentionally read via state at fire time through the
    // closure guard below in onPlay (which clears the timer) — an armed timer
    // that outlives a successful start is always cleared before firing.
  }, [fail, started, src]);

  // New source: reset the verdict; if it auto-plays (failover advance), the
  // play attempt starts immediately — arm the never-started timeout now.
  useEffect(() => {
    failed.current = false;
    setStarted(false);
    if (autoPlay) arm();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Remux sources (relay live-style HLS) can't seek — resume is baked into the
  // URL instead: the relay's ffmpeg starts reading the file at &start=<sec>.
  const isRemux = src.includes("/remux.m3u8");
  const effectiveSrc =
    isRemux && initialTime && initialTime > 30
      ? `${src}&start=${Math.max(0, Math.floor(initialTime) - 5)}`
      : src;

  return (
    <VideoPlayer
      src={effectiveSrc}
      poster={poster}
      title={title}
      initialTime={isRemux ? undefined : initialTime}
      autoPlay={autoPlay}
      stallMs={STALL_MS}
      onProgress={onProgress}
      onTimeUpdate={(t) => {
        // Remux playback clocks from 0 at the baked offset — track absolute
        // position so a further failover resumes at the right spot.
        lastTime.current = isRemux && initialTime ? initialTime + t : t;
      }}
      onPlayIntent={arm}
      onPlay={() => {
        setStarted(true);
        clear();
      }}
      onError={fail}
      onStall={fail}
    />
  );
}
