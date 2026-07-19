"use client";

import { useMemo, useState } from "react";
import { LogoImage } from "@/components/LogoImage";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import { useEvents } from "@/hooks/useEvents";
import { useChannelFavorites } from "@/hooks/useChannelFavorites";
import { channelSlug } from "@/lib/sources";
import { nowAndNext } from "@/lib/tvEpg";
import { carrierForLeague } from "@/lib/leagues";
import { listRecentChannels } from "@/lib/recentChannels";
import TvChannelPanel from "@/components/tv/TvChannelPanel";
import type { Channel, EpgProgram } from "@/lib/types";
import type { GameEvent } from "@/lib/leagues";

const ALL = "All";
const FAVORITES = "Favorites";

/** A selected event carries its headline + carrier channel into the panel. */
interface PickedEvent {
  channel: Channel;
  programs?: EpgProgram[];
  title?: string;
}

/** Prime-style Live TV: category sidebar on the left, a "Live and upcoming
 *  events" rail up top, then Recently watched and station rows. Choosing any
 *  tile opens the right-side channel panel (Watch Live / favorite). */
export default function TvLivePage() {
  const { channels, loading } = useChannels();
  const names = useMemo(() => channels.map((c) => c.name), [channels]);
  const { epg } = useEpg(names);
  const { data: events } = useEvents();
  const { names: favNames } = useChannelFavorites();

  const [category, setCategory] = useState<string>(ALL);
  const [picked, setPicked] = useState<PickedEvent | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) if (c.category) set.add(c.category);
    return [ALL, FAVORITES, ...Array.from(set).sort()];
  }, [channels]);

  const shown = useMemo(() => {
    if (category === ALL) return channels;
    if (category === FAVORITES) return channels.filter((c) => favNames.includes(c.name));
    return channels.filter((c) => c.category === category);
  }, [channels, category, favNames]);

  const recent = useMemo(() => {
    const slugs = listRecentChannels();
    return slugs
      .map((slug) => channels.find((c) => channelSlug(c.name) === slug))
      .filter((c): c is Channel => Boolean(c));
  }, [channels]);

  // Live/upcoming events cross-referenced to a watchable carrier channel.
  const liveEvents = useMemo(() => {
    if (!events) return [];
    const out: Array<{ key: string; game: GameEvent; leagueName: string; channel: Channel }> = [];
    for (const lg of events.leagues) {
      const carrier = carrierForLeague(lg.key, channels, channelSlug) as Channel | null;
      if (!carrier) continue;
      for (const game of lg.games) {
        if (game.state === "post") continue;
        out.push({ key: `${lg.key}-${game.id}`, game, leagueName: lg.name, channel: carrier });
      }
    }
    return out
      .sort((a, b) => (a.game.state === "in" ? -1 : 1) - (b.game.state === "in" ? -1 : 1))
      .slice(0, 12);
  }, [events, channels]);

  const openChannel = (c: Channel) =>
    setPicked({ channel: c, programs: epg[c.name]?.length ? epg[c.name] : c.programs });

  return (
    <div className="flex h-[calc(100vh-76px)]">
      {/* Category sidebar */}
      <aside className="w-52 shrink-0 overflow-y-auto py-4 pl-8 pr-2">
        {categories.map((cat, i) => (
          <button
            key={cat}
            data-tv
            {...(i === 0 ? { "data-tv-autofocus": true } : {})}
            onFocus={() => setCategory(cat)}
            className={`tv-pill block w-full text-left px-4 py-2.5 rounded-lg text-xl focus:outline-none focus:bg-white focus:text-black ${
              category === cat ? "text-white font-bold" : "text-[#8197a4] font-medium"
            }`}
          >
            {cat}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pr-16 pb-16">
        {loading && channels.length === 0 && (
          <p className="pt-6 text-xl text-[#8197a4]">Loading channels…</p>
        )}

        {liveEvents.length > 0 && category === ALL && (
          <section className="pt-4">
            <h2 className="text-2xl font-bold text-white mb-4">Live and upcoming events</h2>
            <div className="flex gap-5 overflow-x-auto py-2">
              {liveEvents.map(({ key, game, leagueName, channel }) => (
                <button
                  key={key}
                  data-tv
                  onClick={() =>
                    setPicked({
                      channel,
                      programs: epg[channel.name]?.length ? epg[channel.name] : channel.programs,
                      title: game.shortName,
                    })
                  }
                  className="w-96 shrink-0 text-left rounded-lg overflow-hidden bg-[#1a242f] ring-1 ring-white/10 focus:outline-none"
                >
                  <div className="relative h-44 flex items-center justify-center gap-8 bg-gradient-to-br from-[#16233a] to-[#0c1320] px-6">
                    {game.state === "in" && (
                      <span className="absolute top-3 right-3 text-xs font-bold tracking-wider text-white bg-[#c7040c] rounded px-2 py-0.5">
                        LIVE
                      </span>
                    )}
                    <TeamCrest logo={game.away.logo} name={game.away.name} />
                    <span className="text-2xl font-bold text-white/60">vs</span>
                    <TeamCrest logo={game.home.logo} name={game.home.name} />
                  </div>
                  <div className="px-5 py-3">
                    <p className="text-lg font-semibold text-white truncate">{game.shortName}</p>
                    <p className="text-base text-[#8197a4] truncate">
                      {leagueName} · {game.detail}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && category === ALL && (
          <ChannelRow title="Recently watched" channels={recent} epg={epg} onOpen={openChannel} />
        )}

        <ChannelRow
          title={category === ALL ? "Your stations" : category}
          channels={shown}
          epg={epg}
          onOpen={openChannel}
        />
      </div>

      {picked && (
        <TvChannelPanel
          channel={picked.channel}
          programs={picked.programs}
          titleOverride={picked.title}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}

function TeamCrest({ logo, name }: { logo?: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      {logo ? (
        <img src={logo} alt="" referrerPolicy="no-referrer" className="w-14 h-14 object-contain" />
      ) : (
        <div className="w-14 h-14 rounded-full bg-white/10" />
      )}
      <span className="text-xs text-[#aebbc5] truncate max-w-24 text-center">{name}</span>
    </div>
  );
}

/** A horizontal row of live-channel list rows (logo + now/next), each opening
 *  the channel panel. Used for Recently watched and Your stations. */
function ChannelRow({
  title,
  channels,
  epg,
  onOpen,
}: {
  title: string;
  channels: Channel[];
  epg: Record<string, EpgProgram[]>;
  onOpen: (c: Channel) => void;
}) {
  if (channels.length === 0) return null;
  return (
    <section className="pt-8">
      <h2 className="text-2xl font-bold text-white mb-4">{title}</h2>
      <div className="grid grid-cols-2 gap-4">
        {channels.map((c) => {
          const guide = nowAndNext(epg[c.name]?.length ? epg[c.name] : c.programs);
          return (
            <button
              key={c.name}
              data-tv
              onClick={() => onOpen(c)}
              className={`flex items-center gap-5 rounded-lg bg-[#121a24] ring-1 ring-white/10 px-5 py-4 text-left focus:outline-none ${
                c.online ? "" : "opacity-50"
              }`}
            >
              <div className="w-24 h-14 shrink-0 flex items-center justify-center">
                <LogoImage
                  name={c.name}
                  logoUrl={c.logo_url || c.logo}
                  className="w-full h-full"
                  fallbackClassName="text-lg font-bold text-white/80"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold text-[#8197a4] truncate">{c.name}</p>
                  {c.online && (
                    <span className="text-[10px] font-bold tracking-wider text-white bg-[#c7040c] rounded px-1.5 py-0.5 shrink-0">
                      LIVE
                    </span>
                  )}
                </div>
                <p className="text-lg font-semibold text-white truncate mt-0.5">
                  {guide.now?.title || (c.online ? "Live programming" : "Offline")}
                </p>
                {guide.now && (
                  <div className="mt-2 h-1 max-w-xs rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full bg-[#1399ff]"
                      style={{ width: `${Math.round(guide.progress)}%` }}
                    />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
