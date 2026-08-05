"use client";

/**
 * What each source actually DID when we played it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every signal the player ranks on today is a PREDICTION made before playback:
 * /api/stream-check asks "does this playlist parse and list a segment?", and the
 * nightly bufferScore asks "how deep is its window?". Neither can see the thing
 * that actually matters — whether a source SUSTAINS playback. A source that
 * serves a flawless playlist and dies twenty seconds in probes identically to one
 * that runs for three hours.
 *
 * That is the same mistake the VOD side made with its 2-byte range probe (it
 * measured the handshake, not the throughput — see lib/vod-resolve panelPenalty).
 * The fix is the same: stop inferring, and record what happened.
 *
 * Playback is the only ground truth we have, it costs nothing to observe, and it
 * is per-source. So: remember which sources held, which dropped, and rank with
 * it. Over a few evenings this converges on the handful of sources that actually
 * work for a channel — which is knowledge no probe can produce at tune-in time.
 *
 * Deliberately localStorage and per-device: these panels behave differently from
 * different networks (the TV on wifi vs a phone on LTE), so one household's
 * experience is the right scope. Small, bounded, and safe to lose.
 */

const KEY = "tvspot_source_rep_v1";
/** Entries older than this stop counting — panels rotate credentials constantly,
 *  so last month's success says nothing about tonight. */
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Bound the table; these are short records but the source pool is ~1,200. */
const MAX_ENTRIES = 600;
/** Playback shorter than this is a failure to START, not a source that "worked". */
const MIN_GOOD_MS = 20_000;

interface Rep {
  /** Sessions that sustained playback past MIN_GOOD_MS. */
  good: number;
  /** Sessions that started but dropped before that. */
  bad: number;
  /** Longest single stretch it ever held, ms — the strongest signal we have. */
  bestMs: number;
  /** Last time we touched this entry (for TTL + eviction). */
  at: number;
}

type Table = Record<string, Rep>;

function read(): Table {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Table;
    const now = Date.now();
    const out: Table = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.at === "number" && now - v.at < TTL_MS) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function write(t: Table): void {
  if (typeof localStorage === "undefined") return;
  try {
    let entries = Object.entries(t);
    if (entries.length > MAX_ENTRIES) {
      entries = entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    }
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota/private mode — reputation is an optimisation, never a requirement.
  }
}

/**
 * Record how a playback session ended.
 *
 * `playedMs` is wall time on screen. A session that never reached MIN_GOOD_MS is
 * counted against the source: "started and immediately dropped" is exactly the
 * failure the probe cannot predict and the viewer feels most.
 */
export function notePlayback(url: string, playedMs: number): void {
  if (!url) return;
  const t = read();
  const cur = t[url] ?? { good: 0, bad: 0, bestMs: 0, at: 0 };
  const good = playedMs >= MIN_GOOD_MS;
  t[url] = {
    good: cur.good + (good ? 1 : 0),
    bad: cur.bad + (good ? 0 : 1),
    bestMs: Math.max(cur.bestMs, playedMs),
    at: Date.now(),
  };
  write(t);
}

/**
 * Reputation as a small signed nudge, for use as a RANKING TIEBREAK.
 *
 * Deliberately bounded and small (-2 … +3): this refines the order among sources
 * the probe already considers viable, it does not override a live verdict. A
 * source we have never played scores 0 — unknown must not be punished, or a
 * fresh nightly link could never earn its first chance.
 */
export function reputationOf(url: string, table?: Table): number {
  const t = table ?? read();
  const r = t[url];
  if (!r) return 0;
  let s = 0;
  if (r.good > 0) s += r.good >= 3 ? 2 : 1;      // repeatedly held
  if (r.bestMs >= 10 * 60_000) s += 1;           // once ran ten clean minutes
  if (r.bad > r.good) s -= r.bad >= 3 ? 2 : 1;   // mostly drops out
  return Math.max(-2, Math.min(3, s));
}

/** Snapshot the table once per render pass — reading localStorage per source in
 *  a sort comparator would be O(n log n) storage reads on a 20-source list. */
export function reputationTable(): Table {
  return read();
}
