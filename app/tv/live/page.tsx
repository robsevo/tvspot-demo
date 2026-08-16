"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import { useEvents } from "@/hooks/useEvents";
import { useChannelFavorites } from "@/hooks/useChannelFavorites";
import { channelSlug } from "@/lib/sources";
import { getChannelType } from "@/lib/logos";
import { nowAndNext } from "@/lib/tvEpg";
import { carriersForGame } from "@/lib/leagues";
import { listRecentChannels } from "@/lib/recentChannels";
import TvBrowseScreen, { type TvBrowseItem, type TvBrowseRail } from "@/components/tv/TvBrowseScreen";
import TvChannelPanel from "@/components/tv/TvChannelPanel";
import { loopShowName } from "@/lib/channelProgramming";
import type { Channel, EpgProgram } from "@/lib/types";

const EVENTS_TITLE = "Live and upcoming events";

/** Rail order, copied from the web guide's tabs so both clients group the live
 *  lineup identically. */
const TYPE_ORDER = ["Sports", "News", "Entertainment", "Movies", "Kids", "Music", "Lifestyle"];

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
      // See app/tv/page.tsx — 24/7 loop channels have no schedule to miss.
      const loop = loopShowName(c.name);
      return {
        key: `ch-${c.name}`,
        title: guide.now?.title || loop || c.name,
        metaLine: guide.now || loop
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
      for (const game of lg.games) {
        if (game.state === "post") continue;
        // Per GAME, not per league: "TSN carries MLS" is not "this match is on
        // TSN". Measured 2026-08-16 — every MLS game was on Apple TV and every
        // La Liga game on ESPN+, both already in the lineup, while the league
        // list pointed at TSN. carriersForGame prefers the game's own
        // broadcasters and falls back to the league brands only if none match.
        const { carriers } = carriersForGame(lg.key, game.broadcasts, channels, channelSlug);
        if (carriers.length === 0) continue;
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

  // One rail per channel TYPE, derived from the channel name — never from
  // `c.category`, which the backend hardcodes to the string "live" for every
  // lounge channel (main.py builds it that way in both branches). Grouping on
  // that field put all 125 channels in ONE rail, and the per-rail cap then
  // silently dropped everything past the 40th: the lineup looked cut down to a
  // third of itself, with ESPN+ onward simply absent.
  //
  // The web guide already hit this and solved it — see app/(main)/live, whose
  // tabs classify with getChannelType for exactly this reason. Reusing that one
  // function (rather than a second TV-only classifier) is what keeps the two
  // clients showing the same groups.
  //
  // No cap: truncating a rail is how the channels went missing in the first
  // place, and it fails silently by construction. Sports is the biggest bucket
  // (~45 of 125) and rails scroll horizontally, so the cost is a longer press
  // of Right — while the Full guide stays the dense way to browse everything.
  const categoryRails = useMemo<TvBrowseRail[]>(() => {
    const byType = new Map<string, Channel[]>();
    for (const c of channels) {
      const t = getChannelType(c.name);
      const bucket = byType.get(t);
      if (bucket) bucket.push(c);
      else byType.set(t, [c]);
    }
    const rank = (t: string) => {
      const i = TYPE_ORDER.indexOf(t);
      return i < 0 ? TYPE_ORDER.length : i; // unknown types sort last, stably
    };
    return Array.from(byType.keys())
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((type) => ({
        title: type,
        items: byType
          .get(type)!
          // Keep the lineup's own running order within a rail, like the web guide.
          .slice()
          .sort((a, b) => (a.channel_number || 0) - (b.channel_number || 0))
          .map(channelItem),
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
