"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { proxyFetch } from "@/lib/api";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import Link from "next/link";
import { ChevronLeft, ChevronDown, Play } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { providerName, filterEmbeds } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import { ExternalLink } from "lucide-react";
import type { SeriesDetail } from "@/lib/types";

export default function VodSeriesPage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingEpisode, setPlayingEpisode] = useState<string | null>(null);
  const [episodeSourceIdx, setEpisodeSourceIdx] = useState<Record<string, number>>({});
  // Clean direct HLS streams resolved on-demand per episode (ad-free, played in
  // our own VideoPlayer). Keyed by "S-E". Empty/absent → embed iframe fallback.
  const [resolvedByEp, setResolvedByEp] = useState<Record<string, string[]>>({});
  const inFlight = useRef<Set<string>>(new Set());
  // Click-to-play gate for embeds (they autoplay on mount otherwise). Tracks the
  // started embed URL; switching source/episode re-gates. Render-time derive.
  const [startedUrl, setStartedUrl] = useState<string | null>(null);
  // Seasons start COLLAPSED — tap a season header to expand its episodes.
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});
  const toggleSeason = (n: number) =>
    setExpandedSeasons((prev) => ({ ...prev, [n]: !prev[n] }));

  // Resolve a clean direct stream for one episode (once). The sandboxed embed
  // plays instantly meanwhile; when this returns, the clean stream is prepended
  // as the default "HD" source and the player auto-upgrades to it.
  const resolveEpisode = useCallback(
    (epKey: string, season: number, episode: number) => {
      if (!tmdbId) return;
      if (resolvedByEp[epKey] !== undefined || inFlight.current.has(epKey)) return;
      // Instant if a poster prewarm already resolved this episode (S1E1).
      const warm = getPrewarmed("series", tmdbId, season, episode);
      if (warm) {
        setResolvedByEp((prev) => ({ ...prev, [epKey]: warm }));
        return;
      }
      inFlight.current.add(epKey);
      resolveVod("series", tmdbId, season, episode)
        .then((urls) => setResolvedByEp((prev) => ({ ...prev, [epKey]: urls })))
        .catch(() => setResolvedByEp((prev) => ({ ...prev, [epKey]: [] })))
        .finally(() => inFlight.current.delete(epKey));
    },
    [tmdbId, resolvedByEp],
  );

  // Continue Watching, keyed per episode (tmdbId + season + episode). Resume
  // position is captured ONCE per episode-open (into episodeResume) so the ongoing
  // progress writes below don't keep re-seeking the player mid-playback.
  const { items: cwItems, updateProgress } = useContinueWatching();
  const cwRef = useRef(cwItems);
  useEffect(() => { cwRef.current = cwItems; }, [cwItems]);
  const [episodeResume, setEpisodeResume] = useState<Record<string, number | undefined>>({});

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
                      // (default), then any backend direct streams, then the
                      // vidlink embed LAST (safety-net fallback). Capped at 5.
                      // HD1 (the first resolved source) has been unreliable —
                      // prefer HD2+ when there's more than one; keep the sole one.
                      const epResolved = resolvedByEp[epKey] ?? [];
                      const cleanUrls = epResolved.length >= 2 ? epResolved.slice(1) : epResolved;
                      const clean = cleanUrls.map((url, n) => ({
                        url,
                        kind: "stream" as const,
                        label: `HD ${n + 1}`,
                      }));
                      const sources = [
                        ...clean,
                        ...(ep.stream_urls ?? []).map((url, n) => ({
                          url,
                          kind: "stream" as const,
                          label: `Source ${n + 1}`,
                        })).slice(0, 4),
                        ...filterEmbeds(ep.embed_urls).map((url) => ({
                          url,
                          kind: "embed" as const,
                          label: providerName(url),
                        })),
                      ].slice(0, 6);
                      const epSrcIdx = Math.min(episodeSourceIdx[epKey] ?? 0, Math.max(0, sources.length - 1));
                      const currentSource = sources[epSrcIdx];
                      // Clean streams resolve on-demand when the row is tapped, so the
                      // WHOLE row is always tappable — no source needs to pre-exist
                      // (vidlink, the old always-present fallback, is gone).
                      return (
                      <div key={i}>
                      <button
                        onClick={() => {
                          const opening = !isPlaying;
                          setPlayingEpisode(isPlaying ? null : epKey);
                          if (opening) {
                            resolveEpisode(epKey, season.season_number, ep.episode_number);
                            // Snapshot this episode's resume point at open time.
                            const it = cwRef.current.find(
                              (i) => i.tmdbId === Number(tmdbId) && i.kind === "series"
                                && i.season === season.season_number && i.episode === ep.episode_number,
                            );
                            setEpisodeResume((prev) => ({
                              ...prev,
                              [epKey]: it && it.duration ? (it.progress / 100) * it.duration : undefined,
                            }));
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
                          {/* Source switcher + open-in-new-tab escape hatch */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {sources.length > 1 &&
                              sources.map((src, n) => (
                                <button
                                  key={n}
                                  onClick={() => setEpisodeSourceIdx((prev) => ({ ...prev, [epKey]: n }))}
                                  className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                                    epSrcIdx === n
                                      ? "bg-brand text-white hud-glow"
                                      : "glass-card text-text-muted hover:text-white"
                                  }`}
                                >
                                  {src.label}
                                </button>
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
                          <div className="rounded-xl overflow-hidden bg-black">
                            {currentSource.kind === "embed" ? (
                              startedUrl === currentSource.url ? (
                                <iframe
                                  src={currentSource.url}
                                  allowFullScreen
                                  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                                  // Mounted only after a play tap = user-gesture start,
                                  // not autoplay. Sandbox stays off so providers play.
                                  className="w-full h-full aspect-video"
                                  style={{ border: "none" }}
                                  key={currentSource.url}
                                />
                              ) : (
                                <button
                                  onClick={() => setStartedUrl(currentSource.url)}
                                  className="relative w-full aspect-video bg-black flex items-center justify-center group"
                                  aria-label="Play"
                                >
                                  {ep.still_url && (
                                    <img src={ep.still_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                                  )}
                                  <span className="relative w-14 h-14 rounded-full bg-brand/90 flex items-center justify-center group-hover:scale-105 transition-transform">
                                    <Play className="w-7 h-7 text-white fill-white" />
                                  </span>
                                </button>
                              )
                            ) : (
                              <VideoPlayer
                                src={currentSource.url}
                                autoPlay={false}
                                title={detail?.title}
                                initialTime={episodeResume[epKey]}
                                onProgress={(t, d) => {
                                  if (!detail || !d) return;
                                  updateProgress({
                                    tmdbId: Number(tmdbId),
                                    title: detail.title,
                                    poster: detail.poster,
                                    kind: "series",
                                    season: season.season_number,
                                    episode: ep.episode_number,
                                    progress: (t / d) * 100,
                                    duration: d,
                                    updatedAt: Date.now(), // overwritten by the hook; required by the type
                                  });
                                }}
                                key={currentSource.url}
                              />
                            )}
                          </div>
                          {/* No auto-switch — user picks. Nudge after 30s. */}
                          <SourceTroubleHint resetKey={`${epKey}-${epSrcIdx}`} />
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