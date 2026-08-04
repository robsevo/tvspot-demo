import type { Channel } from "@/lib/types";

/**
 * The ONE failover source list for a live channel, shared by the guide preview
 * and both full players (web + TV).
 *
 * WHY IT'S SHARED: the preview and the player used to build this list with
 * separate (near-identical) copies of the merge, which was fine while the only
 * difference was the cap — but "what the preview is playing" is now handed to
 * the player by URL (see lib/previewHandoff), and that handoff only lands if
 * both sides produce the SAME string for the same stream.
 *
 * WHY THE DEDUPE IS KEYED, NOT STRING-EQUAL: the same upstream stream can reach
 * us in two encodings — the nightly verifier may store it as
 * `relay.example.com/m3u8?u=https%3A%2F%2Fhost%2Flive%2F…` while the backend serves
 * `…?u=http%3A%2F%2Fhost%3A8080%2Flive%2F…`. A `new Set()` on the raw strings
 * keeps both, which would have the probe open two connections to one
 * connection-limited panel for a single feed.
 *
 * MEASURED SCOPE, 2026-08-04: on the lineup the backend serves today this
 * collapses NOTHING that plain string-dedupe doesn't already catch — 0 extra
 * sources across all 126 channels (raw 2265 → 1628 by string, 1628 by key). Both
 * lists currently use the same `http://host:port` encoding. So this is
 * insurance against the encodings diverging again, not a live fix, and it is not
 * where the probe's cost goes: after dedupe a channel still carries 12.9 sources
 * on average and up to 20. Do not credit it with more than that.
 */

/**
 * The upstream panel behind a relay-wrapped URL, e.g.
 * `https://relay.example.com/m3u8?u=http%3A%2F%2F1tvnow.icu%3A8080%2F…` -> `1tvnow.icu`.
 *
 * Every source we probe is relay-wrapped, so the relay's own hostname tells us
 * nothing — the connection limit, and the latency, live on the panel inside `u`.
 * Shared by the server probe (which serialises per panel) and the client (which
 * shards a probe round per panel), so both agree on what "one panel" means.
 */
export function upstreamHost(url: string): string {
  try {
    const outer = new URL(url);
    const inner = outer.searchParams.get("u") || outer.searchParams.get("url");
    return inner ? new URL(inner).hostname : outer.hostname;
  } catch {
    return url;
  }
}

/** Group urls by upstream panel, preserving input order within each group and
 *  ordering the groups by their first appearance. */
export function groupByHost(urls: string[]): string[][] {
  const byHost = new Map<string, string[]>();
  for (const u of urls) {
    const h = upstreamHost(u);
    const bucket = byHost.get(h);
    if (bucket) bucket.push(u);
    else byHost.set(h, [u]);
  }
  return [...byHost.values()];
}

/**
 * Identity of the STREAM behind a source URL, for de-duplication.
 *
 * Wrapped sources (`relay.example.com/m3u8?u=…`, `api.example.com/stream-proxy?url=…`)
 * key on **proxy host + upstream host/path**, dropping the upstream's scheme,
 * port and the wrapper's rotating `t` token — those vary between the backend's
 * copy and the verifier's copy of one stream. The proxy host stays IN the key on
 * purpose: two different proxies in front of the same upstream are genuinely
 * different network paths and both are worth keeping as failover.
 */
export function sourceKey(raw: string): string {
  try {
    const u = new URL(raw);
    const innerRaw = u.searchParams.get("u") || u.searchParams.get("url");
    if (innerRaw) {
      const inner = new URL(innerRaw);
      return `${u.hostname.toLowerCase()}|${inner.hostname.toLowerCase()}${inner.pathname}`;
    }
    // Unwrapped/direct source: scheme and port off, query kept (it can carry a
    // per-stream token that is part of the stream's identity).
    return `${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    // Not a parseable URL — fall back to exact-string identity.
    return raw;
  }
}

/** Add `extra` to `base`, skipping anything that is the same stream as one
 *  already in the list, and cap the result. Used for the waiting-bench URLs the
 *  players pull in when the first probe round comes up short. */
export function appendSources(base: string[], extra: string[], cap: number): string[] {
  const seen = new Set(base.map(sourceKey));
  const out = [...base];
  for (const u of extra) {
    if (out.length >= cap) break;
    const k = sourceKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out.slice(0, cap);
}

/**
 * Sources best-first: nightly-verified links, then the backend's live links.
 * De-duped by stream identity (see sourceKey) and capped.
 *
 * The verified list rides along on the channel (attached by
 * /api/lounge/live-channels) rather than being bundled into the client — see
 * lib/linkData.ts for why that matters.
 */
export function channelSourceList(
  channel: Channel | null | undefined,
  cap: number,
): string[] {
  if (!channel) return [];
  const merged = [
    ...(channel.verified_sources || []),
    channel.primary_url,
    ...(channel.backup_urls || []),
  ].filter((u): u is string => Boolean(u));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of merged) {
    const k = sourceKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}
