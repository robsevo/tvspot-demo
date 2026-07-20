"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AUTO_NEXT_SECONDS,
  introEndFor,
  showNextUp,
  showSkipIntro,
} from "@/lib/episodeMarkers";

/** Marker polling cadence. Deliberately independent of any OSD/controls tick —
 *  these actions must appear whether or not chrome is on screen. */
const MARKER_TICK_MS = 500;

export interface EpisodeMarkers {
  /** "Skip intro" should be offered right now. */
  skipVisible: boolean;
  /** "Next up" should be offered right now (implies a next episode exists). */
  nextVisible: boolean;
  /** Seconds left on the auto-advance, or null when the card isn't up. */
  countdown: number | null;
  /** Seek past the title sequence. */
  skipIntro: () => void;
  /** Advance to the next episode now. */
  playNext: () => void;
  /** Hide whichever action is showing, for this source, without acting on it. */
  dismiss: () => void;
}

/**
 * Shared "Skip intro" / "Next up" behaviour for episode playback, driving off
 * the raw <video> element. The TV and mobile shells render very different
 * chrome for these (10-foot focusable pills vs compact tap targets), but the
 * timing rules, dismissal semantics and auto-advance must not drift apart —
 * so they live here and each shell supplies its own presentation.
 *
 * Boundary math (and the reasons it's heuristic) is in lib/episodeMarkers.ts.
 *
 * @param videoElRef  the element being played
 * @param onNext      advance to the next episode; omit when there isn't one
 *                    (movie, or series finale) to disable everything next-related
 * @param sourceIndex current failover position — dismissals are scoped to it, so
 *                    a card waved away on a source that then DIED comes back on
 *                    the replacement rather than staying hidden for the episode
 */
export function useEpisodeMarkers(
  videoElRef: React.MutableRefObject<HTMLVideoElement | null>,
  onNext?: (() => void) | null,
  sourceIndex = 0,
): EpisodeMarkers {
  const [marks, setMarks] = useState({ skip: false, next: false });
  const [dismissed, setDismissed] = useState({ src: -1, skip: false, next: false });
  const [countdown, setCountdown] = useState<number | null>(null);

  // Poll rather than drive off timeupdate: timeupdate stops firing while
  // paused, and the card must stay put if someone pauses on the credits. The
  // booleans change a handful of times per episode, so the identity early-out
  // keeps this from re-rendering twice a second.
  useEffect(() => {
    const tick = () => {
      const v = videoElRef.current;
      if (!v) return;
      const skip = showSkipIntro(v.currentTime, v.duration);
      const next = showNextUp(v.currentTime, v.duration);
      setMarks((m) => (m.skip === skip && m.next === next ? m : { skip, next }));
    };
    tick();
    const id = setInterval(tick, MARKER_TICK_MS);
    return () => clearInterval(id);
  }, [videoElRef]);

  const dismissOne = useCallback(
    (which: "skip" | "next") => {
      setDismissed((d) => ({
        ...(d.src === sourceIndex ? d : { src: sourceIndex, skip: false, next: false }),
        src: sourceIndex,
        [which]: true,
      }));
    },
    [sourceIndex],
  );

  const skipVisible = marks.skip && !(dismissed.src === sourceIndex && dismissed.skip);
  const nextVisible =
    marks.next && !(dismissed.src === sourceIndex && dismissed.next) && !!onNext;

  const playNext = useCallback(() => {
    onNext?.();
  }, [onNext]);

  const skipIntro = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    // Seek to an ABSOLUTE target, never a relative jump — repeated presses
    // would otherwise walk forward into the episode.
    v.currentTime = introEndFor(v.duration);
    dismissOne("skip");
  }, [videoElRef, dismissOne]);

  const dismiss = useCallback(() => {
    if (nextVisible) dismissOne("next");
    else if (skipVisible) dismissOne("skip");
  }, [nextVisible, skipVisible, dismissOne]);

  // Deadline-based rather than a decrementing counter: the remaining value is
  // computed from wall-clock inside the tick, so nothing is written to state
  // from the effect body (this repo's React-compiler lint rejects that), and a
  // webview that throttles background timers can't stretch 15s into 40s.
  useEffect(() => {
    if (!nextVisible) return;
    const deadline = Date.now() + AUTO_NEXT_SECONDS * 1000;
    const id = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(id);
        playNext();
      } else {
        setCountdown(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [nextVisible, playNext]);

  return {
    skipVisible,
    nextVisible,
    // Fall back to the full count for the sub-tick before the first interval
    // fires, so the UI never paints a blank or a stale number.
    countdown: nextVisible ? (countdown ?? AUTO_NEXT_SECONDS) : null,
    skipIntro,
    playNext,
    dismiss,
  };
}

/** Re-exported so shells can label their countdown without a second import. */
export { AUTO_NEXT_SECONDS };
