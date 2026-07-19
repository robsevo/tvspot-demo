"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Check } from "lucide-react";
import { useTvBack } from "@/components/tv/TvNav";
import { useChannelFavorites } from "@/hooks/useChannelFavorites";
import { channelSlug } from "@/lib/sources";
import { nowAndNext, fmtTime } from "@/lib/tvEpg";
import type { Channel, EpgProgram } from "@/lib/types";

interface Props {
  channel: Channel;
  /** EPG programmes for this channel (falls back to its game-guide entries). */
  programs?: EpgProgram[];
  /** Override headline (e.g. the live event the user picked). */
  titleOverride?: string;
  onClose: () => void;
}

/** Prime-style channel panel: choosing a channel slides this over the right
 *  side — Watch Live, favorite toggle, and what's on now/next. Back closes. */
export default function TvChannelPanel({ channel, programs, titleOverride, onClose }: Props) {
  const router = useRouter();
  const { toggle, isFavorite } = useChannelFavorites();
  const watchRef = useRef<HTMLButtonElement | null>(null);

  const stableClose = useCallback(() => onClose(), [onClose]);
  useTvBack(stableClose);

  // The remote's cursor must land in the panel the moment it opens.
  useEffect(() => {
    watchRef.current?.focus();
  }, []);

  const guide = nowAndNext(programs?.length ? programs : (channel.programs ?? []));
  const headline = titleOverride || guide.now?.title || channel.name;
  const timeline = guide.now
    ? `${fmtTime(guide.now.start_utc)} – ${fmtTime(guide.now.stop_utc)}`
    : null;
  const fav = isFavorite(channel.name);

  return (
    <div data-tv-trap className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute right-0 inset-y-0 w-[30rem] bg-[#0a1017]/95 px-10 pt-28 flex flex-col gap-4 animate-[slideInRight_0.2s_ease]">
        <div className="flex items-center gap-3">
          {channel.online && (
            <span className="text-sm font-bold tracking-wider text-white bg-[#c7040c] rounded px-2 py-0.5">
              LIVE
            </span>
          )}
          {timeline && <span className="text-lg text-[#aebbc5]">{timeline}</span>}
        </div>

        <h2 className="text-3xl font-bold text-white leading-tight">{headline}</h2>
        {headline !== channel.name && (
          <p className="text-lg text-[#8197a4] -mt-2">{channel.name}</p>
        )}

        <button
          ref={watchRef}
          data-tv
          onClick={() => router.push(`/tv/live/${channelSlug(channel.name)}`)}
          className="tv-pill mt-4 flex items-center gap-4 bg-white text-black rounded-lg px-6 py-4 text-left focus:outline-none focus:ring-4 focus:ring-white/60"
        >
          <Play className="w-6 h-6 fill-black shrink-0" />
          <span>
            <span className="block text-xl font-bold">Watch Live</span>
            <span className="block text-base text-black/70">{channel.name} broadcast</span>
          </span>
        </button>

        <button
          data-tv
          onClick={() => toggle(channel.name)}
          className="tv-pill group flex items-center gap-4 px-6 py-4 rounded-lg text-left focus:outline-none focus:bg-white"
        >
          {fav ? (
            <Check className="w-6 h-6 text-white group-focus:text-black shrink-0" />
          ) : (
            <Plus className="w-6 h-6 text-white group-focus:text-black shrink-0" />
          )}
          <span className="text-xl text-white group-focus:text-black">
            {fav ? "Remove from Favorites" : "Add to Favorites"}
          </span>
        </button>

        {guide.next && (
          <p className="mt-6 text-lg text-[#8197a4]">
            Next · {fmtTime(guide.next.start_utc)} — {guide.next.title}
          </p>
        )}
      </div>
    </div>
  );
}
