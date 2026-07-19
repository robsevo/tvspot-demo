"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { Play } from "lucide-react";
import { proxyFetch } from "@/lib/api";
import { mergeSources } from "@/lib/sources";
import { resolveVod, prewarmVod, getPrewarmed } from "@/lib/vodPrewarm";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { useCatalogItem } from "@/hooks/useCatalogItem";
import { useSubtitles } from "@/hooks/useSubtitles";
import TvVodPlayback from "@/components/tv/TvVodPlayback";
import { useTvBack } from "@/components/tv/TvNav";
import type { SeriesDetail, Episode } from "@/lib/types";

/** TV series page: season row on top, episode list below, Enter plays.
 *  Same no-embeds rule as the movie page; backend streams play immediately
 *  while the HD resolve lands in the background and joins the failover chain. */
export default function TvSeriesPage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [playing, setPlaying] = useState<{ season: number; episode: number } | null>(null);
  // Resolved HD streams per "s<season>e<episode>" key.
  const [resolvedByEp, setResolvedByEp] = useState<Record<string, string[]>>({});

  const { items, updateProgress, remove } = useContinueWatching();
  const seriesId = Number(tmdbId);

  // Catalog fallback for the header — see useCatalogItem: the backend's
  // details/series record can carry empty metadata for current titles.
  const catItem = useCatalogItem("series", tmdbId);
  // Tracks are per-episode; the hook returns [] until an episode is playing.
  const subtitles = useSubtitles("series", tmdbId, playing?.season, playing?.episode);
  const display = {
    title: detail?.title || catItem?.title || "",
    poster: detail?.poster || catItem?.poster,
    overview: detail?.overview || catItem?.overview,
    year: detail?.year || catItem?.year,
    rating: detail?.rating || catItem?.rating,
    service: detail?.service || catItem?.service,
  };

  useEffect(() => {
    let cancelled = false;
    proxyFetch<SeriesDetail>(`/api/lounge/vod/series/${tmdbId}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  const season = detail?.seasons?.[seasonIdx];

  const epKey = (s: number, e: number) => `s${s}e${e}`;

  const resolveEpisode = useCallback(
    (s: number, e: number) => {
      const key = epKey(s, e);
      const warm = getPrewarmed("series", tmdbId, s, e);
      if (warm) {
        setResolvedByEp((prev) => (prev[key] ? prev : { ...prev, [key]: warm }));
        return;
      }
      resolveVod("series", tmdbId, s, e).then((urls) => {
        if (urls.length > 0) setResolvedByEp((prev) => ({ ...prev, [key]: urls }));
      });
    },
    [tmdbId],
  );

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
        remove(seriesId, "series", playing.season, playing.episode);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playing, display.title, display.poster, seriesId, updateProgress, remove],
  );

  const closePlayback = useCallback(() => setPlaying(null), []);

  // Episode picked but no playable source yet (no backend streams; HD resolve
  // still in flight) — hold a full-screen waiting state instead of a dead
  // Enter press, with Back as the escape hatch.
  const waiting = playing !== null && playingSources.length === 0;
  useTvBack(waiting ? closePlayback : null);

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

  return (
    <div className="px-16 pb-16">
      <div className="flex items-start gap-8 mb-8">
        {display.poster && (
          <img
            src={display.poster}
            alt={display.title}
            referrerPolicy="no-referrer"
            className="w-44 rounded-lg shrink-0 ring-1 ring-white/10"
          />
        )}
        <div className="min-w-0 pt-2">
          <h1 className="text-4xl font-bold text-white mb-3">{display.title}</h1>
          <div className="flex items-center gap-4 mb-4 text-lg text-[#aebbc5]">
            {display.year && <span>{display.year}</span>}
            {display.rating && (
              <span className="border border-[#8197a4]/60 rounded px-2 py-0.5 text-base">
                {display.rating}
              </span>
            )}
            {display.service && <span>{display.service}</span>}
          </div>
          {display.overview && (
            <p className="text-lg text-[#aebbc5] leading-relaxed line-clamp-3 max-w-3xl">
              {display.overview}
            </p>
          )}
        </div>
      </div>

      {!detail && (
        <p className="text-xl text-[#8197a4] mb-6">Loading episodes…</p>
      )}

      {detail && detail.seasons.length > 1 && (
        <div className="flex items-center gap-4 mb-8 flex-wrap">
          {detail.seasons.map((s, i) => (
            <button
              key={s.season_number}
              data-tv
              onClick={() => setSeasonIdx(i)}
              className={`px-6 py-3 rounded-lg text-xl font-semibold ${
                i === seasonIdx ? "bg-white text-black" : "bg-[#1a242f] text-[#aebbc5]"
              }`}
            >
              Season {s.season_number}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 max-w-5xl">
        {season?.episodes.map((ep, i) => {
          const cw = cwFor(season.season_number, ep.episode_number);
          return (
            <button
              key={ep.episode_number}
              data-tv
              {...(i === 0 ? { "data-tv-autofocus": true } : {})}
              onFocus={() =>
                prewarmVod("series", tmdbId, season.season_number, ep.episode_number)
              }
              onClick={() => {
                resolveEpisode(season.season_number, ep.episode_number);
                setPlaying({ season: season.season_number, episode: ep.episode_number });
              }}
              className="flex items-center gap-6 rounded-lg bg-[#1a242f] ring-1 ring-white/10 px-6 py-4 text-left"
            >
              <span className="text-2xl font-bold text-[#5a6b78] w-10 shrink-0 text-center">
                {ep.episode_number}
              </span>
              {ep.still_url && (
                <img
                  src={ep.still_url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-40 aspect-video object-cover rounded-lg shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xl font-semibold text-white truncate">{ep.title}</p>
                {ep.overview && (
                  <p className="text-base text-[#8197a4] line-clamp-2 mt-1">{ep.overview}</p>
                )}
                {cw && cw.progress > 2 && cw.progress < 95 && (
                  <div className="mt-2 h-1.5 w-56 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full bg-[#1399ff]"
                      style={{ width: `${Math.round(cw.progress)}%` }}
                    />
                  </div>
                )}
              </div>
              <Play className="w-6 h-6 text-[#8197a4] shrink-0" />
            </button>
          );
        })}
      </div>

      {waiting && (
        <div data-tv-trap className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-4">
          <p className="text-2xl text-white">Finding streams…</p>
          <p className="text-xl text-text-muted">Press Back to cancel.</p>
        </div>
      )}

      {playing && playingSources.length > 0 && playingEpisode && (
        <TvVodPlayback
          sources={playingSources}
          title={`${display.title} — S${playing.season} E${playing.episode}`}
          poster={playingEpisode.still_url || display.poster}
          initialTime={resumeTime}
          subtitles={subtitles}
          onClose={closePlayback}
          onProgress={handleProgress}
        />
      )}
    </div>
  );
}
