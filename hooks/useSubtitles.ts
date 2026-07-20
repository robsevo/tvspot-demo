"use client";

import { useEffect, useState } from "react";
import type { SubtitleTrack } from "@/lib/subtitles";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";

/**
 * External subtitle tracks for a VOD title.
 *
 * Live TV doesn't use this — those streams carry their own CEA-608 captions,
 * which hls.js surfaces without help. VOD sources carry nothing embedded, so
 * tracks are looked up by TMDB id (see /api/subtitles) and handed to the player
 * as <track> children.
 *
 * Failure is silent by design: no subtitles is a normal outcome (obscure title,
 * provider down), and it must never disturb playback — the player simply won't
 * show a CC button.
 */
export function useSubtitles(
  type: "movie" | "series",
  tmdbId: string | number | undefined,
  season?: number,
  episode?: number,
): SubtitleTrack[] {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);

  useEffect(() => {
    if (!tmdbId) {
      setTracks([]);
      return;
    }
    if (type === "series" && (season === undefined || episode === undefined)) {
      setTracks([]);
      return;
    }

    // A stale response from a previously-opened episode must not attach the
    // wrong subtitles to the one now on screen.
    let cancelled = false;
    setTracks([]);

    const params = new URLSearchParams({ type, tmdbId: String(tmdbId) });
    if (type === "series") {
      params.set("season", String(season));
      params.set("episode", String(episode));
    }

    fetchWithDeadline(`/api/subtitles?${params.toString()}`, {}, DEADLINE.normal)
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.tracks)) setTracks(d.tracks);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [type, tmdbId, season, episode]);

  return tracks;
}
