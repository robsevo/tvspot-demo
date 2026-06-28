import type { Candidate, VerifiedSource } from "./types";

const VERIFY_CONCURRENCY = 10; // verification is I/O-bound; 4 was the runtime bottleneck
const TIMEOUT_SHORT = 5000;
const TIMEOUT_LONG = 8000;
// Hard wall-clock ceiling for the whole verify stage. Against dead hosts the
// stage could otherwise run 10+ min and get SIGKILL'd (exit 137); this returns
// whatever passed so far instead of being killed. Tune via VERIFY_BUDGET_MS.
const VERIFY_BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS) || 120_000;

// Circuit breaker: once a host fails at the connection level (DNS/refused/timeout),
// every other candidate on that same host is skipped instantly instead of paying
// the full per-URL timeout again. Dead hosts dominate the candidate set, so this
// is what collapses the stage from minutes to seconds.
const deadHosts = new Set<string>();

function hostKey(url: string): string {
  try {
    const u = new URL(url);
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
      headers: { "User-Agent": "tvspot-link-freshness/1.0" },
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
// Tier 1+2 (host up + valid HLS playlist with segments) is the bar, matching the
// runtime check in lib/stream-verify.ts.

const MAX_CANDIDATES_PER_CHANNEL = 20; // bound work per channel
const MAX_KEEP_PER_CHANNEL = 6;        // keep up to 6 working sources, best-first

/**
 * Verify one candidate by fetching its `verifyUrl` (raw upstream is fastest from
 * Node). On success returns a VerifiedSource carrying the browser-playable
 * `storeUrl`, today's `verifiedUtc`, and the preserved `firstSeenUtc`.
 */
async function verifyCandidate(c: Candidate, nowIso: string): Promise<VerifiedSource | null> {
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

  return {
    url: c.storeUrl,
    tier: t3.tier,
    latencyMs: t3.latencyMs,
    verifiedUtc: nowIso,
    firstSeenUtc: c.firstSeenUtc || nowIso,
    origin: c.origin,
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
  for (const c of unique) {
    const result = await verifyCandidate(c, nowIso);
    if (result) {
      verified.push(result);
      console.error("  ✓ %s [%s] (tier=%d, latency=%dms)", channelSlug, result.origin, result.tier, result.latencyMs);
      if (verified.length >= MAX_KEEP_PER_CHANNEL) break;
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
        // Best-first: higher tier, then lower latency.
        r.sort((a, b) => (b.tier * 100 - b.latencyMs) - (a.tier * 100 - a.latencyMs));
        results.set(batch[j][0], r.slice(0, MAX_KEEP_PER_CHANNEL));
      }
    }
  }

  let totalPassed = 0;
  for (const sources of results.values()) totalPassed += sources.length;
  console.error("Verifier: %d working sources kept across %d channels", totalPassed, results.size);

  return results;
}