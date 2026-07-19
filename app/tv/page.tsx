"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { trendingNow, topRated } from "@/lib/discovery";
import { nowAndNext } from "@/lib/tvEpg";
import TvBrowseScreen, { type TvBrowseItem, type TvBrowseRail } from "@/components/tv/TvBrowseScreen";
import type { CatalogItem, Channel } from "@/lib/types";

const CHANNELS_ON_HOME = 12;

function vodItem(
  it: CatalogItem,
  kind: "movie" | "series",
  badge?: string,
): TvBrowseItem {
  return {
    key: `${kind}-${it.tmdb_id}`,
    title: it.title,
    kind,
    tmdbId: it.tmdb_id,
    backdrop: it.backdrop,
    poster: it.poster,
    overview: it.overview,
    metaLine: [it.year, it.rating, kind === "movie" ? "Movie" : "Series"]
      .filter(Boolean)
      .join(" · "),
    badge,
    provider: it.service,
  };
}

function channelItem(c: Channel): TvBrowseItem {
  const guide = nowAndNext(c.programs ?? []);
  return {
    key: `ch-${c.name}`,
    title: guide.now?.title || c.name,
    metaLine: guide.now
      ? c.name
      : c.online
        ? `${c.name} · Live programming`
        : `${c.name} · Offline`,
    live: c.online,
    channel: c,
  };
}

/** Prime-style TV home: pinned hero that mirrors the focused card, rails for
 *  Continue Watching, Live TV, and the trending/top-rated catalog. */
export default function TvHomePage() {
  const { channels } = useChannels();
  const { movies, series, loading } = useTrendingCatalog();
  const { items: cwItems } = useContinueWatching();

  const homeChannels = useMemo(() => {
    const online = channels.filter((c) => c.online);
    return (online.length > 0 ? online : channels).slice(0, CHANNELS_ON_HOME);
  }, [channels]);

  const rails = useMemo<TvBrowseRail[]>(() => {
    const continueWatching = cwItems
      .filter((i) => i.progress > 2 && i.progress < 95)
      .slice(0, 12)
      .map(
        (i): TvBrowseItem => ({
          key: `cw-${i.kind}-${i.tmdbId}-${i.season ?? 0}-${i.episode ?? 0}`,
          title: i.title,
          kind: i.kind,
          tmdbId: i.tmdbId,
          backdrop: i.poster,
          metaLine:
            i.kind === "series" && i.episode
              ? `S${i.season ?? 1} E${i.episode} · ${Math.round(i.progress)}% watched`
              : `${Math.round(i.progress)}% watched`,
          progress: i.progress,
          sublabel: i.kind === "series" && i.episode ? `S${i.season ?? 1} E${i.episode}` : undefined,
        }),
      );

    return [
      { title: "Continue watching", items: continueWatching },
      {
        title: "Live TV",
        items: homeChannels.map(channelItem),
        trailing: (
          <Link
            href="/tv/live"
            data-tv
            className="w-52 h-28 shrink-0 rounded-lg bg-[#1a242f] ring-1 ring-white/10 flex flex-col items-center justify-center gap-2 text-[#8197a4] focus:outline-none"
          >
            <Tv className="w-8 h-8" />
            <span className="text-base font-medium">Full guide</span>
          </Link>
        ),
      },
      {
        title: "Trending movies picked just for you",
        items: trendingNow(movies).slice(0, 18).map((m) => vodItem(m, "movie", "TRENDING")),
      },
      {
        title: "TV shows we think you'll like",
        items: trendingNow(series).slice(0, 18).map((s) => vodItem(s, "series", "TRENDING")),
      },
      {
        title: "Top rated movies",
        items: topRated(movies)
          .slice(0, 18)
          .map((m, i) => vodItem(m, "movie", i < 10 ? "TOP 10" : undefined)),
      },
      {
        title: "Top rated series",
        items: topRated(series)
          .slice(0, 18)
          .map((s, i) => vodItem(s, "series", i < 10 ? "TOP 10" : undefined)),
      },
    ];
  }, [cwItems, homeChannels, movies, series]);

  return (
    <TvBrowseScreen
      rails={rails}
      loading={loading && movies.length === 0}
      loadingText="Loading catalog…"
    />
  );
}
