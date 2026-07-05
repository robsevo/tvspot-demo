"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { proxyFetch } from "@/lib/api";
import Link from "next/link";
import { ChevronLeft, ChevronDown, Check, X, Loader2, RefreshCw, ExternalLink, Info } from "lucide-react";
import { mergeSources, type PlayableSource } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import VodPlayer from "@/components/VodPlayer";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { useStreamCheck, type SourceStatus } from "@/hooks/useStreamCheck";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import type { SeriesDetail, Episode } from "@/lib/types";

/** Maximum sources to display per episode. */
const MAX_SOURCES = 6;

/** Cooldown for sources that dropped during playback. */
const FAIL_COOLDOWN_MS = 120000;

/** Small status indicator for a source button. */
function StatusDot({ status }: { status: SourceStatus }) {
  if (status === "checking") return <Loader2 className="w-3 h-3 animate-spin text-text-muted" />;
  if (status === "working") return <Check className="w-3 h-3 text-green-400" />;
  if (status === "dead") return <X className="w-3 h-3 text-red-400" />;
  if (status === "busy") return <span className="w-2 h-2 rounded-full bg-amber-400" title="Busy — connection limit" />;
  return null;
}

/** Per-episode playback state. Verification lives in useStreamCheck for the
 *  PLAYING episode only (one player at a time), not per-episode — that keeps
 *  hooks at the top level and probes only what's on screen. */
interface EpisodeState {
  resolved: string[];
  sourceIndex: number;
  failedAt: Record<string, number>;
  /** Resume position snapshotted when the episode is opened. Frozen so the
   *  continue-watching writes during playback can't churn the player's
   *  initialTime (remux sources bake it into the stream URL → restarts). */
  resume: number;
}

const EMPTY_EP_STATE: EpisodeState = { resolved: [], sourceIndex: 0, failedAt: {}, resume: 0 };

export default function VodSeriesPage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingEpisode, setPlayingEpisode] = useState<string | null>(null);
  // Per-episode state keyed by "season-episode"
  const [epState, setEpState] = useState<Record<string, EpisodeState>>({});
  // Seasons start COLLAPSED — tap a season header to expand its episodes.
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({});
  // URL that actually reached first frame for the playing episode.
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);

  const { items, updateProgress, remove } = useContinueWatching();
  const seriesId = useMemo(() => (tmdbId ? Number(tmdbId) : 0), [tmdbId]);

  // Expand seasons that have an in-progress episode
  useEffect(() => {
    if (!detail || !items.length) return;
    const seriesProgress = items.filter((i) => i.tmdbId === seriesId && i.kind === "series" && i.progress < 90);
    if (seriesProgress.length === 0) return;
    const seasonsWithProgress = new Set(seriesProgress.map((i) => i.season).filter(Boolean));
    if (seasonsWithProgress.size > 0) {
      setExpandedSeasons((prev) => {
        const next = { ...prev };
        seasonsWithProgress.forEach((s) => { if (s) next[s] = true; });
        return next;
      });
    }
  }, [detail, items, seriesId]);

  const toggleSeason = (n: number) =>
    setExpandedSeasons((prev) => ({ ...prev, [n]: !prev[n] }));

  const getEpState = useCallback(
    (epKey: string): EpisodeState => epState[epKey] ?? EMPTY_EP_STATE,
    [epState]
  );

  const setEpStateField = useCallback(<K extends keyof EpisodeState>(epKey: string, field: K, value: EpisodeState[K]) => {
    setEpState((prev) => ({
      ...prev,
      [epKey]: { ...(prev[epKey] ?? EMPTY_EP_STATE), [field]: value },
    }));
  }, []);

  const resolveEpisode = useCallback(async (epKey: string, season: number, episodeNumber: number) => {
    if (!tmdbId) return;

    const warm = getPrewarmed("series", tmdbId, season, episodeNumber);
    if (warm) {
      setEpStateField(epKey, "resolved", warm);
      return;
    }

    try {
      const urls = await resolveVod("series", tmdbId, season, episodeNumber);
      setEpStateField(epKey, "resolved", urls);
    } catch {
      setEpStateField(epKey, "resolved", []);
    }
  }, [tmdbId, setEpStateField]);

  useEffect(() => {
    if (!tmdbId) return;
    setLoading(true);
    proxyFetch<SeriesDetail>(`/api/lounge/vod/series/${tmdbId}`)
      .then((d) => setDetail(d))
      .catch((err) => console.error("Series detail fetch failed:", err))
      .finally(() => setLoading(false));
  }, [tmdbId]);

  // Pure source list for an episode (no side effects — verification is driven
  // by the playing episode's probe hook below).
  const episodeByKey = useCallback(
    (epKey: string): Episode | null => {
      if (!detail) return null;
      const [s, e] = epKey.split("-").map(Number);
      const season = detail.seasons?.find((x) => x.season_number === s);
      return season?.episodes.find((x) => x.episode_number === e) ?? null;
    },
    [detail]
  );
  const getEpisodeSources = useCallback(
    (epKey: string, ep: Episode): PlayableSource[] =>
      mergeSources(getEpState(epKey).resolved, ep.stream_urls, ep.embed_urls),
    [getEpState]
  );

  // Verify ONLY the playing episode's sources — server-side reachability probe
  // (VOD mode), shared with the movie page and live channels.
  const playingSources = useMemo(() => {
    if (!playingEpisode) return [] as PlayableSource[];
    const ep = episodeByKey(playingEpisode);
    return ep ? getEpisodeSources(playingEpisode, ep) : [];
  }, [playingEpisode, episodeByKey, getEpisodeSources]);
  const probeUrls = useMemo(
    () => playingSources.slice(0, MAX_SOURCES).map((s) => s.url),
    [playingSources]
  );
  const { statusOf, workingCount, busyCount, loading: checking, recheck } = useStreamCheck(probeUrls, { mode: "vod" });

  // Cooldown tick so cooled-down sources come back on their own.
  useEffect(() => {
    const id = setInterval(() => setEpState((prev) => ({ ...prev })), 10000);
    return () => clearInterval(id);
  }, []);

  // Dead = dropped during playback (cooldown) or probe-dead — unless on screen.
  const isEpSourceDead = useCallback(
    (epKey: string, src: PlayableSource): boolean => {
      const state = getEpState(epKey);
      if (state.failedAt[src.url] && Date.now() - state.failedAt[src.url] < FAIL_COOLDOWN_MS) return true;
      if (src.url === confirmedUrl) return false;
      // statusOf only knows the playing episode's URLs — others read "unknown".
      return epKey === playingEpisode && statusOf(src.url) === "dead";
    },
    [getEpState, confirmedUrl, playingEpisode, statusOf]
  );

  // Auto failover for the playing episode: current source judged dead before
  // it ever played → advance to the first usable one.
  const playingState = playingEpisode ? getEpState(playingEpisode) : null;
  const playingIndex = playingState
    ? Math.min(playingState.sourceIndex, Math.max(0, playingSources.length - 1))
    : 0;
  useEffect(() => {
    if (!playingEpisode || playingSources.length === 0) return;
    const current = playingSources[playingIndex];
    if (current && !isEpSourceDead(playingEpisode, current)) return;
    const usable = playingSources.find((s) => !isEpSourceDead(playingEpisode, s));
    if (usable) {
      const idx = playingSources.indexOf(usable);
      if (idx >= 0 && idx !== playingIndex) setEpStateField(playingEpisode, "sourceIndex", idx);
    }
  }, [playingEpisode, playingSources, playingIndex, isEpSourceDead, setEpStateField]);

  // Player pronounced the playing source dead: cool it down and advance.
  const handleSourceFailure = useCallback((epKey: string) => (_lastTime: number) => {
    setEpState((prev) => {
      const state = prev[epKey] ?? EMPTY_EP_STATE;
      const ep = episodeByKey(epKey);
      if (!ep) return prev;
      const sources = mergeSources(state.resolved, ep.stream_urls, ep.embed_urls);
      const idx = Math.min(state.sourceIndex, Math.max(0, sources.length - 1));
      const current = sources[idx];
      if (!current) return prev;
      const failedAt = { ...state.failedAt, [current.url]: Date.now() };
      const usable = (s: PlayableSource) =>
        s.url !== current.url && !(failedAt[s.url] && Date.now() - failedAt[s.url] < FAIL_COOLDOWN_MS);
      const after = sources.findIndex((s, i) => i > idx && usable(s));
      const next = after >= 0 ? after : sources.findIndex(usable);
      return {
        ...prev,
        [epKey]: { ...state, failedAt, sourceIndex: next >= 0 ? next : idx },
      };
    });
    setConfirmedUrl(null);
  }, [episodeByKey]);

  // Save progress to Continue Watching. VideoPlayer throttles this (~8s);
  // finishing an episode clears its row.
  const handleProgress = useCallback(
    (seasonNum: number, episodeNum: number) => (currentTime: number, duration: number) => {
      if (!detail || !seriesId || !duration || duration <= 0) return;
      if (currentTime >= duration - 30) {
        remove(seriesId, "series", seasonNum, episodeNum);
        return;
      }
      updateProgress({
        tmdbId: seriesId,
        title: detail.title,
        poster: detail.poster,
        kind: "series",
        season: seasonNum,
        episode: episodeNum,
        progress: Math.round((currentTime / duration) * 100),
        duration,
        updatedAt: Date.now(),
      });
    },
    [detail, seriesId, updateProgress, remove]
  );

  // Recheck: re-probe and clear the playing episode's cooldowns.
  const recheckPlaying = useCallback(() => {
    if (playingEpisode) setEpStateField(playingEpisode, "failedAt", {});
    recheck();
  }, [playingEpisode, setEpStateField, recheck]);

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
                    {season.episodes.map((ep) => {
                      const epKey = `${season.season_number}-${ep.episode_number}`;
                      const isPlaying = playingEpisode === epKey;
                      const sources = getEpisodeSources(epKey, ep);
                      const state = getEpState(epKey);
                      const validIndex = Math.min(state.sourceIndex, Math.max(0, sources.length - 1));
                      const currentSource = sources[validIndex];

                      return (
                      <div key={epKey} id={`ep-${epKey}`}>
                      <button
                        onClick={() => {
                          const opening = !isPlaying;
                          setPlayingEpisode(isPlaying ? null : epKey);
                          setConfirmedUrl(null);
                          if (opening) {
                            // Snapshot the resume position NOW — deriving it live
                            // would churn the player src (see EpisodeState.resume).
                            const entry = items.find(
                              (i) => i.tmdbId === seriesId && i.kind === "series" &&
                                     i.season === season.season_number && i.episode === ep.episode_number
                            );
                            const resume = entry?.duration && entry.duration > 0
                              ? Math.round((entry.progress / 100) * entry.duration)
                              : 0;
                            setEpStateField(epKey, "resume", resume);
                            if (state.resolved.length === 0) {
                              resolveEpisode(epKey, season.season_number, ep.episode_number);
                            }
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
                          {state.resolved.length === 0 ? (
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
                        <div className="mt-2 space-y-3">
                          <VodPlayer
                            src={currentSource.url}
                            poster={ep.still_url || detail.poster}
                            title={`${detail.title} - S${season.season_number}E${ep.episode_number}: ${ep.title}`}
                            initialTime={state.resume}
                            autoPlay
                            onProgress={handleProgress(season.season_number, ep.episode_number)}
                            onSourceFail={handleSourceFailure(epKey)}
                            onPlay={() => setConfirmedUrl(currentSource.url)}
                          />

                          {/* Open in new tab escape hatch */}
                          <div className="flex items-center justify-end px-1">
                            <a
                              href={currentSource.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] px-2.5 py-1 rounded-full bg-card text-text-muted hover:text-white transition-colors flex items-center gap-1"
                              title="If this source won't play here, open it in a new tab"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open
                            </a>
                          </div>

                          <SourceTroubleHint
                            resetKey={currentSource.url}
                            message="Trouble with this stream? Try another source below."
                          />

                          {/* Source selector */}
                          {sources.length > 1 && (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between px-1 text-xs text-text-muted">
                                <span>
                                  {checking
                                    ? "Checking sources…"
                                    : workingCount + (confirmedUrl && statusOf(confirmedUrl) !== "working" ? 1 : 0) > 0
                                      ? `${workingCount + (confirmedUrl && statusOf(confirmedUrl) !== "working" ? 1 : 0)} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${probeUrls.length}`
                                      : busyCount > 0
                                        ? `${busyCount} source${busyCount > 1 ? "s" : ""} busy — will connect when free`
                                        : `0 of ${probeUrls.length} sources online`}
                                </span>
                                <button
                                  onClick={recheckPlaying}
                                  disabled={checking}
                                  className="flex items-center gap-1 text-text-secondary hover:text-white transition-colors disabled:opacity-50 min-h-[32px]"
                                  aria-label="Re-check sources"
                                >
                                  <RefreshCw className={`w-3 h-3 ${checking ? "animate-spin" : ""}`} />
                                  <span>Recheck</span>
                                </button>
                              </div>

                              <div className="flex gap-2 overflow-x-auto px-1">
                                {sources.slice(0, MAX_SOURCES).map((src, idx) => {
                                  const isCurrent = src.url === currentSource?.url;
                                  const srcStatus: SourceStatus = isEpSourceDead(epKey, src) ? "dead" : statusOf(src.url);
                                  return (
                                    <button
                                      key={src.url}
                                      onClick={() => setEpStateField(epKey, "sourceIndex", sources.indexOf(src))}
                                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                                        isCurrent
                                          ? "bg-brand text-white"
                                          : srcStatus === "dead"
                                            ? "bg-card text-text-muted opacity-60 hover:opacity-100"
                                            : "bg-card text-text-secondary hover:text-white"
                                      }`}
                                    >
                                      <StatusDot status={srcStatus} />
                                      {idx + 1}. {src.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Helpful tip */}
                          <p className="flex items-start gap-1.5 px-1 text-[11px] text-text-muted">
                            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                            <span>
                              If a stream keeps restarting or looping, tap{" "}
                              <span className="text-text-secondary font-medium">Open</span> to play it in a new tab
                              or try another source above.
                            </span>
                          </p>
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
