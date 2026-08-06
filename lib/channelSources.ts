import "server-only";
import { channelSlug } from "@/lib/sources";
import { loadVerifiedSources, type VerifiedSources } from "@/lib/linkData";

/**
 * Per-channel verified stream URLs, resolved at REQUEST time.
 *
 * Server-only by design (see lib/linkData.ts): the list is attached to each
 * channel by /api/lounge/live-channels, so the player gets it as ordinary
 * response data instead of a build-baked client chunk.
 */

/**
 * Curated per-channel source overrides, tried BEFORE the nightly-verified links.
 *
 * Some Origin upstreams pipe the WRONG-LANGUAGE feed under a correct English name
 * with nothing to detect it: "HGTV" serves a Portuguese (Brazilian) feed but has
 * an English EPG and no HLS LANGUAGE tag, so the pipeline genuinely can't tell and
 * can't auto-fix it. We pin a known English source here so the player plays IT
 * first; Origin's feed stays only as last-resort failover. The player runtime-
 * verifies every source, so a dead override just falls through. Keyed by
 * channelSlug(). Direct URLs must be CORS-enabled (hls.js fetches them in-browser).
 */
const SOURCE_OVERRIDES: Record<string, string[]> = {
  // HGTV: Origin's feed is Portuguese. Sky NZ HGTV is English + CORS-enabled
  // (verified playing). No free US/CA HGTV stream exists publicly (iptv-org has none).
  hgtv: ["https://i.mjh.nz/.r/sky-hgtv.m3u8"],
};

/**
 * How many verified links we inline per channel on the live-channels response.
 *
 * The players cap their opening probe pool at 20 URLs INCLUDING the backend's
 * own primary/backup links, so shipping the full bench (up to ~40 for a popular
 * channel) would only inflate the payload and the localStorage channel cache on
 * a 1GB TV. Anything past this is still reachable: when the opening probe comes
 * up mostly dead the player calls /api/extra-sources, which serves the whole
 * bench from the same runtime data.
 */
const INLINE_PER_CHANNEL = 10;

function urlsFor(data: VerifiedSources, channelName: string): string[] {
  const slug = channelSlug(channelName);
  const overrides = SOURCE_OVERRIDES[slug] || [];
  const entry = data.channels?.[slug];
  const active = (entry?.sources || []).map((s) => s.url);
  const waiting = (entry?.waiting || []).map((s) => s.url);
  // Order is meaningful: overrides first, then the pipeline's active set — which
  // it ranks best-connection-first (scripts/link-freshness/verifier.ts
  // bufferScore: playlist window vs our 36s liveSync, bitrate vs the TV's buffer
  // cap, segment length, tier, latency) — then the waiting bench as lower-priority
  // failover. Do not re-sort.
  return Array.from(new Set([...overrides, ...active, ...waiting]));
}

/**
 * Best nightly score among a channel's ACTIVE sources, or 0 when unknown.
 *
 * This is the pipeline's own confidence in the links it is handing over —
 * bufferScore from scripts/link-freshness/verifier.ts (playlist window vs our
 * 36s liveSync, bitrate vs the TV's buffer cap, segment length, tier, latency).
 *
 * WHY THE PLAYER WANTS IT: measured across 24 channels on 2026-08-05, the first
 * verified source answered HTTP 200 for 21 of them (88%) — and BOTH failures
 * carried the lowest scores in the sample (25 and 23, against 50-80 for
 * everything that worked). So a weak score is a usable advance warning that this
 * channel's links are thin, available before a single probe has run.
 *
 * The waiting bench is deliberately excluded: it is lower-priority failover, and
 * a strong bench does not make a weak active set any better to lead with.
 */
function confidenceFor(data: VerifiedSources, channelName: string, limit: number): number {
  const entry = data.channels?.[channelSlug(channelName)];
  const scores = (entry?.sources || []).slice(0, limit).map((s) => s.score ?? 0);
  return scores.length ? Math.max(...scores) : 0;
}

/** Verified URLs for one channel, best-first. Never throws. */
export async function getChannelSources(channelName: string): Promise<string[]> {
  try {
    return urlsFor(await loadVerifiedSources(), channelName);
  } catch {
    return [];
  }
}

/**
 * Verified URLs for many channels in one pass — one data load for the whole
 * live-channels response instead of one per channel.
 */
export async function getChannelSourcesMap(
  channelNames: string[],
  limit = INLINE_PER_CHANNEL,
): Promise<{ urls: Record<string, string[]>; confidence: Record<string, number> }> {
  const urls: Record<string, string[]> = {};
  const confidence: Record<string, number> = {};
  try {
    const data = await loadVerifiedSources();
    for (const name of channelNames) {
      const list = urlsFor(data, name).slice(0, limit);
      if (list.length) {
        urls[name] = list;
        confidence[name] = confidenceFor(data, name, limit);
      }
    }
  } catch {
    // Fall through with whatever we have — the backend's own primary/backup
    // links still reach the player, so the grid is never empty because of this.
  }
  return { urls, confidence };
}
