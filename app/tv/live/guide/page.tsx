"use client";

import { useMemo, useState } from "react";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import { useChannelFavorites } from "@/hooks/useChannelFavorites";
import TvEpgGrid from "@/components/tv/TvEpgGrid";

const ALL = "All";
const FAVORITES = "Favorites";

/** Full timeline guide (the web app's EPG grid, D-pad edition): category chips
 *  up top, channel rows × time columns below. Enter on a block tunes to that
 *  channel; Back returns to Live TV. */
export default function TvGuidePage() {
  const { channels, loading } = useChannels();
  const names = useMemo(() => channels.map((c) => c.name), [channels]);
  const { epg } = useEpg(names);
  const { names: favNames } = useChannelFavorites();
  const [category, setCategory] = useState<string>(ALL);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) if (c.category) set.add(c.category);
    return [ALL, FAVORITES, ...Array.from(set).sort()];
  }, [channels]);

  const shown = useMemo(() => {
    const base =
      category === ALL
        ? channels
        : category === FAVORITES
          ? channels.filter((c) => favNames.includes(c.name))
          : channels.filter((c) => c.category === category);
    // Online channels first — dead rows sink to the bottom of the guide.
    //
    // NO CAP. This used to .slice(0, 40), which silently hid 85 of 125 channels
    // — the guide is the dense "browse everything" surface, so a channel missing
    // from it reads as the channel being gone. Same failure the rails already
    // fixed (a71dce3: "truncating a rail is how the channels went missing in the
    // first place, and it fails silently by construction").
    //
    // Measured on the actual Samsung UN58RU7100FXZC (Tizen 5.0 / Chromium 63)
    // over CDP, same script both times — 40 rows vs all 125:
    //
    //   DOM nodes    1037 -> 2991      focusables    234 -> 687
    //   images         41 -> 125       first paint  2129ms -> 3420ms
    //   JS heap      10MB -> 10MB      (device limit: 368MB)
    //
    // The heap did not move and sits at ~3% of what this box allows, so the
    // budget the cap was guarding was never the real constraint. The cost is
    // ~1.3s more on first paint, paid once when the guide opens, in exchange for
    // 85 channels that were previously unreachable here. /tv/live already
    // renders all 125 with eager logos, so that load was proven on this TV
    // first. If first paint ever becomes the complaint, window the rows around
    // the focused one — do NOT reintroduce a silent cap.
    return [...base].sort((a, b) => Number(b.online) - Number(a.online));
  }, [channels, category, favNames]);

  return (
    <div className="flex flex-col h-[calc(100vh-76px)] pl-16 pr-4">
      <div className="flex items-center gap-3 pb-4 overflow-x-auto shrink-0">
        <h1 className="text-3xl font-bold text-white mr-4 shrink-0">TV Guide</h1>
        {categories.map((cat) => (
          <button
            key={cat}
            data-tv
            onClick={() => setCategory(cat)}
            className={`tv-pill px-4 py-1.5 rounded-full text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
              category === cat
                ? "bg-[#1399ff] text-white font-semibold"
                : "bg-[#121a24] text-[#aebbc5] ring-1 ring-white/10"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading && channels.length === 0 ? (
        <p className="text-xl text-[#8197a4]">Loading guide…</p>
      ) : (
        <TvEpgGrid channels={shown} epg={epg} />
      )}
    </div>
  );
}
