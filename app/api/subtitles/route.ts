import { NextRequest, NextResponse } from "next/server";
import { langInfo, type SubtitleTrack } from "@/lib/subtitles";

/**
 * VOD subtitle discovery.
 *
 *   GET /api/subtitles?type=movie&tmdbId=286217
 *   GET /api/subtitles?type=series&tmdbId=1396&season=1&episode=1
 *   → { tracks: [{ id, lang, label, url }] }
 *
 * Our VOD sources carry no captions of their own (verified: h264+aac HLS, no
 * SUBTITLES playlist, no CEA-608 in the segments), so subtitles come from the
 * Stremio OpenSubtitles v3 addon — the only provider surveyed that needs no API
 * key. It's keyed by IMDB id and our catalog is keyed by TMDB, so step one is
 * mapping the id across via TMDB external_ids.
 *
 * `url` points back at our own /api/subtitles/vtt so the browser gets
 * same-origin WebVTT: the provider serves SubRip (which no browser parses) from
 * a third-party host (which CORS would block).
 */

const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN;
const PROVIDER = "https://opensubtitles-v3.strem.io";

/** Keep the CC menu short: at most this many per language, this many total. */
const PER_LANG = 3;
const MAX_TRACKS = 12;
/** Languages listed first. Everything else follows, alphabetically. */
const PREFERRED = ["en"];

interface ProviderSub {
  id?: string;
  url?: string;
  lang?: string;
}

/** TMDB id → IMDB id. Cached hard: this mapping is effectively immutable. */
async function imdbId(type: "movie" | "series", tmdbId: string): Promise<string | null> {
  if (!TMDB_TOKEN) return null;
  const path = type === "movie" ? "movie" : "tv";
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${path}/${encodeURIComponent(tmdbId)}/external_ids`,
      {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
        next: { revalidate: 60 * 60 * 24 * 30 },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.imdb_id;
    return typeof id === "string" && /^tt\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const type = q.get("type") === "series" ? "series" : "movie";
  const tmdbId = q.get("tmdbId") || "";
  const season = q.get("season");
  const episode = q.get("episode");

  if (!/^\d+$/.test(tmdbId)) {
    return NextResponse.json({ error: "bad tmdbId" }, { status: 400 });
  }
  if (type === "series" && (!/^\d+$/.test(season || "") || !/^\d+$/.test(episode || ""))) {
    return NextResponse.json({ error: "series needs season+episode" }, { status: 400 });
  }

  const imdb = await imdbId(type, tmdbId);
  // No IMDB id (or no TMDB token) → no subtitles. An empty list is a normal
  // answer, not an error: the player just won't show a CC button.
  if (!imdb) return NextResponse.json({ tracks: [] });

  const key = type === "series" ? `${imdb}:${season}:${episode}` : imdb;

  let subs: ProviderSub[] = [];
  try {
    const res = await fetch(`${PROVIDER}/subtitles/${type}/${key}.json`, {
      headers: { "User-Agent": "tvspot/1.0" },
      next: { revalidate: 60 * 60 * 6 },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.subtitles)) subs = data.subtitles;
    }
  } catch {
    // Provider down/slow → degrade to "no subtitles", never break playback.
  }

  const byLang = new Map<string, SubtitleTrack[]>();
  for (const s of subs) {
    if (!s?.url || typeof s.url !== "string") continue;
    const [code, name] = langInfo(s.lang || "");
    const list = byLang.get(code) ?? [];
    if (list.length >= PER_LANG) continue;
    // Disambiguate multiples of the same language: OpenSubtitles entries vary in
    // sync quality, so a second/third pick is the user's escape hatch when the
    // first one drifts.
    const label = list.length === 0 ? name : `${name} ${list.length + 1}`;
    list.push({
      id: `${code}-${s.id ?? list.length}`,
      lang: code,
      label,
      url: `/api/subtitles/vtt?u=${encodeURIComponent(s.url)}`,
    });
    byLang.set(code, list);
  }

  const codes = [...byLang.keys()].sort((a, b) => {
    const ia = PREFERRED.indexOf(a);
    const ib = PREFERRED.indexOf(b);
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  const tracks: SubtitleTrack[] = [];
  for (const c of codes) {
    for (const t of byLang.get(c) ?? []) {
      if (tracks.length < MAX_TRACKS) tracks.push(t);
    }
  }

  return NextResponse.json(
    { tracks },
    { headers: { "Cache-Control": "private, max-age=3600" } },
  );
}
