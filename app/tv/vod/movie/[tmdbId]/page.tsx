"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Play, RotateCcw, Plus, Check } from "lucide-react";
import { proxyFetchRetry } from "@/lib/api";
import { mergeSources } from "@/lib/sources";
import { heroArt } from "@/lib/tmdbImage";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { useCatalogItem } from "@/hooks/useCatalogItem";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { useMyList } from "@/hooks/useMyList";
import { useSubtitles } from "@/hooks/useSubtitles";
import TvVodPlayback from "@/components/tv/TvVodPlayback";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";
import type { VodDetail } from "@/lib/types";

/** TV movie page: backdrop hero + Play/Restart. Embeds are dropped (no way to
 *  drive a third-party iframe with a remote); direct streams + resolved HD
 *  cover playback, with TvVodPlayback's automatic failover between them. */
export default function TvMoviePage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState<string[]>(() => getPrewarmed("movie", tmdbId) ?? []);
  const [playing, setPlaying] = useState(false);
  const [fromStart, setFromStart] = useState(false);
  // Hero "Play" deep-link (?play=1): start playback as soon as sources exist.
  // window.location (not useSearchParams) — this page is client-only and a
  // Suspense boundary for one flag is noise.
  const autoPlayWanted = useRef(false);
  useEffect(() => {
    try {
      autoPlayWanted.current = new URLSearchParams(window.location.search).get("play") === "1";
    } catch {}
  }, []);

  const { items, updateProgress, remove } = useContinueWatching();
  const { add: addToList, remove: removeFromList, isInList } = useMyList();
  const subtitles = useSubtitles("movie", tmdbId);
  const { movies: trending } = useTrendingCatalog();

  // Catalog fallback: the backend's details record is EMPTY for many trending
  // titles — the catalog row (which the user just came from) fills the header
  // while the vod-extract resolver independently finds the streams.
  const catItem = useCatalogItem("movie", tmdbId);
  const display = {
    title: detail?.title || catItem?.title || "",
    backdrop: detail?.backdrop || catItem?.backdrop || catItem?.poster,
    overview: detail?.overview || catItem?.overview,
    year: detail?.year || catItem?.year,
    rating: detail?.rating || catItem?.rating,
    service: detail?.service || catItem?.service,
  };
  // Hero art at full display resolution, chosen with its TYPE known: a real
  // landscape backdrop → w1280 (details serves only w780, which upscaled soft);
  // a poster fallback → its w780 max. display.backdrop above stays as-is for the
  // continue-watching / MediaSession poster, which just wants any image.
  const heroBackdrop = detail?.backdrop || catItem?.backdrop;
  const heroSrc = heroBackdrop
    ? heroArt(heroBackdrop, true)
    : catItem?.poster
      ? heroArt(catItem.poster, false)
      : undefined;

  useEffect(() => {
    let cancelled = false;
    const ctl = new AbortController();
    // Auto-retry the backend cold-start window (box mid-bounce → 503/504/
    // timeout) with backoff so the detail heals itself instead of parking on
    // "isn't available right now". Only a 404 or an exhausted ~60s budget fails.
    proxyFetchRetry<VodDetail>(`/api/lounge/vod/details/${tmdbId}`, { signal: ctl.signal })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (cancelled || err?.name === "AbortError") return;
        setFailed(true);
      });
    resolveVod("movie", tmdbId).then((urls) => {
      if (!cancelled && urls.length > 0) setResolved(urls);
    });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [tmdbId]);

  const sources = useMemo(
    () => mergeSources(resolved, detail?.stream_urls, []),
    [detail, resolved],
  );

  useEffect(() => {
    if (autoPlayWanted.current && sources.length > 0) {
      autoPlayWanted.current = false;
      setPlaying(true);
    }
  }, [sources]);

  const cwId = Number(tmdbId);
  const cwItem = items.find((i) => i.tmdbId === cwId && i.kind === "movie");
  const resumeTime =
    cwItem && cwItem.progress > 2 && cwItem.progress < 95
      ? (cwItem.progress / 100) * cwItem.duration
      : 0;

  const handleProgress = useCallback(
    (t: number, d: number) => {
      if (!display.title || !isFinite(d) || d <= 0) return;
      const pct = (t / d) * 100;
      if (pct > 95) {
        remove(cwId, "movie");
      } else {
        updateProgress({
          tmdbId: cwId,
          title: display.title,
          poster: display.backdrop,
          kind: "movie",
          progress: pct,
          duration: d,
          updatedAt: Date.now(),
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [display.title, display.backdrop, cwId, updateProgress, remove],
  );

  /** Ask the backend again, ignoring every cache. Sources rot between the
   *  nightly link refresh and now, so a dead chain is often fixed by simply
   *  re-resolving — that used to require backing out and re-opening the title. */
  const refreshSources = useCallback(async () => {
    const urls = await resolveVod("movie", tmdbId, undefined, undefined, true);
    if (urls.length > 0) setResolved(urls);
  }, [tmdbId]);

  const closePlayback = useCallback(() => setPlaying(false), []);

  const listed = isInList(cwId, "movie");
  const toggleList = () => {
    if (listed) removeFromList(cwId, "movie");
    else
      addToList({
        tmdbId: cwId,
        title: display.title,
        poster: display.backdrop,
        kind: "movie",
        service: display.service,
        addedAt: Date.now(),
      });
  };

  const related = useMemo(
    () => trending.filter((m) => m.tmdb_id !== cwId).slice(0, 18),
    [trending, cwId],
  );

  if (failed && !catItem) {
    return (
      <div className="px-16 py-20">
        <p className="text-2xl text-[#aebbc5]">This title isn&apos;t available right now.</p>
        <p className="text-xl text-[#8197a4] mt-2">Press Back to return.</p>
      </div>
    );
  }

  if (!detail && !catItem) {
    return <p className="px-16 py-20 text-xl text-[#8197a4]">Loading…</p>;
  }

  return (
    <div className="relative min-h-screen">
      {/* Full-bleed hero: backdrop bleeds from the right, details bottom-left. */}
      <div className="relative h-screen">
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

        <div className="relative px-16 pt-[24vh] pb-16 max-w-3xl">
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
            <span>Movie</span>
          </div>
          {display.overview && (
            <p className="text-xl text-[#c7d5e0] leading-relaxed mb-10 line-clamp-4 max-w-2xl">
              {display.overview}
            </p>
          )}

          <div className="flex items-center gap-5 w-max">
            <button
              data-tv
              data-tv-autofocus
              disabled={sources.length === 0}
              onClick={() => {
                setFromStart(false);
                setPlaying(true);
              }}
              className="flex items-center gap-3 shrink-0 whitespace-nowrap bg-white text-black text-lg font-bold px-6 py-3.5 rounded-lg disabled:opacity-50"
            >
              <Play className="w-6 h-6 fill-black" />
              {sources.length === 0
                ? "Finding streams…"
                : resumeTime > 0
                  ? "Resume"
                  : "Play"}
            </button>

            {resumeTime > 0 && sources.length > 0 && (
              <button
                data-tv
                onClick={() => {
                  setFromStart(true);
                  setPlaying(true);
                }}
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

      {/* More like this — scrolls up over the solid page bg, Prime-style. */}
      {related.length > 0 && (
        <div className="relative bg-[#0b1524] pb-16 -mt-8">
          <TvRail title="More like this">
            {related.map((m) => (
              <TvPosterCard
                key={m.tmdb_id}
                tmdbId={m.tmdb_id}
                title={m.title}
                backdrop={m.backdrop}
                poster={m.poster}
                kind="movie"
                badge="TRENDING"
              />
            ))}
          </TvRail>
        </div>
      )}

      {playing && sources.length > 0 && (
        <TvVodPlayback
          sources={sources}
          title={display.title}
          // Fullscreen loading background at full res (w1280), not the raw
          // display.backdrop which can be the details' w780 upscaled soft.
          poster={heroSrc || display.backdrop}
          initialTime={fromStart ? 0 : resumeTime}
          subtitles={subtitles}
          onClose={closePlayback}
          onProgress={handleProgress}
          onRefreshSources={refreshSources}
        />
      )}
    </div>
  );
}
