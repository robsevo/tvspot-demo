/**
 * Generic playlist-URL source adapter.
 *
 * Fetches any number of publicly reachable M3U/M3U8 playlists and parses them
 * into candidate entries. It is configured entirely from the environment and
 * **ships with an empty list on purpose** — this repository does not bundle
 * anyone's playlist URLs. Point it at sources you have the right to use.
 *
 * Configure with a comma- or newline-separated list:
 *
 *   PLAYLIST_URLS="https://example.com/a.m3u8,https://example.org/b.m3u"
 *
 * Optionally label them (`label|url`) so the provenance recorded on each entry
 * is readable in the output file:
 *
 *   PLAYLIST_URLS="regional|https://example.com/a.m3u8"
 *
 * With nothing configured this returns `[]`, which the pipeline treats as "this
 * source contributed nothing" — not as an error. That is the same contract every
 * other adapter honours, and it is why a misconfigured source can never fail a
 * run that other sources are carrying.
 */

import { parseM3u, MAX_M3U_SIZE } from "../m3u";
import type { M3uEntry } from "../types";

const FETCH_TIMEOUT_MS = 30_000;
/** Per-source cap. Keeps one enormous playlist from dominating verification. */
const MAX_ENTRIES = 5_000;

interface PlaylistTarget {
  label: string;
  url: string;
}

function log(msg: string): void {
  console.error("[playlist-url] %s", msg);
}

/**
 * Parse PLAYLIST_URLS into targets, skipping anything that is not a valid
 * absolute http(s) URL. Silently dropping a malformed entry would make a typo
 * look like a dead source, so each rejection is logged.
 */
export function parseTargets(raw: string | undefined): PlaylistTarget[] {
  if (!raw?.trim()) return [];

  const targets: PlaylistTarget[] = [];
  for (const chunk of raw.split(/[\n,]+/)) {
    const item = chunk.trim();
    if (!item) continue;

    // "label|url" or bare "url"
    const pipe = item.indexOf("|");
    const label = pipe > 0 ? item.slice(0, pipe).trim() : "";
    const url = pipe > 0 ? item.slice(pipe + 1).trim() : item;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      log(`skipping malformed URL: ${item.slice(0, 60)}`);
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      log(`skipping non-http(s) URL: ${url.slice(0, 60)}`);
      continue;
    }

    targets.push({ label: label || parsed.hostname, url });
  }
  return targets;
}

async function fetchPlaylist(target: PlaylistTarget): Promise<M3uEntry[]> {
  try {
    const res = await fetch(target.url, {
      headers: { "User-Agent": "tvspot-link-freshness/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`HTTP ${res.status} for ${target.label}`);
      return [];
    }

    const text = await res.text();
    if (text.length > MAX_M3U_SIZE) {
      log(`${target.label}: ${text.length}B exceeds the ${MAX_M3U_SIZE}B cap, skipping`);
      return [];
    }

    const entries = parseM3u(text, `playlist/${target.label}`);
    log(`${target.label}: ${entries.length} entries`);
    return entries.slice(0, MAX_ENTRIES);
  } catch (err) {
    // Never throw: one unreachable playlist must not end the run.
    log(`${target.label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Fetch every configured playlist in parallel and merge, deduped by stream URL. */
export async function fetchPlaylistUrls(): Promise<M3uEntry[]> {
  const targets = parseTargets(process.env.PLAYLIST_URLS);
  if (targets.length === 0) {
    log("no PLAYLIST_URLS configured — contributing nothing (this is fine)");
    return [];
  }

  log(`fetching ${targets.length} playlist(s)`);
  const results = await Promise.all(targets.map(fetchPlaylist));

  const seen = new Set<string>();
  const merged: M3uEntry[] = [];
  for (const entry of results.flat()) {
    if (seen.has(entry.streamUrl)) continue;
    seen.add(entry.streamUrl);
    merged.push(entry);
  }

  log(`${merged.length} unique entries from ${targets.length} playlist(s)`);
  return merged;
}
