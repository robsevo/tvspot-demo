import type { Candidate, VerifiedSource } from "./types";
import { withTimeout } from "./util";

// Verification is I/O-bound, but the liveness check hammers relay.example.com with
// two samples per candidate — too much concurrency makes the 2nd sample fail and
// wrongly reject live links. Configurable so it can be dialed down for accuracy.
const VERIFY_CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY) || 4;
const TIMEOUT_SHORT = 5000;
const TIMEOUT_LONG = 8000;
// Liveness gap: a live HLS edge must produce new segments over time. We sample
// the playlist twice this far apart and require it to advance — this is what
// catches the "plays ~15s then drops" sources (a stale playlist serves a few old
// segments that buffer, then never refreshes). Must exceed one target-duration
// (~6-11s here). Tune via LIVENESS_WAIT_MS; set 0 to disable the check.
const LIVENESS_WAIT_MS = process.env.LIVENESS_WAIT_MS !== undefined
  ? Number(process.env.LIVENESS_WAIT_MS)
  : 9000; // ≥ one max target-duration so even slow-segment edges advance once
// Hard wall-clock ceiling for the whole verify stage. Against dead hosts the
// stage could otherwise run 10+ min and get SIGKILL'd (exit 137); this returns
// whatever passed so far instead of being killed. Tune via VERIFY_BUDGET_MS.
const VERIFY_BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS) || 120_000;

// Circuit breaker: once a host fails at the connection level (DNS/refused/timeout),
// every other candidate on that same host is skipped instantly instead of paying
// the full per-URL timeout again. Dead hosts dominate the candidate set, so this
// is what collapses the stage from minutes to seconds.
const deadHosts = new Set<string>();

// Shared proxy fronts that wrap MANY distinct upstreams as `?u=<upstream>`. We
// must NOT circuit-break on these — one dead upstream would blacklist the whole
// proxy and skip every still-live link behind it (this silently dropped all
// relay-fronted channels: tsn/sportsnet/news). Key on the real upstream instead.
const PROXY_HOSTS = new Set(["relay.example.com", "api.example.com"]);

function hostKey(url: string): string {
  try {
    const u = new URL(url);
    if (PROXY_HOSTS.has(u.host)) {
      const inner = u.searchParams.get("u") || u.searchParams.get("url");
      if (inner) {
        try {
          const iu = new URL(inner);
          return `${iu.protocol}//${iu.host}`;
        } catch { /* fall through to the proxy host */ }
      }
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

/** A connection-level failure (host is down) vs a content problem (host is up). */
function isConnectionError(err: string | undefined): boolean {
  if (!err) return false;
  return /fetch failed|abort|timeout|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(err);
}

const HLS_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegURL",
  "audio/mpegurl",
  "audio/x-mpegurl",
];

function isHlsContentType(ct: string | null): boolean {
  if (!ct) return false;
  const lower = ct.toLowerCase();
  if (lower.includes("html")) return false;
  return HLS_CONTENT_TYPES.some((t) => lower.includes(t.toLowerCase().replace(/^application\//, "")));
}

interface TierResult {
  tier: number;
  latencyMs: number;
  error?: string;
}

async function fetchHead(url: string, timeoutMs: number): Promise<{ status: number; ct: string | null; latencyMs: number }> {
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      headers: { "User-Agent": "tvspot-link-freshness/1.0" },
    });
    const latencyMs = Math.round(performance.now() - start);
    return { status: res.status, ct: res.headers.get("content-type"), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGet(url: string, timeoutMs: number): Promise<{ status: number; ct: string | null; text: string; latencyMs: number }> {
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      // no-cache so the two liveness samples aren't an identical cached playlist
      // (relay/CDN can serve a stale m3u8 within the sampling window).
      headers: { "User-Agent": "tvspot-link-freshness/1.0", "Cache-Control": "no-cache", "Pragma": "no-cache" },
    });
    const ct = res.headers.get("content-type");
    const text = await res.text();
    const latencyMs = Math.round(performance.now() - start);
    return { status: res.status, ct, text, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

/** Tier 1: HEAD check for HLS content-type. Falls back to GET Range if no HEAD support. */
async function tier1_check(url: string): Promise<TierResult> {
  try {
    const { ct, latencyMs } = await fetchHead(url, TIMEOUT_SHORT);

    if (ct && isHlsContentType(ct)) return { tier: 1, latencyMs };

    // Retry with GET + Range for servers that don't support HEAD
    const start = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_SHORT);
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-0", "User-Agent": "tvspot-link-freshness/1.0" },
        signal: ctrl.signal,
      });
      const getCt = res.headers.get("content-type");
      const getLat = Math.round(performance.now() - start);
      if (!isHlsContentType(getCt)) {
        return { tier: 1, latencyMs: getLat, error: `bad content-type: ${getCt}` };
      }
      return { tier: 1, latencyMs: getLat };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { tier: 1, latencyMs: 0, error: String(err) };
  }
}

/** Tier 2: Parse HLS playlist, verify it has actual content. */
async function tier2_parse(url: string): Promise<TierResult> {
  try {
    const { ct, text, latencyMs } = await fetchGet(url, TIMEOUT_LONG);

    if (!isHlsContentType(ct)) {
      return { tier: 2, latencyMs, error: `bad content-type: ${ct}` };
    }

    if (!text.trimStart().startsWith("#EXTM3U")) {
      return { tier: 2, latencyMs, error: "no #EXTM3U header" };
    }

    const lines = text.split(/\r?\n/);
    let hasExtInf = false;
    let hasTsOrChild = false;
    let hasEndlist = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#EXTINF:")) hasExtInf = true;
      if (trimmed.startsWith("#EXT-X-ENDLIST")) hasEndlist = true;
      if (!trimmed.startsWith("#") && /\.[mM]3[uU]8$/.test(trimmed)) hasTsOrChild = true;
      if (!trimmed.startsWith("#") && /\.ts(\?|$)/i.test(trimmed)) hasTsOrChild = true;
    }

    if (!hasExtInf && !hasTsOrChild && hasEndlist) {
      return { tier: 2, latencyMs, error: "empty playlist (ENDLIST only)" };
    }

    if (!hasExtInf && !hasTsOrChild) {
      return { tier: 2, latencyMs, error: "no segments found" };
    }

    return { tier: 2, latencyMs };
  } catch (err) {
    return { tier: 2, latencyMs: 0, error: String(err) };
  }
}

/** Tier 3: Non-blocking — TS segments are often auth-gated on live servers.
 *  Passing tier 1+2 is sufficient for a live HLS stream. */
async function tier3_attempt(url: string, t2latency: number): Promise<TierResult> {
  try {
    const { text } = await fetchGet(url, TIMEOUT_SHORT);

    // Find first TS segment
    let firstTs = "";
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("#") && /\.ts(\?|$)/i.test(trimmed)) {
        firstTs = trimmed;
        break;
      }
    }

    if (!firstTs) {
      // Master playlist with no TS — pass
      return { tier: 3, latencyMs: t2latency };
    }

    let tsUrl = firstTs;
    try {
      tsUrl = new URL(firstTs, url).href;
    } catch { /* use as-is */ }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_SHORT);
    try {
      const byteRes = await fetch(tsUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": "tvspot-link-freshness/1.0" },
        signal: ctrl.signal,
      });
      const buf = Buffer.from(await byteRes.arrayBuffer());
      if (buf.length === 0) {
        // Auth-gated or empty — not a hard failure, accept tier 2 result
        return { tier: 2, latencyMs: t2latency };
      }
      if (buf[0] === 0x47) {
        return { tier: 3, latencyMs: t2latency };
      }
      return { tier: 2, latencyMs: t2latency, error: `bad TS sync byte: 0x${buf[0]?.toString(16)}` };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // TS fetch failed (auth, timeout, etc.) — accept tier 2
    return { tier: 2, latencyMs: t2latency };
  }
}

// Tier 4 (relay.example.com/proxy) was retired — that endpoint now 404s. Reaching
// Tier 1+2 (host up + valid HLS playlist with segments) plus the liveness check
// below is the bar, matching the runtime check in lib/stream-verify.ts.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlaylistState {
  ok: boolean;
  seq: number | null;   // #EXT-X-MEDIA-SEQUENCE
  lastSeg: string;      // last non-comment line (newest segment)
  segCount: number;
  endlist: boolean;     // finite (VOD) playlist
}

/** Fetch a playlist and extract the bits needed to judge whether it's advancing. */
async function fetchPlaylistState(url: string): Promise<PlaylistState> {
  const dead: PlaylistState = { ok: false, seq: null, lastSeg: "", segCount: 0, endlist: false };
  try {
    const { status, text } = await fetchGet(url, TIMEOUT_LONG);
    if (status >= 400 || !text.trimStart().startsWith("#EXTM3U")) return dead;
    let seq: number | null = null;
    let lastSeg = "";
    let segCount = 0;
    let endlist = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        const n = parseInt(line.slice(line.indexOf(":") + 1), 10);
        if (!Number.isNaN(n)) seq = n;
      } else if (line.startsWith("#EXT-X-ENDLIST")) {
        endlist = true;
      } else if (!line.startsWith("#")) {
        lastSeg = line;
        segCount++;
      }
    }
    return { ok: true, seq, lastSeg, segCount, endlist };
  } catch {
    return dead;
  }
}

/**
 * Liveness: a live edge must advance over time. Sample the playlist twice
 * LIVENESS_WAIT_MS apart and require progress. Returns true if:
 *  - the playlist is a finite VOD (ENDLIST) — it plays through, no live edge; or
 *  - the media-sequence advanced; or
 *  - (no usable sequence) the newest segment changed.
 * Returns false if the refresh fails/empties or nothing advanced — that's the
 * stalled-edge source that buffers ~15s then drops.
 */
async function fetchPlaylistStateRetry(url: string, tries: number): Promise<PlaylistState> {
  let st = await fetchPlaylistState(url);
  for (let i = 1; i < tries && !st.ok; i++) {
    await sleep(2500); // transient throttle (relay/proxy under concurrent load) — back off
    st = await fetchPlaylistState(url);
  }
  return st;
}

async function checkLiveness(url: string): Promise<boolean> {
  if (LIVENESS_WAIT_MS <= 0) return true; // disabled
  const a = await fetchPlaylistStateRetry(url, 2);
  if (!a.ok) return false;
  if (a.endlist) return true;
  await sleep(LIVENESS_WAIT_MS);
  // Retry the second sample: a genuinely dead edge stays empty/static, but a
  // transiently throttled one recovers — without this, load caused false
  // negatives (e.g. a live tsn2 link wrongly rejected).
  const b = await fetchPlaylistStateRetry(url, 3);
  if (!b.ok) return false;          // still empty after retries → really stalled
  if (b.endlist) return true;
  const seqAdvanced = a.seq !== null && b.seq !== null && b.seq > a.seq;
  const segChanged = b.lastSeg !== "" && b.lastSeg !== a.lastSeg;
  return seqAdvanced || segChanged; // either signals fresh content
}

const MAX_CANDIDATES_PER_CHANNEL = 25; // bound work per channel
const LIVENESS_PROBE_CAP = 8;          // max liveness probes (the 9s cost) per channel
// No keep-cap here: return ALL loadable links so index.ts can build the sticky
// active set (≤5) + the unbounded waiting bench. The active/waiting split is the
// caller's job, not the verifier's.

/**
 * Verify one candidate by fetching its `verifyUrl` (raw upstream is fastest from
 * Node). On success returns a VerifiedSource carrying the browser-playable
 * `storeUrl`, today's `verifiedUtc`, and the preserved `firstSeenUtc`.
 */
async function verifyCandidate(c: Candidate, nowIso: string, doLiveness: boolean): Promise<VerifiedSource | null> {
  const host = hostKey(c.verifyUrl);
  if (deadHosts.has(host)) return null;

  const t1 = await tier1_check(c.verifyUrl);
  if (t1.error) {
    if (isConnectionError(t1.error)) deadHosts.add(host);
    return null;
  }

  const t2 = await tier2_parse(c.verifyUrl);
  if (t2.error) return null;

  const latencyMs = t2.latencyMs || t1.latencyMs;
  const t3 = await tier3_attempt(c.verifyUrl, latencyMs);

  // Liveness as a RANKING flag, not a gate. The "plays ~15s then drops" source
  // stalls here (edge doesn't advance) → live:false, so it sorts to the bench;
  // but we still keep it (it loads) rather than delete a possibly-flaky link.
  // Only probed for the first few per channel (the 9s cost is bounded by caller).
  const live = doLiveness ? await checkLiveness(c.verifyUrl) : false;

  return {
    url: c.storeUrl,
    tier: t3.tier,
    latencyMs: t3.latencyMs,
    verifiedUtc: nowIso,
    firstSeenUtc: c.firstSeenUtc || nowIso,
    origin: c.origin,
    live,
  };
}

/** Verify a channel's candidate pool, keeping up to MAX_KEEP_PER_CHANNEL working. */
async function verifyChannelCandidates(
  channelSlug: string,
  candidates: Candidate[],
  nowIso: string,
): Promise<VerifiedSource[] | null> {
  // Deduplicate by the URL we'd store; bound the work per channel.
  const seen = new Set<string>();
  const unique = candidates
    .filter((c) => {
      if (seen.has(c.storeUrl)) return false;
      seen.add(c.storeUrl);
      return true;
    })
    .slice(0, MAX_CANDIDATES_PER_CHANNEL);

  const verified: VerifiedSource[] = [];
  let liveProbes = 0;
  for (const c of unique) {
    // Bound the expensive liveness probe to the first LIVENESS_PROBE_CAP loadable
    // links per channel — enough to fill the active 5 with live-verified ones;
    // the rest are still kept (benched) but not liveness-probed.
    const doLiveness = liveProbes < LIVENESS_PROBE_CAP;
    // withTimeout bounds each probe — the undici parser crash can divert a verify
    // fetch's error to uncaughtException and leave it pending, stalling the stage.
    const result = await withTimeout(verifyCandidate(c, nowIso, doLiveness), 30000, null);
    if (result) {
      if (doLiveness) liveProbes++;
      verified.push(result);
      console.error("  %s %s [%s] (tier=%d, latency=%dms)", result.live ? "✓live" : "·load", channelSlug, result.origin, result.tier, result.latencyMs);
    }
  }

  return verified.length > 0 ? verified : null;
}

/**
 * Verify every channel's candidate pool with bounded concurrency and a hard
 * wall-clock budget. Returns the working sources per slug, best-first.
 */
export async function verifyCandidateMap(
  map: Map<string, Candidate[]>,
): Promise<Map<string, VerifiedSource[]>> {
  const results = new Map<string, VerifiedSource[]>();
  const startMs = performance.now();
  const nowIso = new Date().toISOString();
  const entries = [...map.entries()];

  for (let i = 0; i < entries.length; i += VERIFY_CONCURRENCY) {
    const elapsed = performance.now() - startMs;
    if (elapsed > VERIFY_BUDGET_MS) {
      console.error(
        "Verifier: hit %ds budget after %d/%d channels — returning %d verified so far (skipping the rest)",
        Math.round(VERIFY_BUDGET_MS / 1000), i, entries.length, results.size,
      );
      break;
    }

    const batch = entries.slice(i, i + VERIFY_CONCURRENCY);
    console.error(
      "Verifier: batch %d/%d (%d channels, %d dead hosts skipped)",
      Math.floor(i / VERIFY_CONCURRENCY) + 1, Math.ceil(entries.length / VERIFY_CONCURRENCY), batch.length, deadHosts.size,
    );

    const batchResults = await Promise.all(
      batch.map(([slug, cands]) => verifyChannelCandidates(slug, cands, nowIso)),
    );

    for (let j = 0; j < batch.length; j++) {
      const r = batchResults[j];
      if (r) {
        // Rank: live-verified first, then higher tier, then lower latency. Keep
        // ALL loadable links — index.ts splits into active(≤5) + waiting.
        r.sort((a, b) =>
          (b.live ? 1 : 0) - (a.live ? 1 : 0) ||
          (b.tier * 100 - b.latencyMs) - (a.tier * 100 - a.latencyMs),
        );
        results.set(batch[j][0], r);
      }
    }
  }

  let totalPassed = 0;
  let totalLive = 0;
  for (const sources of results.values()) {
    totalPassed += sources.length;
    totalLive += sources.filter((s) => s.live).length;
  }
  console.error("Verifier: %d loadable sources (%d live) across %d channels", totalPassed, totalLive, results.size);

  return results;
}