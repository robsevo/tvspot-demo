"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * @param reliableTimeline false when the element's own clock can't be trusted AND
 *                    no `timeline` override is supplied. See `timeline`.
 * @param timeline    OPTIONAL true (position, duration) for sources whose element
 *                    clock lies — i.e. the relay remux, whose playlist is rolling,
 *                    so `video.duration` tracks just ahead of the playhead and
 *                    `currentTime` restarts from 0 at the baked `&start=` offset.
 *
 *                    This is what lets "Next up" work on remux at all. Remux
 *                    leads most VOD titles on purpose (it is the only source
 *                    whose audio we control — see lib/vod-resolve), so
 *                    suppressing markers on rolling timelines meant the feature
 *                    was effectively OFF for most episodes: the shells passed
 *                    reliableTimeline=false and nothing ever appeared. But the
 *                    real runtime IS known — both shells already fetch it from
 *                    /api/vod-audio-tracks to drive their scrubbers — and the
 *                    absolute position is remuxStart + currentTime, which they
 *                    already compute for continue-watching. Feeding those in
 *                    makes the ordinary credit-window math correct again.
 *
 *                    Return null while the runtime is still unknown; markers stay
 *                    suppressed until it lands, which is the safe direction.
 */
export function useEpisodeMarkers(
  videoElRef: React.MutableRefObject<HTMLVideoElement | null>,
  onNext?: (() => void) | null,
  sourceIndex = 0,
  reliableTimeline = true,
  timeline?: (() => { position: number; duration: number } | null) | null,
): EpisodeMarkers {
  const [marks, setMarks] = useState({ skip: false, next: false });
  const [dismissed, setDismissed] = useState({ src: -1, skip: false, next: false });
  const [countdown, setCountdown] = useState<number | null>(null);
  // Read through a ref so a caller can pass an inline arrow without re-arming
  // the polling interval on every render.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  // Poll rather than drive off timeupdate: timeupdate stops firing while
  // paused, and the card must stay put if someone pauses on the credits. The
  // booleans change a handful of times per episode, so the identity early-out
  // keeps this from re-rendering twice a second.
  useEffect(() => {
    const tick = () => {
      const v = videoElRef.current;
      if (!v) return;
      // A supplied timeline OVERRIDES the element's clock — that is the whole
      // point of it, since on a remux the element's clock is what's wrong.
      const t = timelineRef.current?.() ?? null;
      const position = t ? t.position : v.currentTime;
      const duration = t ? t.duration : v.duration;
      // No override and a rolling source → no trustworthy episode length, so
      // offer nothing rather than popping "Next up" (and auto-advancing) at a
      // random point mid-episode.
      const usable = t !== null || reliableTimeline;
      const skip =
        usable &&
        // Skip intro SEEKS. A remux can't be seeked natively (position is baked
        // into the URL), so it is offered only on a genuinely seekable source,
        // regardless of how good the timeline is.
        reliableTimeline &&
        showSkipIntro(position, duration);
      const next = usable && showNextUp(position, duration);
      setMarks((m) => (m.skip === skip && m.next === next ? m : { skip, next }));
    };
    tick();
    const id = setInterval(tick, MARKER_TICK_MS);
    return () => clearInterval(id);
  }, [videoElRef, reliableTimeline]);

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

  // Counts down WALL-CLOCK time, but only while playback is actually running.
  //
  // Measuring elapsed time per tick (rather than counting ticks) keeps the
  // original protection: a webview that throttles background timers reports one
  // big delta instead of many small ones, so it can't stretch 15s into 40s.
  //
  // Pausing HOLDS it. Someone who hits pause on the credits is deciding whether
  // to keep going — advancing out from under them is precisely the "it moved on
  // without me" failure, and it is worse here than on a normal player because a
  // remux advance re-spawns a transcode that takes seconds to undo. This also
  // covers backgrounding for free: VideoPlayer pauses the element when the tab
  // is hidden, so a phone in a pocket can't burn through a season.
  useEffect(() => {
    if (!nextVisible) return;
    let remainingMs = AUTO_NEXT_SECONDS * 1000;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      if (videoElRef.current?.paused) return; // held — see above
      remainingMs -= delta;
      if (remainingMs <= 0) {
        clearInterval(id);
        playNext();
      } else {
        setCountdown(Math.ceil(remainingMs / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [nextVisible, playNext, videoElRef]);

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
