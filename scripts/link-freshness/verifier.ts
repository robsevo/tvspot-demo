import type { Candidate, PlaylistMetrics, VerifiedSource } from "./types";
import { withTimeout } from "./util";

// Verification is I/O-bound, but the liveness check hammers relay.example.com with
// two samples per candidate — too much concurrency makes the 2nd sample fail and
// wrongly reject live links. Configurable so it can be dialed down for accuracy.
const VERIFY_CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY) || 10; // high — liveness sleep is idle time, and the hosted runner budget is 900s
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
const VERIFY_BUDGET_MS = Number(process.env.VERIFY_BUDGET_MS) || 2_400_000; // 40 min — reach all 90+ channels with liveness probes

// Circuit breaker, STRIKE-TOLERANT. Skipping a host after a single connection
// blip used to drop ~65 live channels at once: Origin's 94 channels share just 3
// upstream hosts (an upstream host.ddns.net=65, an upstream host.an upstream host.co=22, bgdc.live=7),
// so one transient timeout on a shared upstream blacklisted its entire lineup
// untried — the main reason only 26 of 95 channels survived. Now a host is only
// skipped after DEAD_HOST_STRIKES *separate candidates* fully fail on it (each
// after its own retries). A genuinely-dead scraped host still fails its few
// candidates and gets skipped fast; a shared upstream survives transient blips.
const DEAD_HOST_STRIKES = 3;
const hostStrikes = new Map<string, number>();
function isDeadHost(host: string): boolean {
  return (hostStrikes.get(host) || 0) >= DEAD_HOST_STRIKES;
}
function strikeHost(host: string): void {
  hostStrikes.set(host, (hostStrikes.get(host) || 0) + 1);
}
function deadHostCount(): number {
  let n = 0;
  for (const v of hostStrikes.values()) if (v >= DEAD_HOST_STRIKES) n++;
  return n;
}

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
  metrics?: PlaylistMetrics;
}

/**
 * Read the playlist's shape out of manifest text we already have in hand.
 * Handles both a media playlist (EXTINF segments) and a master playlist
 * (EXT-X-STREAM-INF variants) — for a master we can only learn bandwidth/codecs
 * /variant count, so windowSec stays 0 and bufferScore treats it as unknown
 * rather than bad.
 */
function parseMetrics(text: string): PlaylistMetrics {
  const lines = text.split(/\r?\n/);
  let windowSec = 0;
  let segCount = 0;
  let maxExtinf = 0;
  let target = 0;
  let bandwidth = 0;
  let variants = 0;
  let codecs: string | undefined;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#EXTINF:")) {
      const d = parseFloat(t.slice(8).split(",")[0]);
      if (Number.isFinite(d) && d > 0) {
        windowSec += d;
        segCount++;
        if (d > maxExtinf) maxExtinf = d;
      }
    } else if (t.startsWith("#EXT-X-TARGETDURATION:")) {
      const d = parseFloat(t.slice(22));
      if (Number.isFinite(d) && d > 0) target = d;
    } else if (t.startsWith("#EXT-X-STREAM-INF:")) {
      variants++;
      const bw = /[:,]BANDWIDTH=(\d+)/i.exec(t);
      if (bw) bandwidth = Math.max(bandwidth, parseInt(bw[1], 10));
      const cd = /CODECS="([^"]+)"/i.exec(t);
      if (cd && !codecs) codecs = cd[1].toLowerCase();
    }
  }

  return {
    windowSec: Math.round(windowSec),
    segSec: target || Math.round(maxExtinf * 10) / 10,
    segCount,
    bandwidth,
    variants,
    codecs,
  };
}

/**
 * Predicted resistance to buffering, 0-100, calibrated against OUR player
 * config (components/VideoPlayer.tsx) rather than generic stream quality.
 * Higher = safer. The weights follow directly from settings that already work
 * ~98% of the time, so this ranks streams by how well they fit that envelope:
 *
 *  - liveSyncDuration=36s / liveMaxLatencyDuration=50s: we deliberately play 36s
 *    behind the live edge. A stream whose sliding window is smaller than that
 *    CANNOT be played that way — hls.js clamps to the edge, has no cushion, and
 *    stalls on the first upstream blip. Window is therefore the heaviest term.
 *    The relay's own window is 36x3s=108s, which is the shape we're tuned for.
 *  - maxBufferHole=1.5 + nudge: sub-second gaps are already survivable, so we
 *    don't punish moderate segment lengths — but 10s+ segments make failover and
 *    seeking coarse, and one lost segment is a 10s hole.
 *  - TV memory diet (maxBufferSize=25MB, maxBufferLength=30): seconds-of-cushion
 *    per byte matters more than picture quality. A 12Mbps stream fills the TV's
 *    25MB cap in ~17s, well under the 30s we ask for, so it buffers where a
 *    4Mbps stream coasts. High bitrate is a real penalty on the Samsung target.
 *  - hls.js/MSE on the TV's Chromium 63: HEVC and AC-3/E-AC-3 do not decode.
 *    Those are unplayable, not merely risky.
 *  - An ABR ladder lets the player shed bitrate under congestion instead of
 *    stalling, so multi-variant earns a bonus.
 */
export function bufferScore(s: {
  live?: boolean;
  tier: number;
  latencyMs: number;
  origin?: string;
  metrics?: PlaylistMetrics;
}): number {
  let score = 0;

  // 1. Liveness — an edge that actually advances (0-30).
  if (s.live) score += 30;

  // 2. Window vs our 36s look-back (0-30). The single best predictor.
  const w = s.metrics?.windowSec ?? 0;
  if (w === 0) score += 12; // unknown (master playlist) — neutral, don't punish
  else if (w >= 90) score += 30; // relay-class: full cushion + look-back
  else if (w >= 60) score += 25;
  else if (w >= 40) score += 17; // just covers liveSync, little slack
  else if (w >= 25) score += 8; // will ride the edge
  else score += 0; // < 25s: cannot support our config at all

  // 3. Proven segment delivery (0-15). Tier 3 = we actually pulled a TS segment
  //    with a valid sync byte, not just a playlist that parses.
  score += s.tier >= 3 ? 15 : s.tier >= 2 ? 8 : 0;

  // 4. Bitrate vs the TV's 25MB buffer cap (0-10).
  const bw = s.metrics?.bandwidth ?? 0;
  if (bw === 0) score += 6; // unknown — neutral
  else if (bw <= 4_000_000) score += 10; // ~50s of cushion inside 25MB
  else if (bw <= 6_000_000) score += 8;
  else if (bw <= 9_000_000) score += 4;
  else score += 0; // >9Mbps: TV evicts buffer faster than we fill it

  // 5. Segment granularity (0-5). 2-6s is the sweet spot for our maxBufferHole
  //    and for fast failover; 10s+ segments make every loss a 10s hole.
  const seg = s.metrics?.segSec ?? 0;
  if (seg === 0) score += 3;
  else if (seg >= 2 && seg <= 6) score += 5;
  else if (seg <= 9) score += 3;
  else score += 1;

  // 6. Handshake latency (0-5) — a proxy for path quality to the origin.
  const lat = s.latencyMs || 0;
  if (lat > 0 && lat < 300) score += 5;
  else if (lat < 800) score += 3;
  else if (lat < 2000) score += 1;

  // 7. ABR ladder (0-5) — room to downshift instead of stalling.
  if ((s.metrics?.variants ?? 0) > 1) score += 5;

  // Hard penalties: codecs the TV's Chromium 63 cannot decode at all. These
  // sources may verify perfectly from a Node runner and still play nothing on
  // the actual Samsung target, so push them below everything playable.
  const codecs = s.metrics?.codecs || "";
  if (/hvc1|hev1|av01|vp9/.test(codecs)) score -= 45;
  if (/ac-3|ec-3|mp4a\.a[56]/.test(codecs)) score -= 25;

  return Math.max(0, Math.min(100, score));
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

    return { tier: 2, latencyMs, metrics: parseMetrics(text) };
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

/** Resolve the first non-comment line of a playlist to an absolute URL. */
function firstSegmentLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return null;
}

/**
 * BLOCKING segment check: does an actual media segment load? Catches the
 * "playlist looks live but segments 404" case (e.g. the 24/7 mains.services
 * channels: the m3u8 advances but every .ts 404s with an HTML error). The
 * verifier must mirror what the player can fetch — a stream whose segments we
 * can't load is dead for us, no matter how healthy its playlist looks.
 * Tolerant of master playlists (drills one level into the first variant) and of
 * a transient live-edge 404 (one retry on the freshest segment).
 */
async function segmentLoads(playlistUrl: string): Promise<boolean> {
  try {
    let url = playlistUrl;
    let { text } = await fetchGet(url, TIMEOUT_LONG);
    if (!text.trimStart().startsWith("#EXTM3U")) return false;
    // Master → drill into the first variant playlist.
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const v = firstSegmentLine(text);
      if (!v) return false;
      try { url = new URL(v, url).href; } catch { return false; }
      ({ text } = await fetchGet(url, TIMEOUT_LONG));
      if (!text.trimStart().startsWith("#EXTM3U")) return false;
    }
    // VOD playlist (ENDLIST) with segments is inherently fine.
    const segs = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!segs.length) return false;
    const target = segs[segs.length - 1]; // freshest segment (live edge)
    let segUrl: string;
    try { segUrl = new URL(target, url).href; } catch { return false; }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_SHORT);
        const r = await fetch(segUrl, {
          headers: { Range: "bytes=0-65535", "User-Agent": "tvspot-link-freshness/1.0" },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (r.status === 200 || r.status === 206) {
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (/html|json|text\/plain/.test(ct)) return false; // error page disguised as a segment
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length === 0) { await sleep(1500); continue; }
          // Real media: MPEG-TS sync byte, or an ISO/fMP4 box, or a video CT.
          const tag = buf.toString("ascii", 4, 8);
          if (buf[0] === 0x47) return true;
          if (["ftyp", "styp", "moof", "moov"].includes(tag)) return true;
          if (/video|mp2t|octet-stream|mpegurl/.test(ct)) return true;
          // Obfuscated (fake image header) is still real media behind it — accept.
          if (buf[0] === 0x89 && buf[1] === 0x50) return true;
          return false;
        }
        if (r.status === 404 || r.status >= 500) { await sleep(1500); continue; } // live edge may have moved
        return false; // 403/401 → we can't fetch it → dead for us
      } catch { await sleep(1000); }
    }
    return false;
  } catch {
    return false;
  }
}

// Raised from 10 → 16 so the deeper backend candidate pool (now 1 primary + up to
// 9 backups per channel) actually gets verified, letting the active 5 fill with more
// live-verified links. Still bounded so a channel's verify work + heap stays sane.
const MAX_CANDIDATES_PER_CHANNEL = 16; // bound work + heap per channel
const LIVENESS_PROBE_CAP = 3;          // max liveness probes per channel
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
  if (isDeadHost(host)) return null;

  // Retry the load check. relay.example.com transiently 403s and has ~30-40s
  // outage windows even on healthy streams (measured 2026-06-28), so a single
  // shot wrongly rejects live channels mid-blip — the main reason most channels
  // were missing from the verified list. Retry with backoff; connection-level
  // failures count as a strike against the host (skipped only after several
  // separate candidates fail — see DEAD_HOST_STRIKES).
  let t1: TierResult | undefined;
  let t2: TierResult | undefined;
  let connErr = false;
  const LOAD_TRIES = 3;
  for (let attempt = 1; attempt <= LOAD_TRIES; attempt++) {
    // Another candidate may have pushed this host over the strike limit mid-loop.
    if (isDeadHost(host)) return null;
    t1 = await tier1_check(c.verifyUrl);
    if (t1.error) {
      connErr = isConnectionError(t1.error);
    } else {
      connErr = false;
      t2 = await tier2_parse(c.verifyUrl);
      if (!t2.error) break; // loaded cleanly
    }
    if (attempt < LOAD_TRIES) await sleep(2500); // transient relay blip — back off
  }
  if (!t1 || t1.error || !t2 || t2.error) {
    // One strike per candidate that failed at the connection level (not per
    // retry) — so a 65-channel shared upstream isn't killed by a single blip.
    if (connErr) strikeHost(host);
    return null;
  }

  const latencyMs = t2.latencyMs || t1.latencyMs;
  const t3 = await tier3_attempt(c.verifyUrl, latencyMs);

  // BLOCKING segment gate: a playlist that parses + advances but whose segments
  // 404 is dead for the player (the scraped 24/7 mains.services case). Drop it so
  // we never store an unplayable "live-looking" source. Only run on the bounded
  // liveness-probed set (it's an extra fetch); benched/extra links keep the old
  // load-only bar so we don't over-prune the reserve.
  //
  // EXCEPTION: the catalog's OWN curated links (origin "catalog") are what the app
  // itself serves and plays — they're vouched-for. Their per-segment probe still
  // transiently 403s/times-out under relay throttle (many channels share 3
  // upstreams), which was wrongly dropping ~60 live channels. So for a trusted
  // catalog origin, tier1+tier2 (playlist loads with real segments) is the bar; the
  // segment fetch only RANKS (sets `live`), never gates. Scraped/untrusted
  // origins keep the strict blocking gate.
  const trusted = c.origin === "catalog";
  if (doLiveness && !trusted && !(await segmentLoads(c.verifyUrl))) return null;

  // Liveness as a RANKING flag, not a gate. The "plays ~15s then drops" source
  // stalls here (edge doesn't advance) → live:false, so it sorts to the bench;
  // but we still keep it (it loads) rather than delete a possibly-flaky link.
  // Only probed for the first few per channel (the 9s cost is bounded by caller).
  const live = doLiveness ? await checkLiveness(c.verifyUrl) : false;

  const out: VerifiedSource = {
    url: c.storeUrl,
    tier: t3.tier,
    latencyMs: t3.latencyMs,
    verifiedUtc: nowIso,
    firstSeenUtc: c.firstSeenUtc || nowIso,
    origin: c.origin,
    live,
    metrics: t2.metrics,
  };
  out.score = bufferScore(out);
  return out;
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
    // Store-origin candidates already passed liveness in a prior run — skip it
    // entirely (just tier1+tier2 to confirm they still load) so we don't burn
    // 9s of budget per stale entry that's already known-good.
    const doLiveness = c.origin !== "store" && liveProbes < LIVENESS_PROBE_CAP;
    // withTimeout bounds each probe — the undici parser crash can divert a verify
    // fetch's error to uncaughtException and leave it pending, stalling the stage.
    const result = await withTimeout(verifyCandidate(c, nowIso, doLiveness), 30000, null);
    if (result) {
      if (doLiveness) liveProbes++;
      verified.push(result);
      console.error(
        "  %s %s [%s] score=%d (tier=%d, window=%ds, seg=%ss, bw=%dk, latency=%dms)",
        result.live ? "✓live" : "·load", channelSlug, result.origin, result.score ?? 0,
        result.tier, result.metrics?.windowSec ?? 0, result.metrics?.segSec ?? 0,
        Math.round((result.metrics?.bandwidth ?? 0) / 1000), result.latencyMs,
      );
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
  // Reverse: scraped/backend entries first (most likely to add new sources),
  // store entries last (already carried forward by sticky logic). This way
  // the budget prioritizes discovering NEW working sources over re-confirming
  // ones we already know about.
  const entries = [...map.entries()].reverse();
  const total = entries.length;

  for (let i = 0; i < total; i += VERIFY_CONCURRENCY) {
    const elapsed = performance.now() - startMs;
    if (elapsed > VERIFY_BUDGET_MS) {
      console.error(
        "Verifier: hit %ds budget after %d/%d channels — returning %d verified so far (skipping the rest)",
        Math.round(VERIFY_BUDGET_MS / 1000), i, total, results.size,
      );
      break;
    }

    const batch = entries.slice(i, i + VERIFY_CONCURRENCY);
    console.error(
      "Verifier: batch %d/%d (%d channels, %d dead hosts skipped)",
      Math.floor(i / VERIFY_CONCURRENCY) + 1, Math.ceil(total / VERIFY_CONCURRENCY), batch.length, deadHostCount(),
    );

    const batchResults = await Promise.all(
      batch.map(([slug, cands]) => verifyChannelCandidates(slug, cands, nowIso)),
    );

    for (let j = 0; j < batch.length; j++) {
      const r = batchResults[j];
      if (r) {
        // Best-connection-first. bufferScore already folds in liveness, window
        // size, tier, bitrate, segment length and latency weighted for OUR
        // player config, so it replaces the old (live, tier, latency) ordering
        // wholesale. Latency stays as the tiebreak between equal scores.
        r.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.latencyMs - b.latencyMs);
        results.set(batch[j][0], r);
      }
    }

    // Null out processed entries + candidate arrays so GC can reclaim them.
    for (let j = 0; j < batch.length && i + j < total; j++) entries[i + j] = null as any;
    for (const [slug] of batch) map.delete(slug);

    if (typeof gc === "function") gc();
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