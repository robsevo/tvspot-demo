#!/usr/bin/env node
/**
 * Generate the demo content layer: data/channels.json, data/verified-sources.json
 * and data/vod-index.json.
 *
 * WHY THIS IS A SCRIPT AND NOT THREE CHECKED-IN BLOBS
 * ---------------------------------------------------
 * The three files are generated so their *provenance* is reviewable. Anyone can
 * read this file and see exactly which URLs the demo plays and where they come
 * from, instead of scrolling a few hundred lines of JSON and taking it on faith.
 * Regenerating is `npm run demo:data`.
 *
 * WHAT IT PLAYS
 * -------------
 * Only openly-licensed or explicitly-public test media:
 *
 *   - Blender Foundation open movies (Big Buck Bunny, Sintel, Tears of Steel),
 *     released under CC-BY. https://studio.blender.org/films/
 *   - Mux's public HLS test streams (test-streams.mux.dev), published for
 *     exactly this purpose.
 *   - Apple's HLS reference stream ("BipBop"), from Apple's streaming examples.
 *   - W3C sample media (media.w3.org).
 *
 * Every URL here was reachable when this file was written. They are third-party
 * hosts, so some will eventually rot — which is the entire point of the
 * link-freshness pipeline in `scripts/link-freshness/`. Run it and it will drop
 * whatever has died and keep what still plays.
 *
 * REPLACING THIS WITH YOUR OWN CONTENT
 * ------------------------------------
 * Edit CHANNELS / TITLES below and re-run, or point the app at your own service
 * with BACKEND_API_URL and the pipeline at your own catalogue with CATALOG_URL.
 * Nothing else in the app assumes anything about where content comes from.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "../data");

/** Fixed timestamp so regenerating produces a byte-identical file unless the
 *  content actually changed. A generator that rewrites its output on every run
 *  turns `git status` into noise and hides real edits. */
const STAMP = "2026-01-01T00:00:00.000Z";

/**
 * Demo channels. Several sources each, on purpose: the failover, health-probe
 * and source-ranking code paths only do anything visible when there is more
 * than one option, and a demo where every channel has exactly one source
 * exercises none of the interesting logic.
 */
const CHANNELS = [
  {
    slug: "open-movies-24-7",
    name: "Open Movies 24/7",
    category: "Entertainment",
    sources: [
      { url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", label: "multi-bitrate" },
      { url: "https://test-streams.mux.dev/pts_shift/master.m3u8", label: "mirror" },
    ],
  },
  {
    slug: "reference-hls",
    name: "Reference HLS",
    category: "Technology",
    sources: [
      {
        url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
        label: "fMP4",
      },
    ],
  },
  {
    slug: "tears-of-steel-tv",
    name: "Tears of Steel TV",
    category: "Movies",
    sources: [
      { url: "https://test-streams.mux.dev/tos_ismc/main.m3u8", label: "primary" },
      { url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", label: "backup" },
    ],
  },
  {
    slug: "mux-demo",
    name: "Mux Demo",
    category: "Technology",
    sources: [
      {
        url: "https://stream.mux.com/v69RSHhFelSm4701snP22dYz2jICy4E4FUyk02rW4gxRM.m3u8",
        label: "primary",
      },
    ],
  },
];

/**
 * Demo on-demand titles, keyed by TMDB id so artwork and metadata join cleanly.
 * All Blender open movies (CC-BY) or W3C sample media.
 */
const TITLES = [
  {
    tmdbId: 10378,
    title: "Big Buck Bunny",
    year: "2008",
    overview:
      "A giant rabbit with a heart bigger than himself takes revenge on three " +
      "rodents tormenting the forest. Blender Foundation, released under CC-BY.",
    sources: [
      {
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        label: "1080p HLS",
        kind: "hls",
      },
      { url: "https://media.w3.org/2010/05/bunny/movie.mp4", label: "480p", kind: "mp4" },
    ],
  },
  {
    tmdbId: 45745,
    title: "Sintel",
    year: "2010",
    overview:
      "A lone warrior searches for the dragon she raised from a hatchling. " +
      "Blender Foundation, released under CC-BY.",
    sources: [
      {
        url: "https://download.blender.org/durian/trailer/sintel_trailer-1080p.mp4",
        label: "1080p",
        kind: "mp4",
      },
      { url: "https://media.w3.org/2010/05/sintel/trailer.mp4", label: "720p", kind: "mp4" },
    ],
  },
  {
    tmdbId: 133704,
    title: "Tears of Steel",
    year: "2012",
    overview:
      "A group of warriors and scientists gather at the Oude Kerk in Amsterdam " +
      "to stage a crucial event. Blender Foundation, released under CC-BY.",
    sources: [
      { url: "https://test-streams.mux.dev/tos_ismc/main.m3u8", label: "HLS", kind: "hls" },
    ],
  },
];

// --------------------------------------------------------------------------
// data/channels.json — the catalogue the link-freshness pipeline matches against
// --------------------------------------------------------------------------
const channelsCatalog = CHANNELS.map((c) => ({
  name: c.name,
  online: true,
  category: c.category,
  primary_url: c.sources[0].url,
  backup_urls: c.sources.slice(1).map((s) => s.url),
}));

// --------------------------------------------------------------------------
// data/verified-sources.json — what the app reads at runtime
//
// Shaped exactly like real pipeline output, so the app cannot tell the demo
// data from a genuine run. `tier: 1` and a plausible latency stand in for
// measurements the pipeline would take; re-running the pipeline replaces these
// with real ones.
// --------------------------------------------------------------------------
const verified = {
  meta: {
    generated_utc: STAMP,
    pipeline_version: 2,
    sources: { demo: { entries: CHANNELS.length, status: "ok" } },
    streams_verified: CHANNELS.reduce((n, c) => n + c.sources.length, 0),
    vod_verified: TITLES.reduce((n, t) => n + t.sources.length, 0),
  },
  channels: Object.fromEntries(
    CHANNELS.map((c) => [
      c.slug,
      {
        name: c.name,
        sources: c.sources.map((s, i) => ({
          url: s.url,
          tier: 1,
          latencyMs: 250 + i * 90,
          verifiedUtc: STAMP,
          firstSeenUtc: STAMP,
          origin: "catalog",
          live: true,
          score: 90 - i * 10,
        })),
      },
    ]),
  ),
};

// --------------------------------------------------------------------------
// data/vod-index.json
// --------------------------------------------------------------------------
const vodIndex = {
  generated_utc: STAMP,
  movies: Object.fromEntries(
    TITLES.map((t) => [
      String(t.tmdbId),
      t.sources.map((s) => ({ url: s.url, label: s.label, kind: s.kind })),
    ]),
  ),
  series: {},
};

// --------------------------------------------------------------------------
// data/vod-catalog.json — browse metadata for the on-demand titles.
//
// Kept separate from vod-index.json on purpose: the index is *where a title
// plays from* and changes whenever a source rots, while this is *what a title
// is* and essentially never changes. One file rewritten nightly, one file
// rewritten when the catalogue actually changes.
//
// No `poster` field: artwork needs a TMDB token, and the UI already falls back
// to a readable text card without one. A demo that renders broken images is
// worse than one that renders no images.
// --------------------------------------------------------------------------
const DEMO_SERVICE = "Open Movies";
const vodCatalog = {
  services: [DEMO_SERVICE],
  summary: {
    [DEMO_SERVICE]: {
      movies_count: TITLES.length,
      series_count: 0,
      preview: TITLES.map((t) => ({ tmdb_id: t.tmdbId, name: t.title })),
    },
  },
  movies: TITLES.map((t) => ({
    tmdb_id: t.tmdbId,
    title: t.title,
    year: t.year,
    overview: t.overview,
    service: DEMO_SERVICE,
    media_type: "movie",
  })),
  series: [],
};

mkdirSync(DATA, { recursive: true });
const out = [
  ["channels.json", channelsCatalog],
  ["verified-sources.json", verified],
  ["vod-index.json", vodIndex],
  ["vod-catalog.json", vodCatalog],
];
for (const [name, body] of out) {
  const path = resolve(DATA, name);
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
  console.log(`wrote data/${name}`);
}
console.log(
  `\n${CHANNELS.length} channels, ${TITLES.length} on-demand titles, ` +
    `${verified.meta.streams_verified} live sources.`,
);
