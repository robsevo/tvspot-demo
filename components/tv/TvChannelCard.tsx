"use client";

import Link from "next/link";
import { LogoImage } from "@/components/LogoImage";
import { channelSlug } from "@/lib/sources";
import type { Channel } from "@/lib/types";

/** Live-channel tile for TV rails/grids: logo front and center, name below,
 *  offline channels dimmed (still openable — the player re-verifies live). */
export default function TvChannelCard({ channel }: { channel: Channel }) {
  return (
    <Link
      href={`/tv/live/${channelSlug(channel.name)}`}
      data-tv
      className={`block w-52 shrink-0 focus:outline-none ${channel.online ? "" : "opacity-50"}`}
    >
      <div className="h-28 rounded-xl bg-card ring-1 ring-white/5 flex items-center justify-center p-4">
        <LogoImage
          name={channel.name}
          logoUrl={channel.logo_url || channel.logo}
          className="w-full h-full"
          fallbackClassName="text-2xl font-bold text-white/80"
        />
      </div>
      <p className="mt-2 text-base text-text-secondary text-center truncate">{channel.name}</p>
    </Link>
  );
}
