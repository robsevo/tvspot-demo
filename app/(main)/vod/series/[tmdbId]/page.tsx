"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { proxyFetch } from "@/lib/api";
import Link from "next/link";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { mergeSources } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { ExternalLink } from "lucide-react";
import type { SeriesDetail } from "@/lib/types";

export default function VodSeriesPage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingEpisode, setPlayingEpisode] = useState<string | null>(null);
  const [episodeSourceIdx, setEpisodeSourceIdx] = useState<Record<string, number>>({});
  const [resolvedByEp, setResolvedByEp] = useState<Record<string, string[]>>({});
  // Seasons start COLLAPSED — tap a season header to expand its episodes.
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});
  const toggleSeason = (n: number) =>
    setExpandedSeasons((prev) => ({ ...prev, [n]: !prev[n] }));

  const resolveEpisode = (epKey: string, season: number, episode: number) => {
    if (!tmdbId) return;
    if (resolvedByEp[epKey] !== undefined) return;
    const warm = getPrewarmed("series", tmdbId, season, episode);
    if (warm) {
      setResolvedByEp((prev) => ({ ...prev, [epKey]: warm }));
      return;
    }
    resolveVod("series", tmdbId, season, episode)
      .then((urls) => setResolvedByEp((prev) => ({ ...prev, [epKey]: urls })))
      .catch(() => setResolvedByEp((prev) => ({ ...prev, [epKey]: [] })));
  };

  useEffect(() => {
    if (!tmdbId) return;
    setLoading(true);
    proxyFetch<SeriesDetail>(`/api/lounge/vod/series/${tmdbId}`)
      .then((d) => setDetail(d))
      .catch((err) => console.error("Series detail fetch failed:", err))
      .finally(() => setLoading(false));
  }, [tmdbId]);

  if (loading) {
    return (
      <div className="pt-3 min-h-screen pb-20 animate-pulse">
        <div className="aspect-[16/9] bg-card mb-4" />
        <div className="px-4 space-y-3">
          <div className="h-6 bg-card rounded w-2/3" />
          <div className="h-4 bg-card rounded w-1/2" />
          <div className="h-32 bg-card rounded" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="pt-3 min-h-screen pb-20 px-4 text-center pt-20">
        <p className="text-text-secondary">Series not found</p>
        <Link href="/vod" className="text-brand text-sm mt-2 inline-block">Back to VOD</Link>
      </div>
    );
  }

  return (
    <div className="pt-3 min-h-screen pb-20 animate-page-rise">
      <Link href="/vod" className="absolute top-14 left-3 z-10 w-9 h-9 rounded-full glass-card flex items-center justify-center">
        <ChevronLeft className="w-5 h-5 text-white" />
      </Link>

      <div className="hud-scan relative aspect-[16/9] mb-4 overflow-hidden">
        {detail.poster ? (
          <img src={detail.poster} alt={detail.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-brand/30 to-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
      </div>

      <div className="px-4 max-w-4xl mx-auto">
        <h1 className="text-white text-xl font-bold mb-2">{detail.title}</h1>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-text-muted text-xs">{detail.year || ""}</span>
          {Number(detail.rating) > 0 && (
            <span className="text-brand text-xs font-medium">{Number(detail.rating).toFixed(1)}</span>
          )}
          <span className="text-text-muted text-xs">{detail.service}</span>
        </div>

        {detail.seasons?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-white text-sm font-semibold mb-3">
              {detail.seasons.length} Season{detail.seasons.length > 1 ? "s" : ""}
            </h2>
            {detail.seasons.map((season) => {
              const open = !!expandedSeasons[season.season_number];
              return (
              <div key={season.season_number} className="mb-3">
                <button
                  onClick={() => toggleSeason(season.season_number)}
                  className="w-full flex items-center justify-between glass-card rounded-xl px-3 py-2.5 mb-2"
                >
                  <h3 className="text-white text-xs font-medium">
                    Season {season.season_number}
                    {season.episodes.length > 0 && (
                      <span className="text-text-muted font-normal ml-1">
                        · {season.episodes.length} episode{season.episodes.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </h3>
                  <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && season.episodes.length > 0 && (
                  <div className="space-y-2">
                    {season.episodes.map((ep, i) => {
                      const epKey = `${season.season_number}-${ep.episode_number}`;
                      const isPlaying = playingEpisode === epKey;
                      // One labeled source list: resolved CLEAN streams FIRST
                      // (default), then the backend "Source N" streams (reserved —
                      // confirmed-working, never crowded out by HD), embeds last.
                      const epResolved = resolvedByEp[epKey] ?? [];
                      const sources = mergeSources(epResolved, ep.stream_urls, ep.embed_urls);
                      const epSrcIdx = Math.min(episodeSourceIdx[epKey] ?? 0, Math.max(0, sources.length - 1));
                      const currentSource = sources[epSrcIdx];
                      // Clean streams resolve on-demand when the row is tapped, so the
                      // WHOLE row is always tappable — no source needs to pre-exist
                      // (vidlink, the old always-present fallback, is gone).
                      return (
                      <div key={i} id={`ep-${epKey}`}>
                      <button
                        onClick={() => {
                          const opening = !isPlaying;
                          setPlayingEpisode(isPlaying ? null : epKey);
                          if (opening) {
                            resolveEpisode(epKey, season.season_number, ep.episode_number);
                          }
                        }}
                        className="w-full flex items-center gap-3 glass-card rounded-xl px-3 py-2.5 text-left hover:bg-card/60 transition-colors"
                      >
                        {ep.still_url ? (
                          <img
                            src={ep.still_url}
                            alt={ep.title}
                            className="w-20 aspect-video rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-20 aspect-video rounded-lg bg-card flex items-center justify-center flex-shrink-0">
                            <svg className="w-4 h-4 text-text-muted" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium truncate">
                            {ep.episode_number}. {ep.title}
                          </p>
                          {ep.overview && (
                            <p className="text-text-muted text-[10px] mt-0.5 line-clamp-2">
                              {ep.overview}
                            </p>
                          )}
                        </div>
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center">
                          <svg className={`w-3.5 h-3.5 text-brand transition-transform ${isPlaying ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        </span>
                      </button>
                      {isPlaying && !currentSource && (
                        <div className="mt-2 rounded-xl bg-black/40 aspect-video flex items-center justify-center">
                          {resolvedByEp[epKey] === undefined ? (
                            <span className="text-text-muted text-xs flex items-center gap-2">
                              <span className="w-4 h-4 rounded-full border-2 border-white/15 border-t-brand animate-spin" />
                              finding clean stream…
                            </span>
                          ) : (
                            <span className="text-text-muted text-xs">No source for this episode</span>
                          )}
                        </div>
                      )}
                      {isPlaying && currentSource && (
                        <div className="mt-2 space-y-2">
                          {/* Source switcher + open-in-new-tab escape hatch.
                              Source buttons open externally like the "Open" button. */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {sources.length > 1 &&
                              sources.map((src, n) => (
                                <a
                                  key={n}
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => {
                                    setEpisodeSourceIdx((prev) => ({ ...prev, [epKey]: n }));
                                  }}
                                  className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                                    epSrcIdx === n
                                      ? "bg-brand text-white hud-glow"
                                      : "glass-card text-text-muted hover:text-white"
                                  }`}
                                >
                                  {src.label}
                                </a>
                              ))}
                            <a
                              href={currentSource.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] px-2.5 py-1 rounded-full bg-card text-text-muted hover:text-white transition-colors flex items-center gap-1 ml-auto"
                              title="If this source won't play here, open it in a new tab"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open
                            </a>
                          </div>
                        </div>
                      )}
                      </div>
                    );
                    })}
                  </div>
                )}
              </div>
            );
            })}
          </div>
        )}

        {(!detail.seasons || detail.seasons.length === 0) && (
          <p className="text-text-secondary text-sm">No season data available</p>
        )}
      </div>
    </div>
  );
}