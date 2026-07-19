"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Play, Tv, Info } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { trendingNow, topRated, trendingScore } from "@/lib/discovery";
import TvRail from "@/components/tv/TvRail";
import TvLandscapeCard from "@/components/tv/TvLandscapeCard";
import TvChannelCard from "@/components/tv/TvChannelCard";

const CHANNELS_ON_HOME = 12;

/** Prime-style TV home: full-bleed hero billboard for the top trending title,
 *  then Continue Watching, Live TV, and curated landscape rails. */
export default function TvHomePage() {
  const { channels } = useChannels();
  const { movies, series, loading } = useTrendingCatalog();
  const { items: cwItems } = useContinueWatching();

  const homeChannels = useMemo(() => {
    const online = channels.filter((c) => c.online);
    return (online.length > 0 ? online : channels).slice(0, CHANNELS_ON_HOME);
  }, [channels]);

  const trendingMovies = useMemo(() => trendingNow(movies).slice(0, 18), [movies]);
  const trendingSeries = useMemo(() => trendingNow(series).slice(0, 18), [series]);
  const topRatedMovies = useMemo(() => topRated(movies).slice(0, 18), [movies]);
  const topRatedSeries = useMemo(() => topRated(series).slice(0, 18), [series]);

  // Hero: the most-trending title with a usable backdrop.
  const hero = useMemo(() => {
    const all = [
      ...movies.map((m) => ({ ...m, kind: "movie" as const })),
      ...series.map((s) => ({ ...s, kind: "series" as const })),
    ].filter((it) => it.backdrop);
    return all.sort((a, b) => trendingScore(b) - trendingScore(a))[0];
  }, [movies, series]);

  const continueWatching = useMemo(
    () =>
      cwItems
        .filter((i) => i.progress > 2 && i.progress < 95)
        .slice(0, 12),
    [cwItems],
  );

  const heroHref = hero
    ? hero.kind === "series"
      ? `/tv/vod/series/${hero.tmdb_id}`
      : `/tv/vod/movie/${hero.tmdb_id}`
    : "";

  return (
    <div className="pb-16">
      {hero && (
        <div className="relative h-[52vh] mb-6">
          <img
            src={hero.backdrop}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0f171e] via-[#0f171e]/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f171e] to-transparent" />
          <div className="relative h-full flex flex-col justify-end px-16 pb-10 max-w-3xl">
            <h1 className="text-5xl font-bold text-white mb-3">{hero.title}</h1>
            <p className="text-lg text-[#aebbc5] mb-2">
              {[hero.year, hero.rating, hero.service].filter(Boolean).join("  ·  ")}
            </p>
            {hero.overview && (
              <p className="text-lg text-[#aebbc5] leading-relaxed line-clamp-3 mb-6">
                {hero.overview}
              </p>
            )}
            <div className="flex items-center gap-4">
              <Link
                href={hero.kind === "movie" ? `${heroHref}?play=1` : heroHref}
                data-tv
                className="flex items-center gap-3 bg-white text-black text-xl font-bold px-9 py-4 rounded-lg focus:outline-none"
              >
                <Play className="w-6 h-6 fill-black" />
                {hero.kind === "movie" ? "Play" : "Episodes"}
              </Link>
              <Link
                href={heroHref}
                data-tv
                className="flex items-center gap-3 bg-white/15 text-white text-xl font-semibold px-9 py-4 rounded-lg focus:outline-none"
              >
                <Info className="w-6 h-6" />
                Details
              </Link>
            </div>
          </div>
        </div>
      )}

      {continueWatching.length > 0 && (
        <TvRail title="Continue Watching">
          {continueWatching.map((i) => (
            <TvLandscapeCard
              key={`${i.kind}-${i.tmdbId}-${i.season ?? 0}-${i.episode ?? 0}`}
              tmdbId={i.tmdbId}
              title={i.title}
              backdrop={i.poster}
              kind={i.kind}
              progress={i.progress}
              sublabel={i.kind === "series" && i.episode ? `S${i.season ?? 1} E${i.episode}` : undefined}
            />
          ))}
        </TvRail>
      )}

      {homeChannels.length > 0 && (
        <TvRail title="Live TV">
          {homeChannels.map((c) => (
            <TvChannelCard key={c.name} channel={c} />
          ))}
          <Link
            href="/tv/live"
            data-tv
            className="w-52 h-28 shrink-0 rounded-lg bg-[#1a242f] ring-1 ring-white/10 flex flex-col items-center justify-center gap-2 text-[#8197a4] focus:outline-none"
          >
            <Tv className="w-8 h-8" />
            <span className="text-base font-medium">Full guide</span>
          </Link>
        </TvRail>
      )}

      {trendingMovies.length > 0 && (
        <TvRail title="Trending Movies">
          {trendingMovies.map((m) => (
            <TvLandscapeCard key={m.tmdb_id} tmdbId={m.tmdb_id} title={m.title} backdrop={m.backdrop} poster={m.poster} kind="movie" />
          ))}
        </TvRail>
      )}

      {trendingSeries.length > 0 && (
        <TvRail title="Trending Series">
          {trendingSeries.map((s) => (
            <TvLandscapeCard key={s.tmdb_id} tmdbId={s.tmdb_id} title={s.title} backdrop={s.backdrop} poster={s.poster} kind="series" />
          ))}
        </TvRail>
      )}

      {topRatedMovies.length > 0 && (
        <TvRail title="Top Rated Movies">
          {topRatedMovies.map((m) => (
            <TvLandscapeCard key={m.tmdb_id} tmdbId={m.tmdb_id} title={m.title} backdrop={m.backdrop} poster={m.poster} kind="movie" />
          ))}
        </TvRail>
      )}

      {topRatedSeries.length > 0 && (
        <TvRail title="Top Rated Series">
          {topRatedSeries.map((s) => (
            <TvLandscapeCard key={s.tmdb_id} tmdbId={s.tmdb_id} title={s.title} backdrop={s.backdrop} poster={s.poster} kind="series" />
          ))}
        </TvRail>
      )}

      {loading && movies.length === 0 && (
        <p className="px-16 py-10 text-xl text-[#8197a4]">Loading catalog…</p>
      )}
    </div>
  );
}
