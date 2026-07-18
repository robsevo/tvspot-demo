"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import VodPlayer from "@/components/VodPlayer";
import { useTvBack } from "@/components/tv/TvNav";
import { TVKEY } from "@/lib/tv";
import type { PlayableSource } from "@/lib/sources";

const SEEK_STEP_S = 15;
const OSD_MS = 3000;

interface Props {
  /** Failover chain, best first (stream sources only — embeds are unusable
   *  with a remote, so TV never surfaces them). */
  sources: PlayableSource[];
  title: string;
  poster?: string;
  /** Resume position (continue watching). */
  initialTime?: number;
  onClose: () => void;
  /** Throttled absolute progress, for continue-watching persistence. */
  onProgress?: (currentTime: number, duration: number) => void;
}

/**
 * Full-screen VOD playback overlay for the TV shell, on top of VodPlayer's
 * source-failure detection (never-started timeout, stall strikes, dwell-paced
 * failover). Remote controls:
 *
 *   Enter / Play-Pause   pause / resume
 *   Left / Right         seek ∓/± 15s (no-op on unseekable remux streams)
 *   Back                 stop and return to the detail page
 */
export default function TvVodPlayback({
  sources,
  title,
  poster,
  initialTime,
  onClose,
  onProgress,
}: Props) {
  const [index, setIndex] = useState(0);
  const [resumeAt, setResumeAt] = useState(initialTime ?? 0);
  const [exhausted, setExhausted] = useState(false);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const [osd, setOsd] = useState<string | null>(null);
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashOsd = useCallback((text: string) => {
    setOsd(text);
    if (osdTimer.current) clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setOsd(null), OSD_MS);
  }, []);
  useEffect(() => () => {
    if (osdTimer.current) clearTimeout(osdTimer.current);
  }, []);

  useTvBack(onClose);

  // This source is dead — resume the next one where playback left off.
  const fail = useCallback(
    (lastTime: number) => {
      setResumeAt(lastTime > 5 ? lastTime : 0);
      setIndex((i) => {
        if (i + 1 < sources.length) {
          flashOsd(`Source failed — trying ${sources[i + 1].label}`);
          return i + 1;
        }
        setExhausted(true);
        return i;
      });
    },
    [sources, flashOsd],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoElRef.current;
      const code = e.keyCode;
      switch (code) {
        case TVKEY.enter:
        case TVKEY.playPause:
        case TVKEY.play:
        case TVKEY.pause:
          e.preventDefault();
          if (!v) return;
          if (v.paused) {
            void v.play().catch(() => {});
            flashOsd("Playing");
          } else {
            v.pause();
            flashOsd("Paused");
          }
          return;
        case TVKEY.left:
        case TVKEY.rewind:
        case TVKEY.right:
        case TVKEY.fastForward: {
          e.preventDefault();
          if (!v || !isFinite(v.duration) || v.duration <= 0) return; // remux: unseekable
          const back = code === TVKEY.left || code === TVKEY.rewind;
          v.currentTime = Math.max(
            0,
            Math.min(v.duration, v.currentTime + (back ? -SEEK_STEP_S : SEEK_STEP_S)),
          );
          flashOsd(back ? `−${SEEK_STEP_S}s` : `+${SEEK_STEP_S}s`);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flashOsd]);

  const source = sources[index];

  return (
    <div data-tv-trap className="fixed inset-0 z-50 bg-black">
      {source && !exhausted ? (
        <div className="w-full h-full flex items-center justify-center [&>div]:rounded-none">
          <VodPlayer
            key={index}
            src={source.url}
            poster={poster}
            title={title}
            autoPlay
            initialTime={resumeAt > 5 ? resumeAt : undefined}
            videoElRef={videoElRef}
            onSourceFail={fail}
            onProgress={onProgress}
          />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <p className="text-2xl text-white">No source could play {title}.</p>
          <p className="text-xl text-text-muted">Press Back to return.</p>
        </div>
      )}

      {osd && (
        <div className="absolute top-10 left-12 bg-black/70 rounded-2xl px-6 py-4 animate-fade-in">
          <p className="text-2xl font-semibold text-white">{osd}</p>
        </div>
      )}
    </div>
  );
}
