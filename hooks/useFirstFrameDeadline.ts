"use client";

import { useEffect, useRef } from "react";
import type { SourceStatus } from "@/hooks/useStreamCheck";

/**
 * "This source was given a fair chance and never showed a frame."
 *
 * WHY LIVE NEEDED ITS OWN
 * -----------------------
 * VOD has had a never-started watchdog since the "press play and nothing
 * happens" work (VodPlayer's NEVER_STARTED_MS). Live never did. Its only
 * backstop was VideoPlayer's stall watchdog, which is deliberately two-strike
 * at 10s each — so a live source that connects and then delivers nothing was
 * only noticed at ~20 SECONDS, and only via a path written for a source that
 * plays and *then* freezes.
 *
 * Twenty seconds is the whole complaint on the TVs. It is also paid at the
 * worst possible moment: the first pick, on the device slowest to reach a
 * frame, with the viewer staring at black.
 *
 * THE BUDGET IS ADAPTIVE, AND THE "ok" CASE IS THE INTERESTING ONE
 * ---------------------------------------------------------------
 * A flat timeout gets the `working` case wrong. If /api/stream-check has
 * already fetched this exact playlist, parsed it, and confirmed it lists
 * segments, then a missing frame is not evidence about the SOURCE — it is
 * evidence about this client: a decode the 2019 Samsung can't do, a codec the
 * webview lacks, memory pressure. Failing over then costs a full teardown and
 * re-buffer to land somewhere with no track record at all, which is strictly
 * worse odds. So a verified-ok source is HELD past the budget, and
 * VideoPlayer's stall watchdog remains its backstop.
 *
 * Everything else — no verdict yet, busy, unknown — gets the budget and then
 * counts as a miss.
 *
 * ARMED PER SOURCE, READ AT FIRE TIME
 * -----------------------------------
 * The timer is armed once per `src` and reads status/started through refs when
 * it fires. Putting `status` in the dependency array instead would re-arm the
 * timer on every verdict change — and since these panels flap probe-to-probe,
 * a source could push its own deadline back indefinitely by being uncertain.
 */

/** Budget for a source that has NOT been verified working. */
export const FIRST_FRAME_MS = 10_000;

interface Options {
  /** The source currently attached to the player. Arms a fresh deadline. */
  src: string;
  /** Frames are rendering. MUST come from VideoPlayer's `onStarted` (the
   *  `playing` event), never `onPlay` — `play` fires at MANIFEST_PARSED, which
   *  would clear this watchdog before the source proved anything. */
  started: boolean;
  /** Live probe verdict for `src`, used to decide whether to hold or cut. */
  status: SourceStatus;
  /** Called once when the deadline expires with no frame. */
  onMiss: () => void;
  budgetMs?: number;
}

export function useFirstFrameDeadline({
  src,
  started,
  status,
  onMiss,
  budgetMs = FIRST_FRAME_MS,
}: Options): void {
  const startedRef = useRef(started);
  startedRef.current = started;
  const statusRef = useRef(status);
  statusRef.current = status;
  const onMissRef = useRef(onMiss);
  onMissRef.current = onMiss;

  useEffect(() => {
    if (!src) return;
    let done = false;
    const id = setTimeout(() => {
      if (done) return;
      // It played. Nothing to answer for.
      if (startedRef.current) return;
      // Verified working but no frame → a client-side problem, and switching
      // sources cannot fix a client-side problem. Hold; the stall watchdog in
      // VideoPlayer still covers a source that produces no progress at all.
      if (statusRef.current === "working") return;
      onMissRef.current();
    }, budgetMs);
    return () => {
      done = true;
      clearTimeout(id);
    };
  }, [src, budgetMs]);
}
