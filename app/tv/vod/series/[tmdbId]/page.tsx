"use client";

import { useState, useEffect, useMemo, useCallback, useReducer, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Play, RotateCcw, Plus, Check } from "lucide-react";
import { proxyFetchRetry } from "@/lib/api";
import { mergeSources } from "@/lib/sources";
import { heroArt } from "@/lib/tmdbImage";
import { resolveVod, prewarmVod, getPrewarmed } from "@/lib/vodPrewarm";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { useCatalogItem } from "@/hooks/useCatalogItem";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { useMyList } from "@/hooks/useMyList";
import { useSubtitles } from "@/hooks/useSubtitles";
import TvVodPlayback from "@/components/tv/TvVodPlayback";
import { findNextEpisode } from "@/lib/episodeMarkers";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";
import { useTvBack } from "@/components/tv/TvNav";
import type { SeriesDetail, Episode } from "@/lib/types";

/** TV series page: Prime layout — hero + Play S1E1, a season selector, a
 *  horizontal episode row whose focused episode drives a detail block above it,
 *  and a More like this rail. Same no-embeds / background-resolve rules as the
 *  movie page; backend streams play immediately while the HD resolve lands. */
export default function TvSeriesPage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [focusedEp, setFocusedEp] = useState<number | null>(null);
  const [playing, setPlaying] = useState<{ season: number; episode: number } | null>(null);
  // Set when the chosen episode should ignore its saved position and start over
  // (the "Restart" actions), so the same episode can be resumed OR restarted.
  const [fromStart, setFromStart] = useState(false);

  const [detailState, dispatch] = useReducer(
    (
      state: { detail: SeriesDetail | null; failed: boolean },
      action: { type: "SUCCESS"; detail: SeriesDetail } | { type: "FAILURE" }
    ) => {
      switch (action.type) {
        case "SUCCESS":
          return { detail: action.detail, failed: false };
        case "FAILURE":
          return { detail: null, failed: true };
        default:
          return state;
      }
    },
    { detail: null, failed: false }
  );
  const { detail, failed } = detailState;

  const [resolvedByEp, dispatchResolved] = useReducer(
    (prev: Record<string, string[]>, action: { key: string; urls: string[] }) => ({
      ...prev,
      [action.key]: action.urls,
    }),
    {}
  );

  const { items, updateProgress, remove } = useContinueWatching();
  const { add: addToList, remove: removeFromList, isInList } = useMyList();
  const { series: trending } = useTrendingCatalog();
  const seriesId = Number(tmdbId);

  // Catalog fallback for the header — see useCatalogItem: the backend's
  // details/series record can carry empty metadata for current titles.
  const catItem = useCatalogItem("series", tmdbId);
  // Tracks are per-episode; the hook returns [] until an episode is playing.
  const subtitles = useSubtitles("series", tmdbId, playing?.season, playing?.episode);
  const display = {
    title: detail?.title || catItem?.title || "",
    poster: detail?.poster || catItem?.poster,
    backdrop: catItem?.backdrop || detail?.poster || catItem?.poster,
    overview: detail?.overview || catItem?.overview,
    year: detail?.year || catItem?.year,
    rating: detail?.rating || catItem?.rating,
    service: detail?.service || catItem?.service,
  };
  // Hero art at full display resolution, type-aware: a real landscape backdrop
  // → w1280; a poster fallback → its w780 max, so it isn't upscaled soft.
  const heroSrc = catItem?.backdrop
    ? heroArt(catItem.backdrop, true)
    : detail?.poster || catItem?.poster
      ? heroArt((detail?.poster || catItem?.poster)!, false)
      : undefined;

  // Fetch series details. Auto-retries the backend cold-start window
  // (503/504/timeout while the box bounces) with backoff so the page heals
  // itself instead of dead-ending; only a 404 or exhausted budget fails.
  useEffect(() => {
    let active = true;
    const ctl = new AbortController();
    proxyFetchRetry<SeriesDetail>(`/api/lounge/vod/series/${tmdbId}`, { signal: ctl.signal })
      .then((d) => {
        if (active) dispatch({ type: "SUCCESS", detail: d });
      })
      .catch((err) => {
        if (!active || err?.name === "AbortError") return;
        dispatch({ type: "FAILURE" });
      });
    return () => { active = false; ctl.abort(); };
  }, [tmdbId]);

  const season = detail?.seasons?.[seasonIdx];
  const episodes = season?.episodes ?? [];
  const shownEp =
    episodes.find((e) => e.episode_number === focusedEp) ?? episodes[0] ?? null;
  const firstEp = detail?.seasons?.[0]?.episodes?.[0];

  // The episode the viewer is actually on, from Continue Watching (one row per
  // show now). The hero Play button resumes THIS instead of always S1E1.
  const resumeTarget = useMemo(() => {
    const cw = items.find(
      (i) =>
        i.tmdbId === seriesId &&
        i.kind === "series" &&
        i.progress > 2 &&
        i.progress < 95 &&
        i.season &&
        i.episode,
    );
    return cw ? { season: cw.season as number, episode: cw.episode as number } : null;
  }, [items, seriesId]);

  // Where the Play/Resume button points: the in-progress episode if there is
  // one, else the first episode.
  const playTarget = resumeTarget
    ?? (firstEp ? { season: detail!.seasons[0].season_number, episode: firstEp.episode_number } : null);

  const epKey = (s: number, e: number) => `s${s}e${e}`;

  const [settled, setSettled] = useState<Set<string>>(new Set());

  const resolveEpisode = useCallback(
    (s: number, e: number) => {
      const key = epKey(s, e);
      const warm = getPrewarmed("series", tmdbId, s, e);
      if (warm) {
        dispatchResolved({ key, urls: warm });
        return;
      }
      resolveVod("series", tmdbId, s, e)
        .then((urls) => {
          if (urls.length > 0) dispatchResolved({ key, urls });
        })
        .finally(() => {
          // Settled either way. Without this the "Finding streams…" cover had no
          // terminal state and sat there forever when every tier came back empty.
          setSettled((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
        });
    },
    [tmdbId],
  );

  /** Re-resolve the CURRENTLY PLAYING episode, ignoring every cache — the same
   *  escape hatch the movie page has. Scoped to the playing episode because
   *  that's the only one whose sources the viewer is stuck on. */
  const refreshSources = useCallback(async () => {
    if (!playing) return;
    const { season, episode } = playing;
    const urls = await resolveVod("series", tmdbId, season, episode, true);
    if (urls.length > 0) dispatchResolved({ key: epKey(season, episode), urls });
  }, [tmdbId, playing]);

  const playEpisode = (s: number, e: number, restart = false) => {
    resolveEpisode(s, e);
    setFromStart(restart);
    setPlaying({ season: s, episode: e });
  };

  // Deep link from Continue Watching (and anywhere else): /tv/vod/series/<id>?s=&e=&play=1
  // lands on that exact season/episode and, with play=1, starts it — which then
  // resumes at the saved position via resumeTime below. Runs once, after detail
  // loads (we need the seasons to map season_number → selector index). Without
  // this a CW tile only opened the series at S1E1.
  const searchParams = useSearchParams();
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !detail) return;
    const s = Number(searchParams.get("s"));
    const e = Number(searchParams.get("e"));
    if (!s || !e) return;
    deepLinkDone.current = true;
    // Applied in a microtask, not synchronously in the effect body: it keeps the
    // updates out of the render-cascade the linter (rightly) flags, and it's
    // still a tick — the player opens on the next frame either way.
    Promise.resolve().then(() => {
      const idx = detail.seasons?.findIndex((se) => se.season_number === s) ?? -1;
      if (idx >= 0) setSeasonIdx(idx);
      setFocusedEp(e);
      if (searchParams.get("play") === "1") playEpisode(s, e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, searchParams]);

  const playingEpisode: Episode | undefined = useMemo(() => {
    if (!playing || !detail) return undefined;
    return detail.seasons
      .find((s) => s.season_number === playing.season)
      ?.episodes.find((e) => e.episode_number === playing.episode);
  }, [playing, detail]);

  const playingSources = useMemo(() => {
    if (!playing || !playingEpisode) return [];
    return mergeSources(
      resolvedByEp[epKey(playing.season, playing.episode)] ?? [],
      playingEpisode.stream_urls,
      [],
    );
  }, [playing, playingEpisode, resolvedByEp]);

  const cwFor = (s: number, e: number) =>
    items.find(
      (i) => i.tmdbId === seriesId && i.kind === "series" && i.season === s && i.episode === e,
    );

  // Resume state of the focused episode — gates the per-episode "Restart episode"
  // action (a restart only means anything for an episode you're partway through).
  const shownEpCw = season && shownEp ? cwFor(season.season_number, shownEp.episode_number) : undefined;
  const shownEpResumable = !!shownEpCw && shownEpCw.progress > 2 && shownEpCw.progress < 95;

  const resumeTime = useMemo(() => {
    if (!playing) return 0;
    const cw = cwFor(playing.season, playing.episode);
    return cw && cw.progress > 2 && cw.progress < 95
      ? (cw.progress / 100) * cw.duration
      : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, items]);

  const handleProgress = useCallback(
    (t: number, d: number) => {
      if (!playing || !display.title || !isFinite(d) || d <= 0) return;
      const pct = (t / d) * 100;
      if (pct > 95) {
        remove(seriesId, "series");
      } else {
        updateProgress({
          tmdbId: seriesId,
          title: display.title,
          poster: display.poster,
          kind: "series",
          season: playing.season,
          episode: playing.episode,
          progress: pct,
          duration: d,
          updatedAt: Date.now(),
        });
      }
    },
     
    [playing, display.title, display.poster, seriesId, updateProgress, remove],
  );

  const closePlayback = useCallback(() => setPlaying(null), []);

  /**
   * The episode after the one playing: next in the season, else the first
   * episode of the next season that has any. Null on the series finale, which
   * is what suppresses the "Next up" card and its auto-advance.
   */
  const nextUp = useMemo(() => {
    if (!playing || !detail) return null;
    const n = findNextEpisode(detail.seasons, playing.season, playing.episode);
    if (!n) return null;
    return {
      label: `S${n.season} E${n.episode}${n.title ? ` · ${n.title}` : ""}`,
      play: () => playEpisode(n.season, n.episode),
    };
    // playEpisode only closes over tmdbId/dispatch; including it would rebuild
    // the card every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, detail]);

  // Episode picked but no playable source yet — hold a full-screen waiting state.
  // Episodes whose resolve has finished, so "still looking" and "found nothing"
  // are distinguishable.
  const playingKey = playing ? epKey(playing.season, playing.episode) : "";
  const resolveSettled = playingKey !== "" && settled.has(playingKey);
  const waiting = playing !== null && playingSources.length === 0 && !resolveSettled;
  const noSources = playing !== null && playingSources.length === 0 && resolveSettled;
  useTvBack(waiting ? closePlayback : null);

  const listed = isInList(seriesId, "series");
  const toggleList = () => {
    if (listed) removeFromList(seriesId, "series");
    else
      addToList({
        tmdbId: seriesId,
        title: display.title,
        poster: display.poster,
        kind: "series",
        service: display.service,
        addedAt: Date.now(),
      });
  };

  const related = useMemo(
    () => trending.filter((s) => s.tmdb_id !== seriesId).slice(0, 18),
    [trending, seriesId],
  );

  if (failed && !catItem) {
    return (
      <div className="px-16 py-20">
        <p className="text-2xl text-[#aebbc5]">This series isn&apos;t available right now.</p>
        <p className="text-xl text-[#8197a4] mt-2">Press Back to return.</p>
      </div>
    );
  }

  if (!detail && !catItem) {
    return <p className="px-16 py-20 text-xl text-[#8197a4]">Loading…</p>;
  }

  const seasonLabel =
    detail && detail.seasons.length === 1 ? "1 season" : detail ? `${detail.seasons.length} seasons` : "";

  return (
    <div className="relative min-h-screen">
      {/* Hero */}
      <div className="relative">
        {heroSrc && (
          <>
            <img
              src={heroSrc}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute top-0 right-0 w-[70%] h-full object-cover"
            />
            <div className="tv-fade-hero-l absolute inset-0" />
            <div className="tv-fade-hero-b absolute inset-0" />
          </>
        )}

        <div className="relative px-16 pt-[18vh] pb-10 max-w-3xl">
          {display.service && (
            <p className="text-lg font-bold text-white/85 mb-2">{display.service}</p>
          )}
          <h1 className="text-6xl font-bold text-white mb-4">{display.title}</h1>
          <div className="flex items-center gap-4 mb-6 text-lg text-[#aebbc5]">
            {display.year && <span>{display.year}</span>}
            {display.rating && (
              <span className="border border-[#8197a4]/60 rounded px-2 py-0.5 text-base">
                {display.rating}
              </span>
            )}
            {seasonLabel && <span>{seasonLabel}</span>}
          </div>
          {display.overview && (
            <p className="text-xl text-[#c7d5e0] leading-relaxed mb-8 line-clamp-3 max-w-2xl">
              {display.overview}
            </p>
          )}

          {/* Three buttons on one line. Each is nowrap + shrink-0: this row sits
              inside the max-w-3xl copy column, so without both, flex compresses
              them until "Resume S1 E1" / "From beginning" wrap onto a second
              line and the buttons grow tall — seen on the Fire TV, whose font
              metrics run slightly wider than the Samsung's for the same 1920px
              layout. -w-max lets the row exceed the copy column rather than
              squeezing: prose wants the narrow measure, controls don't. */}
          <div className="flex items-center gap-5 w-max">
            <button
              data-tv
              data-tv-autofocus
              disabled={!playTarget}
              onClick={() => playTarget && playEpisode(playTarget.season, playTarget.episode)}
              className="flex items-center gap-3 shrink-0 whitespace-nowrap bg-white text-black text-lg font-bold px-6 py-3.5 rounded-lg disabled:opacity-50"
            >
              <Play className="w-6 h-6 fill-black" />
              {playTarget
                ? `${resumeTarget ? "Resume" : "Play"} S${playTarget.season} E${playTarget.episode}`
                : "Loading…"}
            </button>
            {resumeTarget && playTarget && (
              <button
                data-tv
                onClick={() => playEpisode(playTarget.season, playTarget.episode, true)}
                className="flex items-center gap-3 shrink-0 whitespace-nowrap bg-white/15 text-white text-lg font-semibold px-6 py-3.5 rounded-lg"
              >
                <RotateCcw className="w-5 h-5" />
                From beginning
              </button>
            )}
            <button
              data-tv
              onClick={toggleList}
              aria-label={listed ? "Remove from My Stuff" : "Add to My Stuff"}
              className="tv-pill group flex items-center gap-3 shrink-0 whitespace-nowrap bg-white/15 text-white text-lg font-semibold px-6 py-3.5 rounded-lg focus:outline-none focus:bg-white focus:text-black"
            >
              {listed ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              My Stuff
            </button>
          </div>
        </div>
      </div>

      {/* Episodes */}
      <div className="relative bg-[#0b1524] px-16 pb-4">
        {!detail && <p className="text-xl text-[#8197a4] mb-6">Loading episodes…</p>}

        {detail && detail.seasons.length > 1 && (
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            {detail.seasons.map((s, i) => (
              <button
                key={s.season_number}
                data-tv
                onFocus={() => {
                  setSeasonIdx(i);
                  setFocusedEp(null);
                }}
                onClick={() => setSeasonIdx(i)}
                className={`tv-pill px-6 py-2.5 rounded-lg text-xl font-semibold focus:outline-none focus:bg-white focus:text-black ${
                  i === seasonIdx ? "text-white" : "text-[#8197a4]"
                }`}
              >
                Season {s.season_number}
              </button>
            ))}
          </div>
        )}

        {/* Focused-episode detail (Prime's "1. Episode 1" block) */}
        {shownEp && (
          <div className="mb-5 max-w-3xl">
            <h2 className="text-2xl font-bold text-white">
              {shownEp.episode_number}. {shownEp.title}
            </h2>
            {shownEp.overview && (
              <p className="text-lg text-[#8197a4] leading-relaxed line-clamp-2 mt-1">
                {shownEp.overview}
              </p>
            )}
            {shownEpResumable && season && (
              <button
                data-tv
                onClick={() => playEpisode(season.season_number, shownEp.episode_number, true)}
                className="mt-3 flex items-center gap-2 bg-white/15 text-white text-lg font-semibold px-6 py-3 rounded-lg"
              >
                <RotateCcw className="w-5 h-5" />
                Restart episode
              </button>
            )}
          </div>
        )}

        {/* Horizontal episode row */}
        {season && (
          <div className="flex gap-5 overflow-x-auto py-2">
            {episodes.map((ep, i) => {
              const cw = cwFor(season.season_number, ep.episode_number);
              return (
                <button
                  key={ep.episode_number}
                  data-tv
                  {...(i === 0 ? { "data-tv-autofocus": true } : {})}
                  onFocus={() => {
                    setFocusedEp(ep.episode_number);
                    prewarmVod("series", tmdbId, season.season_number, ep.episode_number);
                  }}
                  onClick={() => playEpisode(season.season_number, ep.episode_number)}
                  className="w-72 shrink-0 text-left focus:outline-none"
                >
                  {/* Explicit height + img-level rounding — same Tizen white-tile
                      workaround as the poster cards (w-72 → 162px at 16:9). */}
                  <div className="relative h-[10.125rem] rounded-lg bg-[#1a242f] ring-1 ring-white/10">
                    {ep.still_url ? (
                      <img
                        src={ep.still_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="w-8 h-8 text-white/25" />
                      </div>
                    )}
                    {cw && cw.progress > 2 && cw.progress < 95 && (
                      <div className="absolute inset-x-0 bottom-0 h-1 rounded-b-lg overflow-hidden bg-white/20">
                        <div
                          className="h-full bg-[#e50914]"
                          style={{ width: `${Math.round(cw.progress)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-base font-semibold text-white truncate">
                    S{season.season_number} E{ep.episode_number}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* You might also like */}
      {related.length > 0 && (
        <div className="relative bg-[#0b1524] pb-16 pt-2">
          <TvRail title="You might also like">
            {related.map((s) => (
              <TvPosterCard
                key={s.tmdb_id}
                tmdbId={s.tmdb_id}
                title={s.title}
                backdrop={s.backdrop}
                poster={s.poster}
                kind="series"
              />
            ))}
          </TvRail>
        </div>
      )}

      {waiting && (
        <div
          data-tv-trap
          className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-4"
        >
          <p className="text-2xl text-white">Finding streams…</p>
          <p className="text-xl text-text-muted">Press Back to cancel.</p>
        </div>
      )}

      {noSources && (
        <div
          data-tv-trap
          className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-5"
        >
          <p className="text-2xl text-white">No sources found for this episode.</p>
          <button
            data-tv
            data-tv-autofocus
            onClick={() => {
              if (!playing) return;
              const k = epKey(playing.season, playing.episode);
              setSettled((prev) => {
                const n = new Set(prev);
                n.delete(k);
                return n;
              });
              resolveVod("series", tmdbId, playing.season, playing.episode, true)
                .then((urls) => {
                  if (urls.length > 0) dispatchResolved({ key: k, urls });
                })
                .finally(() =>
                  setSettled((prev) => (prev.has(k) ? prev : new Set(prev).add(k))),
                );
            }}
            className="bg-white text-black text-xl font-bold px-7 py-3.5 rounded-lg focus:outline-none focus:ring-4 focus:ring-cyan-400"
          >
            Try again
          </button>
          <p className="text-xl text-text-muted">Press Back to pick another episode.</p>
        </div>
      )}

      {playing && playingSources.length > 0 && playingEpisode && (
        <TvVodPlayback
          // Remount per episode. Auto-advance can swap episodes while the
          // player stays mounted (the next one's sources are often already
          // resolved/prewarmed), and without this it would inherit the previous
          // episode's failover index and resume position — landing mid-episode
          // on source #3 of a show it isn't playing any more.
          key={`${playing.season}-${playing.episode}`}
          sources={playingSources}
          title={`${display.title} — S${playing.season} E${playing.episode}`}
          // Fullscreen loading background: the show's w1280 backdrop, NOT the
          // episode still (TMDB serves those at ~w300 → very pixelated blown up)
          // or the w500 portrait poster. The still stays in the episode grid,
          // where it's shown small.
          poster={heroSrc || playingEpisode.still_url || display.poster}
          initialTime={fromStart ? 0 : resumeTime}
          subtitles={subtitles}
          onClose={closePlayback}
          onProgress={handleProgress}
          nextUp={nextUp}
          onRefreshSources={refreshSources}
        />
      )}
    </div>
  );
}
