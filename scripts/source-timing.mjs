/**
 * Measure what a live tune-in actually costs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every source-selection change is justified by a timing claim ("the pass takes
 * six seconds", "the first verdict lands in 400ms"), and until this script those
 * claims were unfalsifiable. It replays exactly what the client does at tune-in
 * — merge verified + backend links, dedupe by stream identity, shard per
 * upstream panel, probe each playlist under the same 6s budget — and reports the
 * three numbers that decide how the player feels:
 *
 *   first verdict      when ANY source is judged        → when the row can react
 *   first working      when a PLAYABLE source is known  → when auto-pick is right
 *   full pass          when the slowest panel answers   → what `settled` waits for
 *
 * The gap between "first working" and "full pass" is the cost of the old design,
 * where badges, the display re-sort and the bench expansion all waited for the
 * slowest panel. PASS_REVEAL_MS exists to cap it; this prints what it saves.
 *
 * Usage:
 *   node scripts/source-timing.mjs                # a default sample of channels
 *   node scripts/source-timing.mjs CBC "TSN 1"    # specific channels
 *   node scripts/source-timing.mjs --all          # the whole lineup (slow)
 */

import { readFileSync } from "node:fs";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";
/** Mirrors lib/stream-verify.ts DEFAULT_TIMEOUT_MS. */
const PROBE_TIMEOUT_MS = 6000;
/** Mirrors hooks/useStreamCheck.ts PASS_REVEAL_MS. */
const PASS_REVEAL_MS = 2500;
/** Mirrors ChannelPlayer's channelSourceList(channel, 20). */
const SOURCE_CAP = 20;
/** Mirrors hooks/useStreamCheck.ts PROBE_CONCURRENCY. */
const SHARD_CONCURRENCY = 16;

const DEFAULT_SAMPLE = ["CBC", "CTV", "CNN", "TSN 1", "Sportsnet West"];

/** lib/liveSources.ts upstreamHost — the panel inside a relay-wrapped URL. */
function upstreamHost(url) {
  try {
    const outer = new URL(url);
    const inner = outer.searchParams.get("u") || outer.searchParams.get("url");
    return inner ? new URL(inner).hostname : outer.hostname;
  } catch {
    return url;
  }
}

/** lib/liveSources.ts sourceKey — stream identity, for dedupe. */
function sourceKey(raw) {
  try {
    const u = new URL(raw);
    const innerRaw = u.searchParams.get("u") || u.searchParams.get("url");
    if (innerRaw) {
      const inner = new URL(innerRaw);
      return `${u.hostname.toLowerCase()}|${inner.hostname.toLowerCase()}${inner.pathname}`;
    }
    return `${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

/** lib/sources.ts channelSlug, close enough for matching the verified file. */
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** lib/liveSources.ts channelSourceList. */
function channelSourceList(verified, channel, cap) {
  const merged = [...verified, channel.primary_url, ...(channel.backup_urls || [])].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const u of merged) {
    const k = sourceKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}

/** lib/liveSources.ts groupByHost. */
function groupByHost(urls) {
  const byHost = new Map();
  for (const u of urls) {
    const h = upstreamHost(u);
    const bucket = byHost.get(h);
    if (bucket) bucket.push(u);
    else byHost.set(h, [u]);
  }
  return [...byHost.values()];
}

/**
 * lib/stream-verify.ts checkStream, in miniature: reachable + HLS content-type
 * + a playlist that lists at least one segment. Resolves, never rejects.
 */
async function checkStream(url) {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "tvspot-stream-check/1.0" },
      cache: "no-store",
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const busy = res.status === 456 || res.status === 429;
      return { url, ok: false, busy, latencyMs, reason: busy ? "busy" : `http ${res.status}` };
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("html") || ct.includes("json") || !ct.includes("mpegurl")) {
      return { url, ok: false, latencyMs, reason: "not a stream" };
    }
    const body = (await res.text()).trimStart();
    if (!body.startsWith("#EXTM3U")) return { url, ok: false, latencyMs, reason: "invalid playlist" };
    const hasSeg = body.split(/\r?\n/).some((l) => {
      const line = l.trim();
      if (!line) return false;
      if (line.startsWith("#EXTINF")) return true;
      return !line.startsWith("#") && (/\.m3u8(\?|$)/i.test(line) || /\.ts(\?|$)/i.test(line));
    });
    if (!hasSeg) return { url, ok: false, latencyMs, reason: "empty stream" };
    return { url, ok: true, latencyMs, reason: "ok" };
  } catch {
    const latencyMs = Date.now() - start;
    return { url, ok: false, latencyMs, reason: ctrl.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One probe pass, sharded exactly like the client: one request per panel,
 * SEQUENTIAL within a panel (connection limits), parallel across panels up to
 * SHARD_CONCURRENCY. Records when each verdict landed relative to pass start.
 */
async function runPass(urls) {
  const shards = groupByHost(urls);
  const t0 = Date.now();
  const events = [];
  let next = 0;
  const worker = async () => {
    while (next < shards.length) {
      const shard = shards[next++];
      for (const u of shard) {
        const r = await checkStream(u);
        events.push({ ...r, at: Date.now() - t0 });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SHARD_CONCURRENCY, shards.length) }, worker),
  );
  return { events, totalMs: Date.now() - t0, shardCount: shards.length };
}

function report(name, urls, pass) {
  const { events, totalMs, shardCount } = pass;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const firstVerdict = sorted[0]?.at ?? null;
  const firstWorking = sorted.find((e) => e.ok)?.at ?? null;
  const workingCount = events.filter((e) => e.ok).length;
  const revealed = events.filter((e) => e.at <= PASS_REVEAL_MS).length;
  const revealedOk = events.filter((e) => e.at <= PASS_REVEAL_MS && e.ok).length;

  console.log(`\n${name}`);
  console.log(`  ${urls.length} sources over ${shardCount} panels`);
  console.log(`  first verdict   ${fmt(firstVerdict)}`);
  console.log(`  first working   ${fmt(firstWorking)}`);
  console.log(`  full pass       ${fmt(totalMs)}   (${workingCount} working)`);
  // The cap only bites when the pass would otherwise still be running at it.
  // A pass that finishes first reveals naturally and saves nothing.
  const saved = totalMs - PASS_REVEAL_MS;
  const capNote =
    saved <= 0
      ? " — pass beat the cap, revealed on completion"
      : firstWorking !== null && firstWorking <= PASS_REVEAL_MS
        ? ` — saves ${fmt(saved)} of blank badges`
        : ` — saves ${fmt(saved)}, but nothing playable known yet`;
  console.log(`  at reveal cap   ${revealed}/${urls.length} verdicts, ${revealedOk} working${capNote}`);
  const slow = [...events].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 2);
  for (const s of slow) {
    console.log(`  slowest panel   ${String(s.latencyMs).padStart(5)}ms  ${s.reason.padEnd(14)} ${upstreamHost(s.url)}`);
  }
}

const fmt = (ms) => (ms === null ? "  never" : `${String(ms).padStart(5)}ms`);

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const wanted = args.filter((a) => !a.startsWith("--"));

  let verifiedFile;
  try {
    verifiedFile = JSON.parse(readFileSync(new URL("../data/verified-sources.json", import.meta.url), "utf8"));
  } catch {
    console.error("data/verified-sources.json not readable — run from the repo root.");
    process.exit(1);
  }
  const verifiedBySlug = new Map(
    Object.entries(verifiedFile.channels || {}).map(([slug, v]) => [
      slug,
      (v.sources || []).map((s) => s.url),
    ]),
  );

  const res = await fetch(`${BACKEND}/lounge/live-channels`);
  if (!res.ok) {
    console.error(`backend ${res.status} — is ${BACKEND} up?`);
    process.exit(1);
  }
  const { channels } = await res.json();

  const picked = all
    ? channels
    : (wanted.length ? wanted : DEFAULT_SAMPLE)
        .map((n) => channels.find((c) => c.name === n))
        .filter(Boolean);

  if (picked.length === 0) {
    console.error("no matching channels. Names are case-sensitive, e.g. \"TSN 1\".");
    process.exit(1);
  }

  console.log(`probe budget ${PROBE_TIMEOUT_MS}ms · reveal cap ${PASS_REVEAL_MS}ms · ${picked.length} channel(s)`);

  const totals = [];
  for (const ch of picked) {
    const verified = verifiedBySlug.get(slugify(ch.name)) || [];
    const urls = channelSourceList(verified, ch, SOURCE_CAP);
    if (urls.length === 0) continue;
    const pass = await runPass(urls);
    report(ch.name, urls, pass);
    const firstWorking = [...pass.events].sort((a, b) => a.at - b.at).find((e) => e.ok)?.at ?? null;
    totals.push({ name: ch.name, total: pass.totalMs, firstWorking });
  }

  const withWorking = totals.filter((t) => t.firstWorking !== null);
  if (withWorking.length > 1) {
    const avgTotal = Math.round(totals.reduce((s, t) => s + t.total, 0) / totals.length);
    const avgFirst = Math.round(withWorking.reduce((s, t) => s + t.firstWorking, 0) / withWorking.length);
    console.log(`\n${totals.length} channels — mean full pass ${avgTotal}ms, mean first-working ${avgFirst}ms`);
    console.log(`${totals.length - withWorking.length} channel(s) found nothing playable.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
