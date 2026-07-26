/**
 * Helpers for labeling third-party VOD embed/stream sources.
 *
 * The catalog's embed URLs point at public embed aggregators (vidlink, 2embed,
 * etc.). Their uptime, geo-availability, and whether they permit <iframe>
 * embedding all vary and are outside our control — so the UI labels each source
 * by provider (instead of "Source 1/2/3") and always offers an open-in-new-tab
 * escape hatch for providers that frame-bust or refuse embedding.
 *
 * THIS MODULE IS IMPORTED BY CLIENT COMPONENTS — keep it free of link data.
 * It used to `import verified-sources.json` for getChannelSources(), which put
 * the entire nightly link list (~480KB) into a client chunk and made every
 * nightly refresh a forced reload for every open client. That lookup now lives
 * in lib/channelSources.ts (server-only, reads lib/linkData at request time) and
 * reaches the player as `channel.verified_sources` off /api/lounge/live-channels.
 */

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
 * Helper to construct an Internet Archive embed URL.
 */
export function iaEmbedUrl(identifier: string): string {
  return `https://archive.org/embed/${identifier}`;
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

/**
 * Embed providers we refuse to surface. Vidlink (vidlink.pro) is pulled per the
 * "take out vidlink" call — its in-iframe ad overlays survive our sandboxing and
 * the clean direct-stream resolver (provider-a via Origin + IPTV) now covers its slot.
 */
const BLOCKED_EMBED_HOSTS = new Set(["vidlink.pro"]);

/** Drop blocked embed providers (e.g. vidlink) from a backend embed_urls list. */
export function filterEmbeds(urls: string[] | undefined | null): string[] {
  return (urls || []).filter((u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      return !BLOCKED_EMBED_HOSTS.has(host);
    } catch {
      return false;
    }
  });
}

/** Human-friendly provider name for an embed URL, e.g. "Vidlink". */
export function providerName(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("archive.org")) return "Internet Archive";
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (PROVIDER_NAMES[host]) return PROVIDER_NAMES[host];
    // Fall back to the registrable-ish domain (drop subdomains), title-cased.
    const parts = host.split(".");
    const base = parts.length >= 2 ? parts[parts.length - 2] : host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Source";
  }
}

/** Constructs an Internet Archive embed URL from an identifier. */
export function getIAEmbedUrl(identifier: string): string {
  return `https://archive.org/embed/${identifier}`;
}

export interface PlayableSource {
  url: string;
  kind: "stream" | "embed";
  label: string;
}

/**
 * Build the player's failover source list for a VOD title/episode, shared by the
 * movie and series pages so they stay in sync.
 *
 * Backend direct streams ("Source N", from detail/ep.stream_urls) LEAD, for two
 * reasons:
 *  1. They're present from the first render (the detail fetch), while the HD
 *     streams resolve asynchronously a few seconds later. Keeping them first means
 *     `sources[0]` is STABLE across that async update — so the active source never
 *     changes out from under an already-playing video, which would remount the
 *     player (key={url}) and restart playback from zero. That "restart every time"
 *     the HD streams arrived was the whole complaint.
 *  2. They're confirmed-working.
 * HD (clean, castable, ad-free) follow as one-tap alternatives; embeds last.
 * Previously HD led and `.slice(0, 6)` also dropped every Source once six HD
 * resolved — putting Source first fixes both. De-duped by URL, cap 12 (raised
 * from 8 alongside the resolver's total: more one-tap fallbacks, same play cost
 * — only the chosen source ever streams).
 */
export function mergeSources(
  resolved: string[],
  backendStreams: string[] | undefined | null,
  embedUrls: string[] | undefined | null,
): PlayableSource[] {
  const CAP = 12;
  const MAX_BACKEND = 4;
  const streams: PlayableSource[] = (backendStreams ?? []).slice(0, MAX_BACKEND).map((url, i) => ({
    url,
    kind: "stream",
    label: `Source ${i + 1}`,
  }));
  const hd: PlayableSource[] = resolved.map((url, i) => ({
    url,
    kind: "stream",
    label: `HD ${i + 1}`,
  }));
  const embeds: PlayableSource[] = filterEmbeds(embedUrls).map((url) => ({
    url,
    kind: "embed",
    label: providerName(url),
  }));
  // Source N first (stable default), HD next (fills remaining slots), embeds last.
  const seen = new Set<string>();
  return [...streams, ...hd, ...embeds]
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .slice(0, CAP);
}
