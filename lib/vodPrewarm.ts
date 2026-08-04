/**
 * Client-side VOD stream prewarm + dedupe cache.
 *
 * Resolving a clean ad-free stream for a gap title (one our IPTV index doesn't
 * carry) goes through provider-a-via-Origin and takes ~10-13s — that's provider-a's own page
 * latency, so a single resolve can't be made faster. Instead we hide the wait:
 *
 *  • dedupe — a title resolved once (or being resolved) is never re-fetched; the
 *    detail page and a poster press share ONE in-flight request.
 *  • prewarm — poster press/hover and trending rails kick the resolve BEFORE the
 *    user lands on the detail page, so by the time they tap play it's ready.
 *  • cache — successful resolves stick for 30min, so back/forward and re-opens
 *    are instant.
 *
 * Cache lives in module scope (survives SPA navigation within the session). It is
 * NOT the server cache in lib/vod-resolve.ts — Vercel lambdas are per-instance, so
 * a client cache is the reliable layer for "feels instant".
 */

import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";

type Kind = "movie" | "series";

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { urls: string[]; at: number }>();
const inflight = new Map<string, Promise<string[]>>();

function keyOf(kind: Kind, tmdb: number | string, s?: number, e?: number): string {
  return kind === "series" ? `tv:${tmdb}:${s ?? 1}:${e ?? 1}` : `movie:${tmdb}`;
}

function extractUrl(kind: Kind, tmdb: number | string, s?: number, e?: number): string {
  return kind === "series"
    ? `/api/vod-extract?type=tv&tmdb=${tmdb}&s=${s ?? 1}&e=${e ?? 1}`
    : `/api/vod-extract?type=movie&tmdb=${tmdb}`;
}

/** Synchronously return a fresh cached result, or null. Lets the detail page paint
 *  instantly when a poster press/hover already resolved the title. */
export function getPrewarmed(kind: Kind, tmdb: number | string, s?: number, e?: number): string[] | null {
  const hit = cache.get(keyOf(kind, tmdb, s, e));
  return hit && Date.now() - hit.at < TTL_MS ? hit.urls : null;
}

/** Resolve a title's clean streams, sharing any cached/in-flight result. This is
 *  the single entry point the detail page should await — prewarm just calls it
 *  early and ignores the result. */
export function resolveVod(
  kind: Kind,
  tmdb: number | string,
  s?: number,
  e?: number,
  /** Ignore every cached and in-flight answer and ask the backend again.
   *  Without this a "refresh sources" control is a lie: a resolved title is
   *  memoised for 30 minutes, so the retry would hand back the exact same dead
   *  URLs the user is already staring at. Sources rot (upstream panels rate-
   *  limit, links rotate nightly), so re-asking is the whole point. */
  force = false,
): Promise<string[]> {
  const k = keyOf(kind, tmdb, s, e);
  if (force) {
    cache.delete(k);
    inflight.delete(k);
  } else {
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.urls);
    const existing = inflight.get(k);
    if (existing) return existing;
  }

  // Deadlined because this promise is MEMOISED in `inflight`: on the TV, where
  // a stalled fetch never settles, a hung resolve would be handed to every
  // later caller for this title — one stall would break it for the whole
  // session, with "Finding streams…" up forever. The deadline guarantees the
  // entry is eventually rejected and cleared below.
  const url = extractUrl(kind, tmdb, s, e);
  const p = fetchWithDeadline(force ? `${url}&_r=${Date.now()}` : url, {}, DEADLINE.stream)
    .then((r) => (r.ok ? r.json() : { stream_urls: [] }))
    .then((d) => (Array.isArray(d?.stream_urls) ? (d.stream_urls as string[]) : []))
    .then((urls) => {
      // Only cache non-empty — a transient miss should be retryable on next open.
      if (urls.length) cache.set(k, { urls, at: Date.now() });
      inflight.delete(k);
      return urls;
    })
    .catch(() => {
      inflight.delete(k);
      return [] as string[];
    });
  inflight.set(k, p);
  return p;
}

// Throttled prewarm queue — cap concurrent background resolves so prewarming a
// trending rail can't fan out 10+ simultaneous 10-13s Origin requests and load the
// box. Press/hover prewarms also flow through here.
const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!;
    active++;
    job();
  }
}

/** Fire-and-forget background resolve. No-op if already cached or in flight. */
export function prewarmVod(kind: Kind, tmdb: number | string, s?: number, e?: number): void {
  const k = keyOf(kind, tmdb, s, e);
  if (cache.has(k) || inflight.has(k)) return;
  queue.push(() => {
    resolveVod(kind, tmdb, s, e).finally(() => {
      active--;
      pump();
    });
  });
  pump();
}

/* ---------------- remux session warmup (10-foot UI only) ----------------
 *
 * Resolving a title gets you a LIST of URLs; it does not make any of them
 * playable. Nearly every VOD source is a `relay.example.com/remux.m3u8`, and the
 * relay won't answer that until ffmpeg has spun up and closed a first segment.
 * Measured against production: 14.5s cold, 0.73s once the session exists. That
 * gap is the entire "why does a movie take so long to start" complaint, and
 * resolving earlier cannot touch it.
 *
 * The web detail page mounts VodPlayer with autoPlay as soon as sources land,
 * so there is no dwell to hide the wait in. The TV has one: a card sits under
 * the remote's cursor for seconds before anyone presses Enter. So this warms
 * the FIRST source of a card that has held focus, and only then.
 *
 * Three guards, because a warm is an ffmpeg process on a 2 GB box:
 *   • DWELL — nothing fires until the card has held focus for WARM_DWELL_MS, so
 *     arrowing along a rail warms nothing.
 *   • ONE AT A TIME — a later focus replaces the pending warm outright.
 *   • REMUX ONLY — `/api/vod-stream` sources are a byte range proxy, not a
 *     session; "warming" one would just pull movie bytes for nothing.
 * The relay caps VOD at 3 sessions and evicts warmup-only ones (those that
 * never served a segment) first, so a warm can never displace someone watching.
 *
 * Deliberately NOT aborted when focus moves on: by then ffmpeg is already
 * starting, and dropping the request risks the server cancelling the handler
 * mid-spawn. The session idle-reaps on its own; letting the small manifest
 * request finish is the cheaper, safer end.
 */

const WARM_DWELL_MS = 1200;
let warmTimer: ReturnType<typeof setTimeout> | null = null;
let warmedUrl: string | null = null;
let warmInFlight = false;

/** Warm the remux session for a title the viewer is dwelling on. */
export function warmFirstSource(kind: Kind, tmdb: number | string, s?: number, e?: number): void {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    if (warmInFlight) return;
    void (async () => {
      try {
        const urls = getPrewarmed(kind, tmdb, s, e) ?? (await resolveVod(kind, tmdb, s, e));
        const first = urls[0];
        if (!first || !first.includes("remux.m3u8")) return;
        if (first === warmedUrl) return; // already warm (or warming) for this title
        warmedUrl = first;
        warmInFlight = true;
        await fetchWithDeadline(first, { cache: "no-store" }, DEADLINE.stream).catch(() => {});
      } catch {
        // Best effort — a failed warm just means the player pays the cold start.
      } finally {
        warmInFlight = false;
      }
    })();
  }, WARM_DWELL_MS);
}
