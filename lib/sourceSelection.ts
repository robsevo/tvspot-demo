/**
 * Live source ORDERING — the pure half of the picker.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * This logic used to live twice, inline, in ChannelPlayer and TvChannelPlayer —
 * ~200 lines of identical state machine, hand-ported and kept in sync by
 * copying. They had already drifted (one player's bench-expansion fetch lost
 * its deadline), and every fix had to be made and re-reasoned in two places.
 *
 * Splitting the PURE decisions out here buys two things the inline version
 * could not have:
 *   - the two shells cannot disagree about what "source 1" is, which matters
 *     because the guide preview hands its on-screen URL to the player by string
 *     (see lib/previewHandoff);
 *   - the ordering can be tested against real lineup data without React, a
 *     browser, or a network — see scripts/source-order-check.mjs. The subtlest
 *     bug this ever had (an unstable sort on the TVs) was invisible in review
 *     and trivial to catch with a test.
 *
 * Everything here is a pure function of (urls, verdicts, failures, reputation).
 * The React state that feeds it lives in hooks/useLiveSources.
 */

import type { SourceStatus } from "@/hooks/useStreamCheck";
import { inCooldown, type FailureMap } from "@/lib/sourceFailover";
import { reputationOf } from "@/lib/sourceReputation";

/** Everything the ordering needs to know about the world, in one bag. */
export interface SelectionContext {
  /** Live probe verdict per URL. */
  statusOf: (url: string) => SourceStatus;
  /** Sources that dropped during playback, with blip classification. */
  failures: FailureMap;
  /** Playback-reputation table snapshot (see lib/sourceReputation). */
  reputation: Record<string, { good: number; bad: number; bestMs: number; at: number }>;
  /** The URL that has actually rendered frames, if any. */
  confirmedUrl: string | null;
  /** Now, injected so callers can tick cooldowns and tests can be deterministic. */
  now: number;
}

/**
 * Is this source unusable right now?
 *
 * Order matters. A real mid-watch drop (cooldown) outranks even a confirmed
 * source — that IS the failover. But a source currently rendering frames can
 * never be condemned by a probe: playback is stronger evidence than any
 * pre-flight check, and a transient 456/timeout must not pull the rug.
 */
export function isDead(url: string, ctx: SelectionContext): boolean {
  if (inCooldown(ctx.failures, url, ctx.now)) return true;
  if (url === ctx.confirmedUrl) return false;
  return ctx.statusOf(url) === "dead";
}

/**
 * Playback preference for a source. LOWER wins.
 *
 * -1 is reserved for the source on screen so a healthy connect can never be
 * displaced by anything. Note "checking/unknown" (1) deliberately beats "busy"
 * (2): an unjudged source might work, whereas a connection-limited panel is
 * known not to start right now.
 */
export function pickRank(url: string, ctx: SelectionContext): number {
  if (url === ctx.confirmedUrl) return -1;
  switch (ctx.statusOf(url)) {
    case "working": return 0;
    case "checking":
    case "unknown": return 1;
    case "busy": return 2;
    default: return 3;
  }
}

/**
 * Candidates best-first.
 *
 * The final `indexOf` tiebreak is LOAD-BEARING, not tidiness. At tune-in every
 * source is "checking" (rank 1) and every reputation is 0, so the first two
 * terms return 0 for every pair — leaving the result entirely to the engine's
 * sort stability. `Array.prototype.sort` is only guaranteed stable from ES2019
 * (V8 7.0 / Chrome 70), this app's browserslist floor is `chrome >= 63`, and
 * Tizen ships 69/76/85 by model year. Below TimSort, V8 uses an unstable
 * quicksort above 10 elements — and most channels carry more than 10 sources.
 * Without this, the source the TV starts on is engine-defined rather than the
 * best-ranked one.
 */
export function rankSources(urls: string[], ctx: SelectionContext): string[] {
  return urls
    .filter((u) => !isDead(u, ctx))
    .map((u, i) => ({ u, i }))
    .sort(
      (a, b) =>
        pickRank(a.u, ctx) - pickRank(b.u, ctx) ||
        reputationOf(b.u, ctx.reputation) - reputationOf(a.u, ctx.reputation) ||
        a.i - b.i,
    )
    .map((x) => x.u);
}

/**
 * Does the current attempt keep the player?
 *
 * THE ATTEMPT OWNS THE PLAYER. This used to release the pick whenever any other
 * source ranked strictly better, which sounds reasonable and was the single
 * biggest source of tune-in delay: playback starts on source 1 while everything
 * is still "checking", the first probe shard lands 89-450ms later, a source
 * verifies, and `src` changes — tearing down hls.js and re-buffering mid-connect.
 * On a TV the first frame always arrives after the first verdict, so it happened
 * essentially every tune-in.
 *
 * A verdict about a DIFFERENT source is not evidence about this one. So the
 * stick releases only on evidence about ITSELF:
 *   - it is dead or cooling down (which includes missing its first-frame
 *     deadline, recorded as an ordinary failure); or
 *   - its own verdict is `busy` — a connection-limited panel will not start, so
 *     waiting out its budget is pure dead time. This is the case the old rule
 *     got right and must be preserved.
 * Once frames render, confirmedUrl shields it from the busy test too.
 */
export function stickHolds(stick: string | null, urls: string[], ctx: SelectionContext): boolean {
  if (stick == null || !urls.includes(stick)) return false;
  if (isDead(stick, ctx)) return false;
  return !(stick !== ctx.confirmedUrl && ctx.statusOf(stick) === "busy");
}

/**
 * Display tier for the source row. LOWER sorts first.
 *
 * Distinct from pickRank because the row answers a different question: the user
 * is reading a list, so what is PLAYING and what they explicitly PICKED both
 * pin to the top, even when a probe would rank them lower.
 */
export function displayTier(url: string, ctx: SelectionContext, pickedUrl: string | null): number {
  if (url === ctx.confirmedUrl) return 0; // on screen → reality outranks any probe
  if (url === pickedUrl) return 0;        // the user's explicit choice stays put
  if (isDead(url, ctx)) return 4;
  switch (ctx.statusOf(url)) {
    case "working": return 1;
    case "busy": return 2;
    case "dead": return 4;
    default: return 3;                    // unknown / still checking
  }
}

/**
 * The source row, best-first and capped.
 *
 * Membership is EVERY source, always — hiding one because a probe round said
 * "dead" is what made sources appear to vanish and come back on their own, on
 * panels that demonstrably flap probe-to-probe. Verdicts drive the badge and
 * the order, never the membership. Stable within a tier (same index tiebreak,
 * same reason as rankSources).
 */
export function orderForDisplay(
  urls: string[],
  ctx: SelectionContext,
  pickedUrl: string | null,
  cap: number,
): string[] {
  return urls
    .map((u, i) => ({ u, i, t: displayTier(u, ctx, pickedUrl) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.u)
    .slice(0, cap);
}
