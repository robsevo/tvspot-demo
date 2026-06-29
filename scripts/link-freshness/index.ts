#!/usr/bin/env npx tsx
/**
 * TVSpot Link Freshness Pipeline
 *
 * Daily automated pipeline that:
 * 1. Runs source adapters (iptv-org, GitHub M3U, Reddit) in parallel
 * 2. Fetches example.com channels and fuzzy-matches streams
 * 3. Verifies streams with tiered testing (existing list + backend + matched)
 * 4. Optionally verifies VOD links
 * 5. Writes verified-sources.json atomically
 *
 * Usage:
 *   npx tsx scripts/link-freshness/index.ts            # full pipeline
 *   npx tsx scripts/link-freshness/index.ts --dry-run  # no output file
 *   npx tsx scripts/link-freshness/index.ts --vod      # include VOD verification
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local manually (no dotenv dependency)
try {
  const envPath = resolve(import.meta.dirname || __dirname, "../../.env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env.local is optional
}

import { fetchIptvOrg } from "./sources/iptv-org";
import { fetchGithubM3u } from "./sources/github-m3u";
import { fetchReddit } from "./reddit";
import { fetchChannels } from "./Origin";
import { matchChannels } from "./matcher";
import { verifyCandidateMap } from "./verifier";
import { writeAtomic, readExisting } from "./store";
import { scrapeVod } from "./vod";
import { toPlayableUrl, slugify } from "./playable";
import type { VerifiedSources, VerifiedChannel, Candidate } from "./types";

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_VOD = process.argv.includes("--vod");

// The scrape hits hostile/malformed IPTV servers; some trip an assertion deep in
// Node's HTTP parser that surfaces as an uncaught exception and would otherwise
// kill the whole run (losing all progress). Log and keep going — a single bad
// response must never take down the nightly refresh. The 8s per-request abort
// timeouts ensure the offending fetch still settles.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] %s", err instanceof Error ? err.message : String(err));
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] %s", reason instanceof Error ? reason.message : String(reason));
});

/** Per-channel cap on scraped candidates fed into verification. */
const MAX_SCRAPED_PER_CHANNEL = 10;

function now(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log("[%s] %s", ts, msg);
}

function error(msg: string, err?: unknown): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.error("[%s] ERROR: %s", ts, msg);
  if (err instanceof Error) {
    console.error("  %s", err.message);
  } else if (err) {
    console.error("  %s", String(err));
  }
}

async function main(): Promise<void> {
  const started = performance.now();

  log("=== TVSpot Link Freshness Pipeline ===");
  if (DRY_RUN) log("DRY RUN — will not write output file");

  // Scraping is best-effort: if Reddit yields nothing (the common case — most
  // posted credentials are already dead), we still re-test the existing list and
  // the backend's links below. So scrape failures degrade to "no fresh links"
  // rather than aborting the whole nightly refresh.

  // Stage 1: Run all source adapters in parallel, best-effort.
  log("Stage 1: Running source adapters (iptv-org, GitHub M3U, Reddit)...");
  const sourceAdapters = [
    { name: "iptv_org", label: "iptv-org", fetch: fetchIptvOrg },
    { name: "github", label: "GitHub M3U", fetch: fetchGithubM3u },
    { name: "reddit", label: "Reddit", fetch: fetchReddit },
  ];

  const results = await Promise.allSettled(
    sourceAdapters.map(async (s) => {
      const entries = await s.fetch();
      // Tag every entry with its origin source
      for (const e of entries) {
        e.attrs.source = s.name;
      }
      return { name: s.name, label: s.label, entries };
    }),
  );

  // Per-source stats for PipelineMeta
  const sourceStats: Record<string, { entries: number; status: "ok" | "failed" }> = {};
  for (let i = 0; i < sourceAdapters.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      sourceStats[r.value.name] = { entries: r.value.entries.length, status: "ok" };
    } else {
      sourceStats[sourceAdapters[i].name] = { entries: 0, status: "failed" };
      error(`  ${sourceAdapters[i].label} failed: ${String(r.reason)}`);
    }
  }

  // Merge and dedupe by stream URL
  const seen = new Set<string>();
  const m3uEntries = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const e of r.value.entries) {
      if (!seen.has(e.streamUrl)) {
        seen.add(e.streamUrl);
        m3uEntries.push(e);
      }
    }
  }

  for (const [name, stat] of Object.entries(sourceStats)) {
    log(`  ${name}: ${stat.entries} entries (${stat.status})`);
  }
  log(`  Merged: ${m3uEntries.length} unique streams from ${sourceAdapters.length} sources`);

  // Stage 4: Fetch example.com channels (the links currently on site).
  log("Stage 4: Fetching example.com channels...");
  let channels: Awaited<ReturnType<typeof fetchChannels>> = [];
  try {
    channels = await fetchChannels();
  } catch (err) {
    error("Channel fetch failed (re-testing existing list only)", err);
  }
  log(`  Fetched ${channels.length} channels`);

  // Stage 5: Fuzzy match
  log("Stage 5: Matching channels...");
  const matches = matchChannels(m3uEntries, channels);
  log(`  Matched ${matches.length} channels`);

  // Stage 6: Build the candidate pool per channel — the existing dated list,
  // plus the links currently on the backend, plus freshly scraped links.
  log("Stage 6: Building candidate pool (existing list + backend + scraped)...");

  const existing = readExisting();
  const candidateMap = new Map<string, Candidate[]>();
  const nameBySlug = new Map<string, string>();

  const add = (slug: string, c: Candidate): void => {
    const list = candidateMap.get(slug);
    if (list) list.push(c);
    else candidateMap.set(slug, [c]);
  };

  // 1) Existing store first (active + waiting bench) — so dedupe keeps its
  //    preserved firstSeenUtc and benched links get re-tested for promotion.
  let storeCount = 0;
  if (existing?.channels) {
    for (const [slug, vc] of Object.entries(existing.channels)) {
      nameBySlug.set(slug, vc.name);
      for (const s of [...(vc.sources || []), ...(vc.waiting || [])]) {
        add(slug, { verifyUrl: s.url, storeUrl: s.url, origin: "store", firstSeenUtc: s.firstSeenUtc || s.verifiedUtc });
        storeCount++;
      }
    }
  }

  // 2) Links currently on the backend (primary + backups).
  let backendCount = 0;
  for (const ch of channels) {
    if (!ch.name) continue;
    const slug = slugify(ch.name);
    nameBySlug.set(slug, ch.name); // backend name is authoritative
    const urls = [ch.primary_url, ...(ch.backup_urls || [])].filter((u): u is string => Boolean(u));
    for (const u of urls) {
      add(slug, { verifyUrl: u, storeUrl: u, origin: "backend" });
      backendCount++;
    }
  }

  // 3) Freshly matched links from source adapters — raw upstream verified for speed,
  //    stored wrapped (api.example.com/stream-proxy) so they play in the browser.
  let scrapedCount = 0;
  for (const match of matches) {
    const slug = slugify(match.channelName);
    if (!nameBySlug.has(slug)) nameBySlug.set(slug, match.channelName);
    for (const e of match.candidates.slice(0, MAX_SCRAPED_PER_CHANNEL)) {
      const origin = (e.attrs.source as Candidate["origin"]) || "iptv_org";
      add(slug, { verifyUrl: e.streamUrl, storeUrl: toPlayableUrl(e.streamUrl), origin });
      scrapedCount++;
    }
  }

  log(`  Candidates: ${storeCount} from list, ${backendCount} from backend, ${scrapedCount} scraped across ${candidateMap.size} channels`);

  // Release heavy stage 1-6 data before verification. The merged M3U entries,
  // channel list, and matches all live in main() scope — combined with the
  // verifier's playlist buffers they exceed Node's 4 GB heap and get OOM-killed.
  m3uEntries.length = 0;
  channels.length = 0;
  matches.length = 0;

  // Stage 7: Re-test every candidate; keep the working ones (best-first, ≤6).
  log("Stage 7: Verifying candidates (this may take a while)...");
  let verified: Awaited<ReturnType<typeof verifyCandidateMap>>;
  try {
    verified = await verifyCandidateMap(candidateMap);
  } catch (err) {
    error("Stream verification failed", err);
    process.exit(1);
  }

  let totalVerified = 0;
  for (const sources of verified.values()) totalVerified += sources.length;
  log(`  Kept ${totalVerified} loadable sources across ${verified.size} channels`);

  // Build output — per channel, split loadable links into a STICKY active set
  // (≤5) plus an unbounded waiting bench. Stickiness preserves whatever was
  // active before (so a working channel is never torn out on a flaky run); empty
  // active slots are filled from the rest, live-verified first.
  const ACTIVE_CAP = 5;
  const channelsSection: Record<string, VerifiedChannel> = {};
  let activeTotal = 0;
  let waitingTotal = 0;

  for (const [slug, loadable] of verified) {
    if (!loadable.length) continue;

    // URLs that were active in the previous run (preserve their order).
    const prevActiveUrls = (existing?.channels?.[slug]?.sources || []).map((s) => s.url);
    const byUrl = new Map(loadable.map((s) => [s.url, s]));

    const active: typeof loadable = [];
    const taken = new Set<string>();
    // 1) Keep previously-active links that are still loadable (sticky — no replace).
    for (const url of prevActiveUrls) {
      if (active.length >= ACTIVE_CAP) break;
      const s = byUrl.get(url);
      if (s && !taken.has(url)) { active.push(s); taken.add(url); }
    }
    // 2) Fill remaining slots from the rest (already ranked live-first).
    for (const s of loadable) {
      if (active.length >= ACTIVE_CAP) break;
      if (!taken.has(s.url)) { active.push(s); taken.add(s.url); }
    }
    // 3) Everything else loadable → waiting bench (keep all).
    const waiting = loadable.filter((s) => !taken.has(s.url));

    activeTotal += active.length;
    waitingTotal += waiting.length;
    channelsSection[slug] = {
      name: nameBySlug.get(slug) || slug,
      sources: active,
      ...(waiting.length ? { waiting } : {}),
    };
  }

  log(`  Active ${activeTotal} (≤5/ch) + waiting ${waitingTotal} across ${Object.keys(channelsSection).length} channels`);

  // Release heavy stage 7 data before VOD — verified Map holds all tier results,
  // candidateMap holds 400+ candidates with metadata. VOD needs its own heap room.
  verified.clear();
  candidateMap.clear();
  nameBySlug.clear();

  const output: VerifiedSources = {
    meta: {
      generated_utc: now(),
      pipeline_version: 2,
      sources: sourceStats,
      streams_verified: totalVerified,
      vod_verified: 0,
    },
    channels: channelsSection,
  };

  // Stage 8: VOD (optional, on-demand)
  if (INCLUDE_VOD) {
    log("Stage 8: Scraping VOD direct-stream links...");
    try {
      const vodResult = await scrapeVod();
      output.meta.vod_verified = vodResult.totalVerified;
      output.meta.last_vod_scrape_utc = now();

      if (vodResult.items.length > 0) {
        const scrapedMap: Record<string, any> = {};
        for (const item of vodResult.items) {
          const key = item.type === "movie"
            ? `${item.tmdb_id}`
            : `${item.tmdb_id}-s${item.season}-e${item.episode}`;
          scrapedMap[key] = item;
        }
        output.vod = {
          movies: existing?.vod?.movies ?? {},
          scraped: scrapedMap,
        };
      }

      log(
        `  VOD: ${vodResult.totalExtracted} extracted, ${vodResult.totalVerified} verified across ${vodResult.items.length} items`,
      );
    } catch (err) {
      error("VOD scrape failed (continuing without VOD links)", err);
    }
  }

  const elapsed = Math.round(performance.now() - started);

  // Stage 9: Write output
  const existingCount = existing?.channels ? Object.keys(existing.channels).length : 0;
  const newCount = Object.keys(channelsSection).length;

  if (DRY_RUN) {
    log("DRY RUN complete — would write:");
    log(JSON.stringify(output.meta, null, 2));
  } else if (newCount === 0 && existingCount > 0) {
    // Safety net: a total outage (everything failed to verify) must not wipe the
    // accumulated list. Keep last night's list and try again tomorrow.
    error(`Refresh produced 0 working channels but the existing list has ${existingCount} — keeping the old list (likely a transient outage).`);
  } else {
    log("Stage 9: Writing verified-sources.json...");
    writeAtomic(output);
    log(`  Written ${newCount} channels to data/verified-sources.json`);
  }

  log(`=== Pipeline complete in ${Math.round(elapsed / 1000)}s ===`);
}

main().catch((err) => {
  console.error("Pipeline crashed:", err);
  process.exit(1);
});