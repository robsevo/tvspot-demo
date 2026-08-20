/**
 * iptv-org source adapter — US/CA public community-maintained streams.
 *
 * Two ingestion paths from the same project:
 * 1. REST API (streams.json) — structured JSON, filtered by channel ID suffix (.us/.ca)
 * 2. M3U country slices (us.m3u, ca.m3u) — M3U playlists
 *
 * Outputs are merged and deduped by stream URL.
 */

import { parseM3u } from "../m3u";
import type { M3uEntry } from "../types";

const STREAMS_API = "https://iptv-org.github.io/api/streams.json";
const M3U_US = "https://iptv-org.github.io/iptv/countries/us.m3u";
const M3U_CA = "https://iptv-org.github.io/iptv/countries/ca.m3u";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_STREAMS = 5_000; // per source cap — US API has ~5K, CA ~1K

interface IptvStream {
  channel: string;
  url: string;
  quality?: string;
  referrer?: string;
  userAgent?: string;
  status?: string;
}

function log(msg: string): void {
  console.error("[iptv-org] %s", msg);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "tvspot-link-freshness/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    log(`API ${res.status} for ${url.slice(0, 60)}`);
    return null;
  }
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "tvspot-link-freshness/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    log(`M3U ${res.status} for ${url.slice(0, 60)}`);
    return null;
  }
  return res.text();
}

/** Fetch from the JSON API, filter US/CA by channel ID suffix, map to M3uEntry[]. */
async function fetchFromApi(): Promise<M3uEntry[]> {
  const data = await fetchJson<IptvStream[]>(STREAMS_API);
  if (!data || !Array.isArray(data)) {
    log("API returned no data");
    return [];
  }

  return data
    .filter((s) => {
      if (!s.url || !s.channel) return false;
      // Channel IDs end with .tld — filter US/CA: ESPN.us, CityTV.ca, etc.
      const c = s.channel.toLowerCase();
      return c.endsWith(".us") || c.endsWith(".ca");
    })
    .slice(0, MAX_STREAMS)
    .map((s) => ({
      channelName: s.channel,
      streamUrl: s.url,
      sourceName: "iptv-org/api",
      attrs: {
        ...(s.quality ? { quality: s.quality } : {}),
        ...(s.referrer ? { referrer: s.referrer } : {}),
        ...(s.userAgent ? { "user-agent": s.userAgent } : {}),
        country: s.channel.endsWith(".us") ? "US" : "CA",
        source: "iptv-org",
      },
    }));
}

/** Fetch an M3U country slice, parse, map sourceName. */
async function fetchM3uSlice(url: string, label: string): Promise<M3uEntry[]> {
  const text = await fetchText(url);
  if (!text) return [];

  const entries = parseM3u(text, `iptv-org/${label}`);
  // Rewrite sourceName to be consistent with the API path.
  for (const e of entries) {
    e.sourceName = `iptv-org/${label}`;
    e.attrs.source = "iptv-org";
  }
  return entries.slice(0, MAX_STREAMS);
}

/** Entry point — fetch both API + M3U slices, merge, dedupe by URL. */
export async function fetchIptvOrg(): Promise<M3uEntry[]> {
  try {
    log("fetching US/CA streams...");
    const [apiEntries, usEntries, caEntries] = await Promise.all([
      fetchFromApi(),
      fetchM3uSlice(M3U_US, "us"),
      fetchM3uSlice(M3U_CA, "ca"),
    ]);

    // Merge + dedupe by stream URL (API takes precedence).
    const seen = new Set<string>();
    const merged: M3uEntry[] = [];

    for (const e of apiEntries) {
      if (!seen.has(e.streamUrl)) {
        seen.add(e.streamUrl);
        merged.push(e);
      }
    }
    for (const e of [...usEntries, ...caEntries]) {
      if (!seen.has(e.streamUrl)) {
        seen.add(e.streamUrl);
        merged.push(e);
      }
    }

    log(`API: ${apiEntries.length}, US M3U: ${usEntries.length}, CA M3U: ${caEntries.length} → ${merged.length} unique streams`);
    return merged;
  } catch (err) {
    log(`failed: ${String(err)}`);
    return [];
  }
}