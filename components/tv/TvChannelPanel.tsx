"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Check } from "lucide-react";
import { LogoImage } from "@/components/LogoImage";
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
  /** Other channels carrying the same event — rendered as an "Also on" list. */
  alternates?: Channel[];
  onClose: () => void;
}

/** Prime-style channel panel: choosing a channel slides this over the right
 *  side — Watch Live, favorite toggle, and what's on now/next. Back closes. */
export default function TvChannelPanel({ channel, programs, titleOverride, alternates, onClose }: Props) {
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
      <div className="tv-glass absolute right-0 inset-y-0 w-[30rem] px-10 pt-28 flex flex-col gap-4 animate-[slideInRight_0.2s_ease]">
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

        {/* tv-menu-item: white-pill focus via plain CSS — group-focus is dead
            on the TV's engine (compiles to :is/:where), which made this label
            white-on-white when focused. */}
        <button
          data-tv
          onClick={() => toggle(channel.name)}
          className="tv-pill tv-menu-item flex items-center gap-4 px-6 py-4 rounded-lg text-left focus:outline-none"
        >
          {fav ? (
            <Check className="w-6 h-6 text-white shrink-0" />
          ) : (
            <Plus className="w-6 h-6 text-white shrink-0" />
          )}
          <span className="text-xl text-white">
            {fav ? "Remove from Favorites" : "Add to Favorites"}
          </span>
        </button>

        {alternates && alternates.length > 0 && (
          <div className="mt-4">
            <p className="text-base font-semibold text-[#8197a4] mb-2">Also on</p>
            <div className="flex flex-col gap-2 overflow-y-auto max-h-72">
              {alternates.map((alt) => (
                <button
                  key={alt.name}
                  data-tv
                  onClick={() => router.push(`/tv/live/${channelSlug(alt.name)}`)}
                  className="tv-pill tv-menu-item flex items-center gap-4 px-4 py-2.5 rounded-lg text-left focus:outline-none"
                >
                  <div className="w-16 h-9 shrink-0 flex items-center justify-center">
                    <LogoImage
                      name={alt.name}
                      logoUrl={alt.logo_url || alt.logo}
                      className="w-full h-full"
                      fallbackClassName="text-sm font-bold text-white/80"
                      eager
                    />
                  </div>
                  <span className="text-lg text-white truncate">{alt.name}</span>
                  {alt.online && (
                    <span className="ml-auto shrink-0 text-[10px] font-bold tracking-wider text-white bg-[#c7040c] rounded px-1.5 py-0.5">
                      LIVE
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {guide.next && (
          <p className="mt-6 text-lg text-[#8197a4]">
            Next · {fmtTime(guide.next.start_utc)} — {guide.next.title}
          </p>
        )}
      </div>
    </div>
  );
}
