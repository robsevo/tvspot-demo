"use client";

import { useState, type ReactNode } from "react";
import TvRail from "@/components/tv/TvRail";
import TvLandscapeCard from "@/components/tv/TvLandscapeCard";
import TvChannelCard from "@/components/tv/TvChannelCard";
import type { Channel } from "@/lib/types";

export interface TvBrowseItem {
  key: string;
  title: string;
  kind?: "movie" | "series";
  tmdbId?: number;
  backdrop?: string;
  poster?: string;
  overview?: string;
  /** "2016 · 16+ · 1 season" line under the hero title. */
  metaLine?: string;
  /** White corner/hero badge: "TRENDING", "ON NOW", "TOP 10"… */
  badge?: string;
  /** Red LIVE badge (live channels / events). */
  live?: boolean;
  /** Provider wordmark (hero eyebrow + card corner). */
  provider?: string;
  progress?: number;
  sublabel?: string;
  /** Present → renders as a channel tile linking to its live player. */
  channel?: Channel;
}

export interface TvBrowseRail {
  title: string;
  items: TvBrowseItem[];
  /** Extra tile at the end of the row (e.g. a "Full guide" link). */
  trailing?: ReactNode;
}

/**
 * The Prime Video browse chassis: a pinned hero pane that always describes
 * the FOCUSED card (art top-right, details top-left), with the rails
 * scrolling in their own pane underneath — moving through a rail never
 * pushes the hero off screen, it just rewrites it.
 */
export default function TvBrowseScreen({
  rails,
  loading,
  loadingText = "Loading…",
}: {
  rails: TvBrowseRail[];
  loading?: boolean;
  loadingText?: string;
}) {
  const [focused, setFocused] = useState<TvBrowseItem | null>(null);
  const first = rails.find((r) => r.items.length > 0)?.items[0] ?? null;
  const shown = focused ?? first;
  const art = shown?.backdrop || shown?.poster;

  return (
    <div className="relative h-[calc(100vh-76px)] flex flex-col overflow-hidden">
      {/* Backdrop art for the focused title, bleeding in from the top-right
          and fading into the page glow on its left and bottom edges. */}
      {art && (
        <div key={art} className="absolute top-0 right-0 w-[68%] h-[72%] animate-[fadeIn_0.4s_ease]">
          <img
            src={art}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#00050d] via-[#00050d]/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#00050d] via-[#00050d]/30 to-transparent" />
        </div>
      )}

      {/* Focused-title details, pinned top-left like Prime's. */}
      <div className="relative z-10 flex-none h-[34vh] px-16 max-w-3xl flex flex-col justify-center">
        {shown ? (
          <>
            {shown.provider && (
              <p className="text-lg font-bold text-white/85 mb-1">{shown.provider}</p>
            )}
            <h1 className="text-5xl font-bold text-white leading-tight line-clamp-2 mb-3">
              {shown.title}
            </h1>
            <div className="flex items-center gap-3">
              {shown.live && (
                <span className="text-sm font-bold tracking-wider text-white bg-[#c7040c] rounded px-2 py-0.5">
                  LIVE
                </span>
              )}
              {shown.badge && (
                <span className="text-sm font-bold tracking-wide text-black bg-white rounded px-2 py-0.5">
                  {shown.badge}
                </span>
              )}
              {shown.metaLine && <p className="text-lg text-[#aebbc5]">{shown.metaLine}</p>}
            </div>
            {shown.overview && (
              <p className="text-lg text-[#c7d5e0] leading-relaxed line-clamp-3 mt-3">
                {shown.overview}
              </p>
            )}
          </>
        ) : loading ? (
          <p className="text-xl text-[#8197a4]">{loadingText}</p>
        ) : null}
      </div>

      {/* Rails scroll in their own pane; the hero above never moves. */}
      <div className="relative z-10 flex-1 overflow-y-auto pb-12">
        {rails.map(
          (rail, railIdx) =>
            (rail.items.length > 0 || rail.trailing) && (
              <TvRail key={rail.title} title={rail.title}>
                {rail.items.map((item, i) => {
                  const focusProps = {
                    onCardFocus: () => setFocused(item),
                    tvAutoFocus: railIdx === 0 && i === 0,
                  };
                  return item.channel ? (
                    <TvChannelCard key={item.key} channel={item.channel} {...focusProps} />
                  ) : (
                    <TvLandscapeCard
                      key={item.key}
                      tmdbId={item.tmdbId!}
                      title={item.title}
                      backdrop={item.backdrop}
                      poster={item.poster}
                      kind={item.kind!}
                      progress={item.progress}
                      sublabel={item.sublabel}
                      badge={item.badge}
                      provider={item.provider}
                      showTitle={false}
                      {...focusProps}
                    />
                  );
                })}
                {rail.trailing}
              </TvRail>
            ),
        )}
      </div>
    </div>
  );
}
