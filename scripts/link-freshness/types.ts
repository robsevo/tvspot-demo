/** Pipeline-specific types for the link-freshness tool. */

export interface CredentialSet {
  source: string; // where the creds came from (post ID or URL)
  server: string;
  username: string;
  password: string;
}

export interface M3uEntry {
  channelName: string;
  streamUrl: string;
  credentialSource: string;
  /** Original #EXTINF line attributes (tvg-id, tvg-name, group-title, etc.) */
  attrs: Record<string, string>;
}

export interface MatchResult {
  channelName: string; // example.com channel name
  channelSlug: string; // slugified for JSON key
  candidates: M3uEntry[]; // all M3U entries that matched this channel
}

export interface VerifiedSource {
  /** Playable URL (browser-ready: relay-wrapped or stream-proxy-wrapped). */
  url: string;
  tier: number; // 1-4
  latencyMs: number;
  /** Last time this URL was tested OK (ISO). */
  verifiedUtc: string;
  /** First time this URL ever passed (ISO) — preserved across nightly runs. */
  firstSeenUtc?: string;
  /** Where the link came from: the backend channel list, the Reddit scrape,
   *  or carried over from a previous run's store. */
  origin?: "backend" | "scraped" | "store";
}

/** A candidate link to test: verify one URL, store another (raw vs wrapped). */
export interface Candidate {
  /** URL to fetch when testing (raw upstream is fastest from Node). */
  verifyUrl: string;
  /** Browser-playable URL to persist if the test passes. */
  storeUrl: string;
  origin: "backend" | "scraped" | "store";
  /** Carried forward from a prior run, if this URL was already in the store. */
  firstSeenUtc?: string;
}

export interface VerifiedChannel {
  name: string;
  sources: VerifiedSource[]; // max 6, sorted best first
}

export interface VerifiedMovie {
  tmdb_id: number;
  title: string;
  embed_urls: string[];
  stream_urls: string[];
}

export interface PipelineMeta {
  generated_utc: string;
  pipeline_version: number;
  reddit_posts_checked: number;
  credentials_found: number;
  m3u_streams_total: number;
  channels_matched: number;
  streams_verified: number;
  vod_verified: number;
}

export interface VerifiedSources {
  meta: PipelineMeta;
  channels: Record<string, VerifiedChannel>;
  vod?: {
    movies: Record<string, VerifiedMovie>;
  };
}

// Re-exported for convenience
export interface Channel {
  name: string;
  online: boolean;
  category?: string;
  logo?: string;
  logo_url?: string;
  primary_url?: string;
  backup_urls?: string[];
}

export interface ChannelsResponse {
  channels: (Channel & { programs?: unknown[] })[];
}