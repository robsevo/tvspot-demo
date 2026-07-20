"use client";

import { SkipForward, X } from "lucide-react";
import type { EpisodeMarkers } from "@/hooks/useEpisodeMarkers";

/**
 * Touch presentation of "Skip intro" / "Next up" for the mobile shell.
 *
 * The TV shell renders its own 10-foot version (focusable pills driven by the
 * D-pad); both share the timing rules via useEpisodeMarkers, so only the chrome
 * differs. Positioned absolutely — the caller must give the player wrapper
 * `relative`.
 *
 * Tap targets are >= 44px per the project's touch rule, and the card sits above
 * the video's own control bar so it never covers the scrubber.
 */
export default function EpisodeActions({
  markers,
  nextLabel,
}: {
  markers: EpisodeMarkers;
  /** Next episode's label, e.g. "S2 E4 · The Constant". */
  nextLabel?: string;
}) {
  const { skipVisible, nextVisible, countdown, skipIntro, playNext, dismiss } = markers;
  if (!skipVisible && !nextVisible) return null;

  return (
    <div className="absolute right-2 bottom-14 z-20 flex flex-col items-end gap-2 pointer-events-none">
      {nextVisible ? (
        <div className="pointer-events-auto flex items-stretch gap-1.5">
          <button
            onClick={playNext}
            className="flex items-center gap-2 min-h-[44px] px-4 rounded-lg bg-white text-black text-xs font-bold shadow-lg active:scale-95 transition-transform"
          >
            <SkipForward className="w-4 h-4" />
            <span className="flex flex-col items-start leading-tight">
              <span>Next episode{countdown !== null ? ` · ${countdown}` : ""}</span>
              {nextLabel && (
                <span className="text-[10px] font-medium text-black/60 max-w-[11rem] truncate">
                  {nextLabel}
                </span>
              )}
            </span>
          </button>
          {/* Explicit cancel: on touch there's no Back button to lean on, and an
              auto-advance you can't stop is worse than no auto-advance. */}
          <button
            onClick={dismiss}
            aria-label="Stay on this episode"
            className="w-11 min-h-[44px] rounded-lg bg-black/70 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={skipIntro}
          className="pointer-events-auto flex items-center gap-2 min-h-[44px] px-4 rounded-lg bg-black/70 text-white text-xs font-bold shadow-lg active:scale-95 transition-transform"
        >
          <SkipForward className="w-4 h-4" />
          Skip intro
        </button>
      )}
    </div>
  );
}
