/**
 * Mid-playback failure bookkeeping for live sources, shared by both players.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * A source that stalls during playback is put on a cooldown and badged ✗. That
 * is right when THAT source broke. It is wrong when the whole relay hiccuped —
 * and every live source is a `relay.example.com` wrapper, so a relay blip stalls
 * all of them at once.
 *
 * Observed 2026-08-05 on A&E: sources 1, 3 and 4 dropped in quick succession and
 * all three took a red ✗. Probing them immediately afterwards, three rounds
 * apart, 1tvnow.icu and tvmate.icu (sources 3 and 4) answered OK every single
 * time — they were never broken. The relay's own log for that window shows
 * intermittent 500s recovering straight away. The player had walked its list and
 * condemned three healthy sources for one shared upstream event, leaving a row
 * of ✗ and nothing obvious to play.
 *
 * THE RULE
 * --------
 * A failure that arrives ALONE is evidence about that source: full cooldown, and
 * badge it ✗. Failures that arrive TOGETHER are evidence about the relay: keep
 * them eligible after a short pause, and do not badge them at all — there is
 * nothing wrong with them, and the probe (which keeps saying "working") is right.
 *
 * Correlated failures still fail OVER — another source might genuinely be fine —
 * they just are not condemned for it.
 */

/** Two failures closer together than this are treated as one shared event. */
const BLIP_WINDOW_MS = 12_000;

/** Cooldown for a source that dropped ALONE: it needs real time to recover. */
export const FAIL_COOLDOWN_MS = 60_000;

/** Cooldown for a source caught in a relay-wide blip. Long enough to let the
 *  relay come back, short enough that a working source returns almost at once. */
const BLIP_COOLDOWN_MS = 10_000;

export interface SourceFailure {
  /** When it dropped. */
  at: number;
  /** It dropped alongside others — the relay blipped, this source is likely fine. */
  blip: boolean;
}

export type FailureMap = Record<string, SourceFailure>;

/**
 * Record a mid-playback drop, classifying it against the failures already known.
 *
 * When the drop turns out to be correlated, the EARLIER members of the cluster
 * are reclassified too: the first source to fall in a relay blip is collateral
 * for exactly the same reason as the last, and it is the one already wearing a ✗.
 */
export function recordFailure(prev: FailureMap, url: string, now: number): FailureMap {
  const others = Object.entries(prev).filter(
    ([u, e]) => u !== url && now - e.at < BLIP_WINDOW_MS,
  );
  const blip = others.length > 0;
  const next: FailureMap = { ...prev, [url]: { at: now, blip } };
  if (blip) {
    for (const [u] of others) next[u] = { ...next[u], blip: true };
  }
  return next;
}

/** Is this source still cooling down (and therefore not eligible to play)? */
export function inCooldown(map: FailureMap, url: string, now: number): boolean {
  const e = map[url];
  if (!e) return false;
  return now - e.at < (e.blip ? BLIP_COOLDOWN_MS : FAIL_COOLDOWN_MS);
}

/**
 * Should this source be shown as FAILED (red ✗)?
 *
 * Only a solo drop earns that. A source cooling down from a relay blip keeps its
 * real badge — normally "working", which is the truth.
 */
export function isCondemned(map: FailureMap, url: string, now: number): boolean {
  const e = map[url];
  if (!e || e.blip) return false;
  return now - e.at < FAIL_COOLDOWN_MS;
}

/** Least-recently-failed first — the order to retry in when everything is
 *  cooling down (a total relay outage), since the oldest failure is the most
 *  likely to have recovered. */
export function byOldestFailure(map: FailureMap) {
  return (a: string, b: string) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0);
}
