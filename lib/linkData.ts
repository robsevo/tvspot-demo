import "server-only";
import { get } from "@vercel/blob";
import bundledVerifiedSources from "@/data/verified-sources.json";
import bundledVodIndex from "@/data/vod-index.json";
import type { VodIndex } from "@/scripts/link-freshness/vod-index-types";

/**
 * Runtime access to the nightly link data (verified-sources.json, vod-index.json).
 *
 * WHY THIS EXISTS — the nightly used to force everyone to hard-reload.
 *
 * These two files are rewritten every night by the link-freshness pipeline. They
 * used to be `import`ed at module scope, which baked them into the BUILD:
 * `lib/sources.ts` imported verified-sources.json and `getChannelSources` was
 * called from CLIENT components, so ~480KB of stream links landed in a client
 * chunk. Refreshing the links therefore changed a client chunk → new chunk hash
 * → new buildId → DeployRefresh saw a new deployment and reloaded every open
 * phone and TV, EVERY NIGHT, purely to hand over data the browser could have
 * fetched. (It also meant the whole link list was served from /_next/static,
 * which middleware.ts deliberately excludes from auth.)
 *
 * Now the pipeline uploads both files to a PRIVATE Vercel Blob store and the
 * nightly does not redeploy at all when only data changed. Nothing on the client
 * carries link data, so a data refresh is invisible to open clients.
 *
 * Reads are server-side only (hence `server-only`: importing this from a client
 * component is a build error, which is the guard that keeps the regression from
 * coming back). Private-store reads authenticate via OIDC on Vercel, or
 * BLOB_READ_WRITE_TOKEN elsewhere — both handled by the SDK.
 *
 * Freshness/cost shape:
 *  - an in-process cache per lambda instance, TTL_MS fresh window;
 *  - revalidation is conditional (ifNoneMatch + ETag), so the ~99.9% of
 *    revalidations that happen between nightly runs return 304 with no body and
 *    cost nothing in data transfer;
 *  - a failed fetch NEVER surfaces as an error: we keep serving the last good
 *    copy indefinitely, and only fall back to the build-time copy when this
 *    instance has never successfully read the blob. Stale links merely fail the
 *    player's own liveness probe; an exception would empty the channel.
 */

/** Blob pathnames. Stable — the pipeline overwrites in place (allowOverwrite). */
export const VERIFIED_SOURCES_BLOB = "link-data/verified-sources.json";
export const VOD_INDEX_BLOB = "link-data/vod-index.json";

/** How long a loaded copy is served without revalidating against the store. */
const TTL_MS = 5 * 60_000;

export interface VerifiedSourceEntry {
  url: string;
  [k: string]: unknown;
}
export interface VerifiedSourcesChannel {
  sources?: VerifiedSourceEntry[];
  waiting?: VerifiedSourceEntry[];
}
export interface VerifiedSources {
  meta?: Record<string, unknown>;
  channels?: Record<string, VerifiedSourcesChannel>;
}

/** How long to stop trying the store after a failed read. */
const FAIL_BACKOFF_MS = 30_000;

interface Slot<T> {
  /** Last good parsed copy. Undefined until the first successful blob read. */
  data?: T;
  etag?: string;
  /** When `data` was last confirmed current (a 304 counts as confirmation). */
  checkedAt: number;
  /**
   * Earliest time we may touch the store again after a failure. Without this the
   * failure path would re-attempt on EVERY request — a failed read leaves `data`
   * unset, so the freshness check can't short-circuit — turning a store outage
   * into a failed network round-trip in front of every channel load.
   */
  retryAfter: number;
  /** De-dupes concurrent loads within one instance. */
  inFlight?: Promise<T>;
  /** Build-time copy, used only until the first successful read. */
  fallback: T;
}

const verifiedSlot: Slot<VerifiedSources> = {
  checkedAt: 0,
  retryAfter: 0,
  fallback: bundledVerifiedSources as unknown as VerifiedSources,
};
const vodSlot: Slot<VodIndex> = {
  checkedAt: 0,
  retryAfter: 0,
  fallback: bundledVodIndex as unknown as VodIndex,
};

async function readBlob<T>(pathname: string, slot: Slot<T>): Promise<T> {
  const res = await get(pathname, {
    access: "private",
    // Only meaningful once we hold a copy: an unchanged blob comes back as a
    // bodyless 304 instead of re-downloading ~0.5-0.8MB.
    ifNoneMatch: slot.data !== undefined ? slot.etag : undefined,
  });

  // `null` = no such blob (e.g. before the pipeline has ever uploaded).
  if (!res) throw new Error(`blob ${pathname} not found`);

  if (res.statusCode === 304 && slot.data !== undefined) {
    slot.checkedAt = Date.now();
    return slot.data;
  }

  const text = await new Response(res.stream).text();
  const parsed = JSON.parse(text) as T;
  slot.data = parsed;
  slot.etag = res.blob?.etag;
  slot.checkedAt = Date.now();
  slot.retryAfter = 0;
  return parsed;
}

async function load<T>(pathname: string, slot: Slot<T>): Promise<T> {
  const now = Date.now();
  if (slot.data !== undefined && now - slot.checkedAt < TTL_MS) return slot.data;
  if (now < slot.retryAfter) return slot.data ?? slot.fallback;
  if (slot.inFlight) return slot.inFlight;

  slot.inFlight = readBlob(pathname, slot)
    .catch((err) => {
      // Never let a store hiccup take the app down. Serving yesterday's links is
      // the correct degraded mode; the player probes every source anyway.
      console.error(`[linkData] ${pathname} read failed, serving last-known copy:`, err);
      slot.retryAfter = Date.now() + FAIL_BACKOFF_MS;
      return slot.data ?? slot.fallback;
    })
    .finally(() => {
      slot.inFlight = undefined;
    });

  return slot.inFlight;
}

/** The nightly-verified live-stream list. Never throws. */
export function loadVerifiedSources(): Promise<VerifiedSources> {
  return load(VERIFIED_SOURCES_BLOB, verifiedSlot);
}

/** The nightly IPTV VOD/series index, keyed by TMDB id. Never throws. */
export function loadVodIndex(): Promise<VodIndex> {
  return load(VOD_INDEX_BLOB, vodSlot);
}
