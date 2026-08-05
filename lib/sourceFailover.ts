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
 * A failure that arrives ALONE is evidence about that source: stand it down for a
 * full cooldown and badge it ✗. Failures that arrive TOGETHER are evidence about
 * the RELAY: don't cool them, don't badge them, and — the part that matters most
 * — don't switch away at all. When every source is stalled by the same upstream,
 * failing over is futile: it costs a teardown and a ~30s re-buffer to land
 * somewhere equally stuck. Holding still lets VideoPlayer's in-place recovery
 * ride the outage out, which is what the deep buffer was sized for.
 *
 * MAX_BLIP_EXCUSES stops that leniency becoming a trap: a source that drops in
 * every single blip is not a victim of them, and after a few strikes it is
 * treated as genuinely broken.
 */

/** Two failures closer together than this are treated as one shared event. */
const BLIP_WINDOW_MS = 12_000;

/** Cooldown for a source that dropped ALONE: it needs real time to recover. */
export const FAIL_COOLDOWN_MS = 60_000;

/**
 * How many times one source may be excused as "relay blip" before we stop
 * believing it. Guards the case where a genuinely dead source keeps failing at
 * the same moment as everything else and would otherwise never be dropped.
 */
const MAX_BLIP_EXCUSES = 3;

export interface SourceFailure {
  /** When it dropped. */
  at: number;
  /** It dropped alongside others — the relay blipped, this source is likely fine. */
  blip: boolean;
  /** Total drops recorded for this source on this channel visit. */
  strikes: number;
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
  const strikes = (prev[url]?.strikes ?? 0) + 1;
  // Excused as a blip only while the correlation still looks like the relay's
  // fault. A source that keeps dropping in every blip is not a victim of them.
  const blip = others.length > 0 && strikes <= MAX_BLIP_EXCUSES;
  const next: FailureMap = { ...prev, [url]: { at: now, blip, strikes } };
  if (blip) {
    for (const [u] of others) {
      if ((next[u].strikes ?? 0) <= MAX_BLIP_EXCUSES) next[u] = { ...next[u], blip: true };
    }
  }
  return next;
}

/**
 * Is this source still cooling down (and therefore not eligible to play)?
 *
 * A blip does NOT cool a source down at all. That is the point: when the relay
 * hiccups, every source stalls, so switching is futile — it just costs a full
 * teardown and a ~30s re-buffer to land somewhere equally stalled. Staying put
 * lets VideoPlayer's own in-place recovery (hls.startLoad) ride the outage out,
 * which is what the buffer depth was sized for. Only a source that fails ALONE
 * is stood down, because only then is there somewhere better to go.
 */
export function inCooldown(map: FailureMap, url: string, now: number): boolean {
  const e = map[url];
  if (!e || e.blip) return false;
  return now - e.at < FAIL_COOLDOWN_MS;
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
