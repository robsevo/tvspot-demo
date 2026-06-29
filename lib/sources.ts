/**
 * Helpers for labeling third-party VOD embed/stream sources.
 *
 * The catalog's embed URLs point at public embed aggregators (vidlink, 2embed,
 * etc.). Their uptime, geo-availability, and whether they permit <iframe>
 * embedding all vary and are outside our control — so the UI labels each source
 * by provider (instead of "Source 1/2/3") and always offers an open-in-new-tab
 * escape hatch for providers that frame-bust or refuse embedding.
 */

import verifiedSources from "@/data/verified-sources.json";

/**
 * URL-safe channel slug. Replaces EVERY non-alphanumeric run (incl. "/" in
 * "24/7 South Park") with "-" so the slug is a single URL path segment. Must be
 * the one source of truth used for both link generation and route matching —
 * otherwise channels with "/" or other punctuation 404.
 */
export function channelSlug(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
 * Verified stream URLs for a channel from the freshness pipeline output.
 * Curated overrides first, then the active set (≤5, live-verified, what the site
 * relies on), then the waiting bench as lower-priority failover — the player
 * de-dupes, live-checks, and auto-picks a working one, so surfacing more just
 * gives it more to try.
 */
export function getChannelSources(channelName: string): string[] {
  try {
    const slug = channelSlug(channelName);
    const overrides = SOURCE_OVERRIDES[slug] || [];
    const entry = (verifiedSources as any).channels?.[slug];
    const active = entry ? (entry.sources || []).map((s: { url: string }) => s.url) : [];
    const waiting = entry ? (entry.waiting || []).map((s: { url: string }) => s.url) : [];
    return Array.from(new Set([...overrides, ...active, ...waiting]));
  } catch {
    return [];
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  "vidlink.pro": "Vidlink",
  "moviesapi.club": "MoviesAPI",
  "2embed.cc": "2Embed",
  "2embed.to": "2Embed",
  "multiembed.mov": "MultiEmbed",
  "streamingnow.mov": "MultiEmbed",
  "nontongo.win": "Nontongo",
  "pstream.org": "Pstream",
  "vidsrc.to": "VidSrc",
  "vidsrc.me": "VidSrc",
  "vidsrc.net": "VidSrc",
  "vidsrc.xyz": "VidSrc",
  "vidsrc.pro": "VidSrc",
  "vidsrc.sbs": "VidSrc",
  "movie-src.xyz": "MovieSrc",
  "embed.su": "Embed.su",
  "autoembed.co": "AutoEmbed",
  "superembed.stream": "SuperEmbed",
  "smashystream.com": "SmashyStream",
  "vidsrc.cc": "VidSrc",
};

/** Human-friendly provider name for an embed URL, e.g. "Vidlink". */
export function providerName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (PROVIDER_NAMES[host]) return PROVIDER_NAMES[host];
    // Fall back to the registrable-ish domain (drop subdomains), title-cased.
    const parts = host.split(".");
    const base = parts.length >= 2 ? parts[parts.length - 2] : host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Source";
  }
}
