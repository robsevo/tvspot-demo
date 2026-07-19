"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { useEvents } from "@/hooks/useEvents";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { trendingNow, topRated } from "@/lib/discovery";
import { carriersForLeague } from "@/lib/leagues";
import { channelSlug } from "@/lib/sources";
import { nowAndNext } from "@/lib/tvEpg";
import TvBrowseScreen, { type TvBrowseItem, type TvBrowseRail } from "@/components/tv/TvBrowseScreen";
import TvChannelPanel from "@/components/tv/TvChannelPanel";
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

/** TV home: full-bleed hero that mirrors the focused card, rails for
 *  Continue Watching, Live sports, Live TV, and the trending catalog. */
export default function TvHomePage() {
  const { channels } = useChannels();
  const { data: events } = useEvents();
  const { movies, series, loading } = useTrendingCatalog();
  const { items: cwItems } = useContinueWatching();
  // A picked sporting event opens the channel panel (Watch Live + "Also on").
  const [picked, setPicked] = useState<{
    channel: Channel;
    title: string;
    alternates: Channel[];
  } | null>(null);

  const homeChannels = useMemo(() => {
    const online = channels.filter((c) => c.online);
    return (online.length > 0 ? online : channels).slice(0, CHANNELS_ON_HOME);
  }, [channels]);

  // Today's live/upcoming games with every carrier channel we actually have —
  // the hero finally mentions sports, and Enter offers all carriers.
  const sportItems = useMemo<TvBrowseItem[]>(() => {
    if (!events) return [];
    const out: TvBrowseItem[] = [];
    const seen = new Set<string>();
    for (const lg of events.leagues) {
      const carriers = carriersForLeague(lg.key, channels, channelSlug);
      if (carriers.length === 0) continue;
      for (const game of lg.games) {
        if (game.state === "post") continue;
        const key = `ev-${lg.key}-${game.id}`;
        if (seen.has(key)) continue; // the feed can list a game twice → dup React key
        seen.add(key);
        out.push({
          key: `ev-${lg.key}-${game.id}`,
          title: game.shortName,
          metaLine: [lg.name, game.detail].filter(Boolean).join(" · "),
          overview: `Watch on ${carriers.slice(0, 4).map((c) => c.name).join(" · ")}`,
          live: game.state === "in",
          event: {
            game,
            leagueName: lg.name,
            leagueLogo: lg.logo,
            onOpen: () =>
              setPicked({
                channel: carriers[0],
                title: game.shortName,
                alternates: carriers.slice(1),
              }),
          },
        });
      }
    }
    // Live games first, cap the rail.
    return out
      .sort((a, b) => Number(b.live ?? false) - Number(a.live ?? false))
      .slice(0, 10);
  }, [events, channels]);

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
        title: "Trending movies picked just for you",
        items: trendingNow(movies).slice(0, 18).map((m) => vodItem(m, "movie", "TRENDING")),
      },
      {
        title: "TV shows we think you'll like",
        items: trendingNow(series).slice(0, 18).map((s) => vodItem(s, "series", "TRENDING")),
      },
      { title: "Live sports", items: sportItems },
      {
        title: "Live TV",
        items: homeChannels.map(channelItem),
        trailing: (
          <Link
            href="/tv/live/guide"
            data-tv
            className="tv-card-shadow tv-channel-surface w-52 h-28 shrink-0 rounded-lg ring-1 ring-white/10 flex flex-col items-center justify-center gap-2 text-[#c7d5e0] focus:outline-none"
          >
            <Tv className="w-8 h-8" />
            <span className="text-base font-medium">Full guide</span>
          </Link>
        ),
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
  }, [cwItems, sportItems, homeChannels, movies, series]);

  return (
    <>
      <TvBrowseScreen
        rails={rails}
        loading={loading && movies.length === 0}
        loadingText="Loading catalog…"
      />
      {picked && (
        <TvChannelPanel
          channel={picked.channel}
          programs={picked.channel.programs}
          titleOverride={picked.title}
          alternates={picked.alternates}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}
