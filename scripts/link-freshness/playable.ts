/**
 * Turning a stream URL into something the browser can actually play, and
 * slugifying channel names the same way the runtime does.
 */

const BACKEND = (process.env.BACKEND_API_URL || "https://api.example.com").replace(/\/+$/, "");

/** Hosts whose URLs are already browser-playable (CORS + segment rewriting). */
const PLAYABLE_HOSTS = ["relay.example.com", "api.example.com"];

/**
 * Browser-playable form of a stream URL.
 *
 * Backend links (relay.example.com/m3u8?…&t=token) and anything already pointing
 * at our own proxy are returned untouched. Raw upstream IPTV URLs are wrapped in
 * the backend stream-proxy, which adds `Access-Control-Allow-Origin: *` and
 * rewrites the playlist's segment URLs back through itself — without this, hls.js
 * fails on raw hosts that send no CORS headers.
 */
export function toPlayableUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (PLAYABLE_HOSTS.includes(host)) return rawUrl;
  } catch {
    return rawUrl; // not a URL we can parse — leave as-is
  }
  return `${BACKEND}/stream-proxy?url=${encodeURIComponent(rawUrl)}`;
}

/** URL-safe channel slug — must match lib/sources.ts `channelSlug`. */
export function slugify(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
