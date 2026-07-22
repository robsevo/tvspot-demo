"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import { useEvents } from "@/hooks/useEvents";
import { useChannelFavorites } from "@/hooks/useChannelFavorites";
import { channelSlug } from "@/lib/sources";
import { nowAndNext } from "@/lib/tvEpg";
import { carriersForLeague } from "@/lib/leagues";
import { listRecentChannels } from "@/lib/recentChannels";
import TvBrowseScreen, { type TvBrowseItem, type TvBrowseRail } from "@/components/tv/TvBrowseScreen";
import TvChannelPanel from "@/components/tv/TvChannelPanel";
import type { Channel, EpgProgram } from "@/lib/types";

const PER_RAIL = 40;
const EVENTS_TITLE = "Live and upcoming events";

/** A selected event carries its headline + every carrier channel into the
 *  panel (primary first, the rest as "Also on"). */
interface PickedEvent {
  channel: Channel;
  programs?: EpgProgram[];
  title?: string;
  alternates?: Channel[];
}

/**
 * Live TV, rebuilt on the same browse chassis as Home / Movies / Shows: a
 * follow-focus hero over category RAILS (no left sidebar — that's what clashed
 * with the rest of the app). Live events lead, then Recently watched,
 * Favorites, and one rail per channel category. Selecting a tile opens the
 * right-side channel panel (Watch Live / favorite / now-next).
 */
export default function TvLivePage() {
  const { channels, loading } = useChannels();
  const names = useMemo(() => channels.map((c) => c.name), [channels]);
  const { epg } = useEpg(names);
  const { data: events } = useEvents();
  const { names: favNames } = useChannelFavorites();

  const [picked, setPicked] = useState<PickedEvent | null>(null);

  const programsFor = useCallback(
    (c: Channel) => (epg[c.name]?.length ? epg[c.name] : c.programs),
    [epg],
  );

  const channelItem = useCallback(
    (c: Channel): TvBrowseItem => {
      const guide = nowAndNext(programsFor(c) ?? []);
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
    },
    [programsFor],
  );

  const recent = useMemo(() => {
    const slugs = listRecentChannels();
    return slugs
      .map((slug) => channels.find((c) => channelSlug(c.name) === slug))
      .filter((c): c is Channel => Boolean(c));
  }, [channels]);

  const favorites = useMemo(
    () => channels.filter((c) => favNames.includes(c.name)),
    [channels, favNames],
  );

  // Live/upcoming events cross-referenced to EVERY watchable carrier channel
  // (primary first — the panel offers the rest as "Also on").
  const eventItems = useMemo<TvBrowseItem[]>(() => {
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
          key,
          title: game.shortName,
          metaLine: [lg.name, game.detail].filter(Boolean).join(" · "),
          live: game.state === "in",
          event: {
            game,
            leagueKey: lg.key,
            leagueName: lg.name,
            leagueLogo: lg.logo,
            carriers: carriers.slice(0, 4).map((c) => c.name),
            onOpen: () =>
              setPicked({
                channel: carriers[0],
                programs: programsFor(carriers[0]),
                title: game.shortName,
                alternates: carriers.slice(1),
              }),
          },
        });
      }
    }
    return out
      .sort((a, b) => Number(b.live ?? false) - Number(a.live ?? false))
      .slice(0, 12);
  }, [events, channels, programsFor]);

  // One rail per channel category (uncategorized falls into "More channels"),
  // sorted alphabetically — browsable rails replace the old filter sidebar.
  const categoryRails = useMemo<TvBrowseRail[]>(() => {
    const byCat = new Map<string, Channel[]>();
    for (const c of channels) {
      const cat = c.category || "More channels";
      const bucket = byCat.get(cat);
      if (bucket) bucket.push(c);
      else byCat.set(cat, [c]);
    }
    const cats = Array.from(byCat.keys()).sort((a, b) => {
      if (a === "More channels") return 1;
      if (b === "More channels") return -1;
      return a.localeCompare(b);
    });
    // Backend categories are lowercase and often just "live" — title-case them,
    // and give that generic bucket a real name so the rail isn't a bare "live".
    const railTitle = (c: string) =>
      c === "More channels"
        ? c
        : /^(live|tv|all)$/i.test(c)
          ? "All channels"
          : c.replace(/\b\w/g, (m) => m.toUpperCase());
    return cats.map((cat) => ({
      title: railTitle(cat),
      items: byCat.get(cat)!.slice(0, PER_RAIL).map(channelItem),
    }));
  }, [channels, channelItem]);

  const rails = useMemo<TvBrowseRail[]>(() => {
    const fullGuideTile = (
      <Link
        href="/tv/live/guide"
        data-tv
        className="tv-card-shadow tv-channel-surface w-52 h-28 shrink-0 rounded-lg ring-1 ring-white/10 flex flex-col items-center justify-center gap-2 text-[#c7d5e0] focus:outline-none"
      >
        <Tv className="w-8 h-8" />
        <span className="text-base font-semibold">Full guide</span>
      </Link>
    );

    const list: TvBrowseRail[] = [];
    if (eventItems.length > 0) list.push({ title: EVENTS_TITLE, items: eventItems });
    if (recent.length > 0) list.push({ title: "Recently watched", items: recent.map(channelItem) });
    if (favorites.length > 0) list.push({ title: "Favorites", items: favorites.map(channelItem) });
    list.push(...categoryRails);

    // Anchor the Full-guide entry at the START of the first channel rail (skip
    // the events rail, whose tiles are a different shape). Leading, not
    // trailing: the guide is a primary destination, and burying it past a rail
    // of channels meant holding Right to reach it. As the first tile it also
    // catches the downward move into the rail, since TvNav snaps a vertical
    // entry onto the row's first tile. Immutable — never touch the memoized
    // category-rail objects in place.
    const anchorIdx = list.findIndex((r) => r.title !== EVENTS_TITLE && r.items.length > 0);
    const idx = anchorIdx === -1 ? 0 : anchorIdx;
    return list.map((r, i) => (i === idx ? { ...r, leading: fullGuideTile } : r));
  }, [eventItems, recent, favorites, categoryRails, channelItem]);

  return (
    <>
      <TvBrowseScreen
        rails={rails}
        loading={loading && channels.length === 0}
        loadingText="Loading channels…"
        onChannelSelect={(c) => setPicked({ channel: c, programs: programsFor(c) })}
      />
      {picked && (
        <TvChannelPanel
          channel={picked.channel}
          programs={picked.programs}
          titleOverride={picked.title}
          alternates={picked.alternates}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}
