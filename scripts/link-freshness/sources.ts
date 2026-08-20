/**
 * Source adapter registry for the link-freshness pipeline.
 *
 * Each source implements a fetch() that returns M3uEntry[] — best-effort,
 * never throws. The pipeline runs all enabled sources in parallel and merges
 * the results before matching/verification.
 */

import type { M3uEntry } from "./types";

export interface SourceAdapter {
  /** Unique identifier for this source (used in origin tracking + meta). */
  name: string;
  /** Human-readable label for logging. */
  label: string;
  /** Fetch M3U entries from this source. Must never throw. */
  fetch(): Promise<M3uEntry[]>;
}

export interface SourceDef {
  name: string;
  label: string;
  enabled: boolean;
  priority: number;
}

/** Registry of all known sources. Add new sources here, then wire the adapter
 *  in index.ts (import + SourceAdapter wrapper). */
export const SOURCE_DEFS: SourceDef[] = [
  { name: "iptv_org", label: "iptv-org", enabled: true, priority: 10 },
  { name: "playlist_url", label: "Playlist URLs", enabled: true, priority: 5 },
];

/**
 * `priority` breaks ties when two sources offer the same channel and both
 * verify: the higher number wins the ordering. It is deliberately NOT a quality
 * judgement — measured latency and buffer health decide that (see verifier.ts).
 * Priority only settles otherwise-equal candidates, so a well-regarded source
 * cannot outrank a demonstrably faster stream.
 */