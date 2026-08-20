/**
 * Channel catalog — the canonical list the pipeline matches discovered streams
 * against.
 *
 * The catalog answers "which channels do we care about?" and is deliberately
 * separate from source discovery, which answers "what streams exist?". Keeping
 * them apart is what lets you swap either side independently: point the catalog
 * at a different service and every source adapter keeps working unchanged.
 *
 * Two backends, checked in order:
 *
 * 1. `CATALOG_URL` — any endpoint returning `{ "channels": [...] }` or a bare
 *    `[...]` array. Send credentials via `CATALOG_AUTH_HEADER` if it needs them.
 * 2. `data/channels.json` — a local file, used when no URL is set. This is the
 *    default, and it is what makes the pipeline runnable offline with no
 *    account anywhere.
 *
 * The shipped `data/channels.json` is a small demo catalog of public-domain and
 * openly-licensed channels. Replace it with your own.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Channel, ChannelsResponse } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

function log(msg: string): void {
  console.error("[catalog] %s", msg);
}

/** Accept both `{channels: [...]}` and a bare array, so a plain JSON file of
 *  channels works without ceremony. */
function coerce(data: unknown): Channel[] {
  if (Array.isArray(data)) return data as Channel[];
  const wrapped = data as ChannelsResponse | null;
  if (wrapped && Array.isArray(wrapped.channels)) return wrapped.channels;
  return [];
}

async function fetchRemote(url: string): Promise<Channel[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // "Name: value" — kept as one opaque string so this module never has to know
  // whether your service wants a Bearer token, a cookie, or an API key header.
  const auth = process.env.CATALOG_AUTH_HEADER;
  if (auth) {
    const idx = auth.indexOf(":");
    if (idx > 0) headers[auth.slice(0, idx).trim()] = auth.slice(idx + 1).trim();
  }

  const res = await fetch(url, {
    headers,
    // A hung socket must not stall the whole nightly run.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`catalog ${url}: ${res.status} ${res.statusText}`);
  return coerce(await res.json());
}

function readLocal(): Channel[] {
  const path = resolve(
    import.meta.dirname || __dirname,
    "../../data/channels.json",
  );
  try {
    return coerce(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err) {
    log(`could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Fetch the channel catalog.
 *
 * Throws when the catalog is empty. That is deliberate: with no catalog there is
 * nothing to match against, so every channel would "lose" all its sources and a
 * run would happily overwrite a good file with an empty one. Failing loudly here
 * is what makes the total-outage guard in the writer a second line of defence
 * rather than the only one.
 */
export async function fetchChannels(): Promise<Channel[]> {
  const url = process.env.CATALOG_URL;

  let channels: Channel[];
  if (url) {
    log(`fetching from ${new URL(url).host}`);
    channels = await fetchRemote(url);
  } else {
    log("no CATALOG_URL set — reading data/channels.json");
    channels = readLocal();
  }

  if (channels.length === 0) {
    throw new Error(
      "catalog is empty — refusing to run. Set CATALOG_URL or populate data/channels.json.",
    );
  }

  log(`${channels.length} channels`);
  return channels;
}
