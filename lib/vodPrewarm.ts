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
export function resolveVod(kind: Kind, tmdb: number | string, s?: number, e?: number): Promise<string[]> {
  const k = keyOf(kind, tmdb, s, e);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.urls);
  const existing = inflight.get(k);
  if (existing) return existing;

  // Deadlined because this promise is MEMOISED in `inflight`: on the TV, where
  // a stalled fetch never settles, a hung resolve would be handed to every
  // later caller for this title — one stall would break it for the whole
  // session, with "Finding streams…" up forever. The deadline guarantees the
  // entry is eventually rejected and cleared below.
  const p = fetchWithDeadline(extractUrl(kind, tmdb, s, e), {}, DEADLINE.stream)
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
