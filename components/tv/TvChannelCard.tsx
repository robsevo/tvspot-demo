"use client";

import Link from "next/link";
import { LogoImage } from "@/components/LogoImage";
import { channelSlug } from "@/lib/sources";
import type { Channel } from "@/lib/types";

/** Live-channel tile: logo on a colored card surface, LIVE badge when online,
 *  name below. Offline channels dim (still openable — the player re-verifies).
 *  If `onSelect` is given the tile opens the channel panel (Live TV screen);
 *  otherwise it links straight to the player (home rail). */
export default function TvChannelCard({
  channel,
  onCardFocus,
  onSelect,
  tvAutoFocus,
}: {
  channel: Channel;
  /** Hero-follows-focus: the browse screen listens here. */
  onCardFocus?: () => void;
  /** When set, selecting the tile opens the channel panel instead of tuning. */
  onSelect?: () => void;
  /** Seed the remote's cursor here on page entry. */
  tvAutoFocus?: boolean;
}) {
  const common = {
    "data-tv": true as const,
    ...(tvAutoFocus ? { "data-tv-autofocus": true } : {}),
    onFocus: onCardFocus,
    className: `block w-52 shrink-0 focus:outline-none ${channel.online ? "" : "opacity-50"}`,
  };

  const inner = (
    <>
      <div className="tv-card-shadow tv-channel-surface relative h-28 rounded-lg ring-1 ring-white/10 flex items-center justify-center p-5">
        <LogoImage
          name={channel.name}
          logoUrl={channel.logo_url || channel.logo}
          className="w-full h-full"
          fallbackClassName="text-2xl font-bold text-white/80"
          eager
        />
        {channel.online && (
          <span className="absolute top-2 right-2 text-[11px] font-bold tracking-wider text-white bg-[#c7040c] rounded px-1.5 py-0.5">
            LIVE
          </span>
        )}
      </div>
      <p className="mt-2 text-base text-[#c7d5e0] text-center truncate">{channel.name}</p>
    </>
  );

  if (onSelect) {
    return (
      <button type="button" {...common} onClick={onSelect}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={`/tv/live/${channelSlug(channel.name)}`} {...common}>
      {inner}
    </Link>
  );
}
