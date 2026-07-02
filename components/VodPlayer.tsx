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
  /** This source is dead — advance. Fired at most once per src. */
  onSourceFail?: () => void;
}

const NEVER_STARTED_MS = 15_000;

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
  const [started, setStarted] = useState(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const fail = useCallback(() => {
    if (failed.current) return; // one verdict per source
    failed.current = true;
    clear();
    onSourceFail?.();
  }, [onSourceFail]);

  const arm = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      if (!failed.current && !started) fail();
    }, NEVER_STARTED_MS);
    // `started` is intentionally read via state at fire time through the
    // closure guard below in onPlay (which clears the timer) — an armed timer
    // that outlives a successful start is always cleared before firing.
  }, [fail, started]);

  // New source: reset the verdict; if it auto-plays (failover advance), the
  // play attempt starts immediately — arm the never-started timeout now.
  useEffect(() => {
    failed.current = false;
    setStarted(false);
    if (autoPlay) arm();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <VideoPlayer
      src={src}
      poster={poster}
      title={title}
      initialTime={initialTime}
      autoPlay={autoPlay}
      onProgress={onProgress}
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
