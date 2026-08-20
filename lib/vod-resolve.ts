import "server-only";
import { loadVodIndex } from "@/lib/linkData";
import { episodeKey, type VodStream } from "@/scripts/link-freshness/vod-index-types";

/**
 * Resolve a title to a ranked list of browser-playable stream URLs.
 *
 * Two things happen here, and only two:
 *
 * 1. **Look up** the title in the on-demand index (`data/vod-index.json`).
 * 2. **Route every source through our own origin** via `/api/vod-stream`.
 *
 * Step 2 is the one that matters. A `<video>` element cannot play a cross-origin
 * source that omits CORS headers, and most upstreams do omit them — so a URL that
 * is perfectly valid in a browser address bar fails silently in the player, with
 * an empty error event and no status code. Proxying through the same origin
 * makes CORS a non-issue and gives us one place to add range-request handling,
 * timeouts, and access control.
 *
 * The proxy URL is unsigned here on purpose: the caller (`/api/vod-extract`)
 * mints a short-lived token for each one before it leaves the authenticated
 * request. The TV's `<video>` tag cannot attach a cookie, so the authority has to
 * travel in the URL — but minting belongs at the boundary that already knows who
 * is asking, not in a pure lookup function.
 */

export interface VodResolveInput {
  tmdbId: number;
  type: "movie" | "tv";
  season?: number;
  episode?: number;
}

/**
 * Wrap an upstream URL in our same-origin proxy.
 *
 * Exported because the ordering and playability contract is worth testing directly:
 * a change here silently breaks every player, and the failure mode (a blank
 * video element) points nowhere near this function.
 */
export function toPlayableUrl(raw: string): string {
  return `/api/vod-stream?url=${encodeURIComponent(raw)}`;
}

/** Absolute http(s) only. A relative or `javascript:` URL in the index would be
 *  handed straight to the proxy, so it is rejected at the boundary. */
function isUsable(s: VodStream): boolean {
  if (!s?.url) return false;
  try {
    const u = new URL(s.url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * HLS first, then progressive mp4.
 *
 * An HLS playlist carries multiple bitrates and lets the player adapt, so it
 * degrades gracefully on a weak connection where a single high-bitrate mp4 just
 * stalls. Order is otherwise preserved, so the index stays in control of which
 * mirror is preferred.
 */
function rank(sources: VodStream[]): VodStream[] {
  return [...sources].sort((a, b) => {
    const aHls = a.kind === "hls" ? 0 : 1;
    const bHls = b.kind === "hls" ? 0 : 1;
    return aHls - bHls;
  });
}

export async function resolveVodStreams(input: VodResolveInput): Promise<string[]> {
  const index = await loadVodIndex();
  if (!index) return [];

  const key = String(input.tmdbId);
  let sources: VodStream[] | undefined;

  if (input.type === "movie") {
    sources = index.movies?.[key];
  } else {
    // A series request without a season/episode has no single answer — return
    // nothing rather than guessing at episode 1, which would silently play the
    // wrong thing.
    if (input.season == null || input.episode == null) return [];
    sources = index.series?.[key]?.[episodeKey(input.season, input.episode)];
  }

  if (!Array.isArray(sources) || sources.length === 0) return [];

  return rank(sources.filter(isUsable)).map((s) => toPlayableUrl(s.url));
}
