"use client";

import { useEffect, useState, type ReactNode } from "react";
import TvRail from "@/components/tv/TvRail";
import TvLandscapeCard from "@/components/tv/TvLandscapeCard";
import TvChannelCard from "@/components/tv/TvChannelCard";
import TvEventCard from "@/components/tv/TvEventCard";
import type { Channel } from "@/lib/types";
import type { GameEvent } from "@/lib/leagues";

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
  /** For a series tile that should open a SPECIFIC episode (Continue Watching):
   *  the card deep-links to /tv/vod/series/<id>?s=&e=&play=1 so it lands on and
   *  resumes that episode instead of the show's first. */
  season?: number;
  episode?: number;
  /** Present → renders as a channel tile linking to its live player. */
  channel?: Channel;
  /** Present → renders as a live-event tile; onOpen decides what happens. */
  event?: {
    game: GameEvent;
    leagueName: string;
    leagueLogo?: string;
    onOpen: () => void;
  };
}

export interface TvBrowseRail {
  title: string;
  items: TvBrowseItem[];
  /** Extra tile at the end of the row (e.g. a "Full guide" link). */
  trailing?: ReactNode;
}

/** Rails painted on the very first frame — the hero plus one rail is a complete
 *  screen to look at, and holds initial focus. */
const RAILS_FIRST_PAINT = 1;
/** How many more to add per step, and how long to leave the renderer alone
 *  between steps. Tuned to be generous on the slowest device we support rather
 *  than snappy on a desktop; the rails below the fold aren't visible yet anyway. */
const RAILS_PER_STEP = 1;
const RAIL_STEP_MS = 400;

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
  onChannelSelect,
}: {
  rails: TvBrowseRail[];
  loading?: boolean;
  loadingText?: string;
  /** When set, channel tiles open the channel panel instead of tuning
   *  directly — the Live TV screen wants Watch Live / favorite / now-next. */
  onChannelSelect?: (channel: Channel) => void;
}) {
  const [focused, setFocused] = useState<TvBrowseItem | null>(null);

  /**
   * Mount rails a few at a time instead of all at once.
   *
   * A cold, direct load of a browse screen used to take the 2019 Samsung's
   * renderer down completely — the process stopped answering, no JS execution
   * context, nothing on screen but the launcher splash. Reaching the SAME screen
   * by navigating from another page was always fine, and the measured
   * difference was not size but SIMULTANEITY: arriving by navigation puts a
   * gap (auth round-trip, route change) between parsing/hydrating the bundle
   * and building the full screen, while a cold load does both back to back.
   * Cutting decoded image memory 3.2x did NOT fix it, so the trigger is the
   * concurrent burst of layout + decode + data work, not any single resource.
   *
   * Staggering reproduces that gap deliberately: paint the hero and the first
   * rail, hand the frame back, then add the rest. Everything still arrives, just
   * not in one blocking chunk. The first rail is what holds initial D-pad focus
   * (tvAutoFocus below), so this is invisible in use.
   */
  const [railBudget, setRailBudget] = useState(RAILS_FIRST_PAINT);
  useEffect(() => {
    if (railBudget >= rails.length) return;
    // A timer, not requestIdleCallback: rIC is Chrome 47+ but unreliable on this
    // webview under load, and "later" is the only guarantee we actually need.
    const t = setTimeout(
      () => setRailBudget((n) => n + RAILS_PER_STEP),
      RAIL_STEP_MS,
    );
    return () => clearTimeout(t);
  }, [railBudget, rails.length]);
  // The landing hero must be a real IMAGE (like the reference), not the first
  // rail's tile when that's a sports event or channel (no backdrop → a dark
  // void). Default to the first backdrop/poster-bearing item; focus still takes
  // over the moment the user moves.
  const firstVisual = rails.flatMap((r) => r.items).find((it) => it.backdrop || it.poster) ?? null;
  const fallback = rails.find((r) => r.items.length > 0)?.items[0] ?? null;
  const shown = focused ?? firstVisual ?? fallback;
  const art = shown?.backdrop || shown?.poster;

  return (
    <div className="relative h-[calc(100vh-76px)] flex flex-col overflow-hidden">
      {/* Google-TV-style immersive hero: fills the top ~72% edge to edge and
          dissolves into the page through the handwritten fades (Tailwind
          gradient utilities compile color-mix into --tw vars and never paint on
          the TV — that was the original clash). A focused sports event has no
          backdrop, so it renders its own themed hero (league wash + crests)
          instead of a blank void. */}
      {shown?.event ? (
        <div key={`hero-art-${shown.key}`} className="tv-event-art absolute inset-x-0 top-0 h-[72%] animate-[fadeIn_0.5s_ease]">
          {shown.event.leagueLogo && (
            <img
              src={shown.event.leagueLogo}
              alt=""
              referrerPolicy="no-referrer"
              className="pointer-events-none absolute right-[7%] top-1/2 -translate-y-1/2 w-[38%] max-w-2xl object-contain opacity-[0.10]"
            />
          )}
          <div className="absolute right-[9%] top-[42%] -translate-y-1/2 flex items-center gap-14">
            <HeroCrest logo={shown.event.game.away.logo} name={shown.event.game.away.name} />
            <span className="text-4xl font-black text-white/35">VS</span>
            <HeroCrest logo={shown.event.game.home.logo} name={shown.event.game.home.name} />
          </div>
          <div className="tv-fade-hero-l absolute inset-0" />
          <div className="tv-fade-hero-b absolute inset-0" />
        </div>
      ) : art ? (
        <div key={`hero-art-${art}`} className="absolute inset-x-0 top-0 h-[72%] animate-[fadeIn_0.5s_ease]">
          <img
            src={art}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center"
          />
          <div className="tv-fade-hero-l absolute inset-0" />
          <div className="tv-fade-hero-b absolute inset-0" />
        </div>
      ) : null}

      {/* Hero copy, BOTTOM-anchored low in the art (like the reference) so the
          rails can tuck directly under it. Keyed by the focused item so each
          focus move crossfades the text instead of hard-swapping it. */}
      <div
        key={`hero-copy-${shown?.key ?? "empty"}`}
        className="relative z-10 flex-none h-[52vh] px-16 max-w-4xl flex flex-col justify-end pb-6 animate-[fadeIn_0.35s_ease]"
      >
        {shown ? (
          <>
            {shown.provider && (
              <p className="text-lg font-bold tracking-wide text-white/90 mb-2 hero-text-shadow">
                {shown.provider}
              </p>
            )}
            <h1 className="text-7xl font-extrabold text-white leading-[1.05] line-clamp-2 mb-3 hero-text-shadow">
              {shown.title}
            </h1>
            <div className="flex items-center gap-3 mb-2">
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
              {shown.metaLine && (
                <p className="text-lg font-medium text-[#c7d5e0] hero-text-shadow">{shown.metaLine}</p>
              )}
            </div>
            {shown.overview && (
              <p className="text-lg text-[#cfdae4] leading-relaxed line-clamp-2 max-w-2xl hero-text-shadow">
                {shown.overview}
              </p>
            )}
          </>
        ) : loading ? (
          <p className="text-xl text-[#8197a4]">{loadingText}</p>
        ) : null}
      </div>

      {/* Rails scroll in their own pane; the hero above never moves. The pane
          carries its own top-transparent → solid fade (backgrounds on a
          scroll container don't scroll with content), so cards settle onto a
          calm dark base instead of clashing with the hero art. */}
      <div className="tv-fade-rails relative z-10 flex-1 overflow-y-auto pb-12 pt-1">
        {rails.slice(0, railBudget).map(
          (rail, railIdx) =>
            (rail.items.length > 0 || rail.trailing) && (
              <TvRail key={rail.title} title={rail.title}>
                {rail.items.map((item, i) => {
                  const focusProps = {
                    onCardFocus: () => setFocused(item),
                    tvAutoFocus: railIdx === 0 && i === 0,
                  };
                  return item.event ? (
                    <TvEventCard
                      key={item.key}
                      game={item.event.game}
                      leagueName={item.event.leagueName}
                      leagueLogo={item.event.leagueLogo}
                      onOpen={item.event.onOpen}
                      onCardFocus={focusProps.onCardFocus}
                    />
                  ) : item.channel ? (
                    <TvChannelCard
                      key={item.key}
                      channel={item.channel}
                      onSelect={
                        onChannelSelect ? () => onChannelSelect(item.channel!) : undefined
                      }
                      {...focusProps}
                    />
                  ) : (
                    <TvLandscapeCard
                      key={item.key}
                      tmdbId={item.tmdbId!}
                      title={item.title}
                      backdrop={item.backdrop}
                      poster={item.poster}
                      kind={item.kind!}
                      season={item.season}
                      episode={item.episode}
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

/** Big team crest for the event hero (larger than the card's). */
function HeroCrest({ logo, name }: { logo?: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-3 min-w-0">
      {logo ? (
        <img
          src={logo}
          alt=""
          referrerPolicy="no-referrer"
          className="w-32 h-32 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]"
        />
      ) : (
        <div className="w-32 h-32 rounded-full bg-white/10" />
      )}
      <span className="text-xl font-semibold text-white/90 truncate max-w-40 text-center hero-text-shadow">
        {name}
      </span>
    </div>
  );
}
