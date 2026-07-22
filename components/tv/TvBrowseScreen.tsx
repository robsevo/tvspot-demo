"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";
import TvChannelCard from "@/components/tv/TvChannelCard";
import TvEventCard from "@/components/tv/TvEventCard";
import { heroArt } from "@/lib/tmdbImage";
import { TVKEY } from "@/lib/tv";
import type { Channel } from "@/lib/types";
import { etTime, type EventTeam, type GameEvent } from "@/lib/leagues";

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
    /** League key from lib/leagues — "ufc" switches crests to fighter
     *  portraits (round, cropped) instead of square club logos. */
    leagueKey?: string;
    leagueName: string;
    leagueLogo?: string;
    /** OUR channel names carrying it, brand-deduped, best first. Rendered as
     *  static chips — the hero is display-only; Enter on the card opens the
     *  channel panel that actually tunes. */
    carriers?: string[];
    onOpen: () => void;
  };
}

export interface TvBrowseRail {
  title: string;
  items: TvBrowseItem[];
  /** Extra tile at the end of the row. */
  trailing?: ReactNode;
  /** Extra tile at the START of the row (e.g. the "Full guide" link). */
  leading?: ReactNode;
  /** Opens a full grid of this row's category — renders a "See all" tile in
   *  the row (see TvRail). */
  seeAllHref?: string;
  /** Put that tile at the START of the row instead of the end. */
  seeAllFirst?: boolean;
}

/** Rails painted on the very first frame — the hero plus one rail is a complete
 *  screen to look at, and holds initial focus. */
const RAILS_FIRST_PAINT = 1;
/** How many more to add per step, and how long to leave the renderer alone
 *  between steps. Tuned to be generous on the slowest device we support rather
 *  than snappy on a desktop; the rails below the fold aren't visible yet anyway. */
const RAILS_PER_STEP = 1;
const RAIL_STEP_MS = 400;

/** Hero auto-rotation, until the user takes over with the D-pad. A 10-foot
 *  highlight reel of the best art, paced slower than a phone carousel. */
const HERO_ROTATE_MS = 7000;
const HERO_ROTATION_MAX = 7;
/** Remote codes that mean "the user is driving now" — hand the hero to
 *  follow-focus. Programmatic focus seeding dispatches no keydown, so only a
 *  genuine press trips this. */
const INTERACT_CODES = new Set<number>([
  TVKEY.left, TVKEY.right, TVKEY.up, TVKEY.down, TVKEY.enter,
]);

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
  sectionLogo,
  onChannelSelect,
}: {
  rails: TvBrowseRail[];
  loading?: boolean;
  loadingText?: string;
  /** Brand mark for the section you're inside (a provider), shown quietly in
   *  the hero's empty top-left. Purely an orientation cue — not focusable, and
   *  it never sits over the hero copy or the art's subject. */
  sectionLogo?: { src: string | null; label: string };
  /** When set, channel tiles open the channel panel instead of tuning
   *  directly — the Live TV screen wants Watch Live / favorite / now-next. */
  onChannelSelect?: (channel: Channel) => void;
}) {
  const [focused, setFocused] = useState<TvBrowseItem | null>(null);
  // Hero auto-rotation. `rotIdx` steps through the highlight reel on a timer;
  // `userInteracted` latches true on the first remote press and permanently
  // hands the hero over to follow-focus ("show what we're on") for the visit.
  const [rotIdx, setRotIdx] = useState(0);
  const [userInteracted, setUserInteracted] = useState(false);

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

  // The rotation reel: items with real art (plus themed sports events), capped
  // to a tight highlight set rather than the whole catalog.
  const heroRotation = useMemo(
    () =>
      rails
        .flatMap((r) => r.items)
        .filter((it) => it.backdrop || it.poster || it.event)
        .slice(0, HERO_ROTATION_MAX),
    [rails],
  );

  // Advance the reel on a timer while the user hasn't taken over.
  useEffect(() => {
    if (userInteracted || heroRotation.length < 2) return;
    const t = setInterval(() => setRotIdx((i) => (i + 1) % heroRotation.length), HERO_ROTATE_MS);
    return () => clearInterval(t);
  }, [userInteracted, heroRotation.length]);

  // First real remote press → follow-focus for the rest of the visit.
  useEffect(() => {
    if (userInteracted) return;
    const onKey = (e: KeyboardEvent) => {
      if (INTERACT_CODES.has(e.keyCode)) setUserInteracted(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userInteracted]);

  // Before the user drives, the hero IS the rotating reel; after, it mirrors the
  // focused card. Either way fall back to the first visual so it's never a void.
  const rotating =
    !userInteracted && heroRotation.length > 0
      ? heroRotation[rotIdx % heroRotation.length]
      : null;
  const shown = (userInteracted ? focused : rotating) ?? firstVisual ?? fallback;
  const showDots = !userInteracted && heroRotation.length > 1;

  // Hero art at full display resolution: the catalog's w1280 backdrops stay as
  // they are, but a w500 poster (e.g. a Continue-Watching tile) is bumped to its
  // w780 max so it isn't upscaled into a soft, stretched hero. Per-type because
  // the poster/backdrop size ladders don't overlap.
  const artRaw = shown?.backdrop || shown?.poster;
  const art = artRaw ? heroArt(artRaw, Boolean(shown?.backdrop)) : undefined;

  return (
    <div className="relative h-[calc(100vh-76px)] flex flex-col overflow-hidden">
      {/* Google-TV-style immersive hero: fills the top ~72% edge to edge and
          dissolves into the page through the handwritten fades (Tailwind
          gradient utilities compile color-mix into --tw vars and never paint on
          the TV — that was the original clash). A focused sports event has no
          backdrop, so it renders its own themed hero (league wash + crests)
          instead of a blank void. */}
      {shown?.event ? (
        <div key={`hero-art-${shown.key}`} className="tv-event-art absolute inset-x-0 top-0 h-[48%] animate-[fadeIn_0.5s_ease]">
          {shown.event.leagueLogo && (
            <img
              src={shown.event.leagueLogo}
              alt=""
              referrerPolicy="no-referrer"
              className="pointer-events-none absolute right-[7%] top-1/2 -translate-y-1/2 w-[38%] max-w-2xl object-contain opacity-[0.10]"
            />
          )}
          <div className="absolute right-[9%] top-[42%] -translate-y-1/2 flex items-center gap-14">
            <HeroCrest
              team={shown.event.game.away}
              portrait={shown.event.leagueKey === "ufc"}
              showScore={shown.event.game.state !== "pre"}
            />
            <span className="text-4xl font-black text-white/35">VS</span>
            <HeroCrest
              team={shown.event.game.home}
              portrait={shown.event.leagueKey === "ufc"}
              showScore={shown.event.game.state !== "pre"}
            />
          </div>
          <div className="tv-fade-hero-l absolute inset-0" />
          <div className="tv-fade-hero-b absolute inset-0" />
        </div>
      ) : art ? (
        <div key={`hero-art-${art}`} className="absolute inset-x-0 top-0 h-[48%] animate-[fadeIn_0.5s_ease]">
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
          focus move crossfades the text instead of hard-swapping it.
          Height is deliberately short: the hero pane and the rails pane split
          the screen, so every extra vh here costs a rail.

          Budget @1080p, with the 200×300 portrait posters (TvPosterCard):
            pane      = 100vh − 76px topnav          = 1004px
            hero      = 40vh                         =  432px
            rails     = 1004 − 432                   =  572px
            one rail  = 300 poster + 32 h2 + 8 mb
                        + 16 inner py + 16 section py=  372px
            one rail + pane pt-2                     =  380px

          This is DELIBERATELY a one-row split: a big hero and big poster art
          together cost more than 1004px can show, and the choice was to keep
          both. The second rail peeks ~190px below the fold and TvNav scrolls
          it into view on the first Down press — the standard Prime/Netflix
          portrait behaviour. (Two full rows needs hero ≤26vh and ~264px
          posters; that trade was made and then reversed on purpose.)
          Change any of these numbers and re-check the sum. */}
      {/* Section mark. Top-left is the one reliably empty part of the hero: the
          copy is bottom-aligned and the art's subject sits right. It also lands
          on the left-to-right scrim, so a wordmark stays legible over any
          backdrop. Decorative — no data-tv, so it never takes a D-pad stop. */}
      {sectionLogo && (
        <div className="absolute left-16 top-6 z-20 pointer-events-none">
          {sectionLogo.src ? (
            <img
              src={sectionLogo.src}
              alt={sectionLogo.label}
              referrerPolicy="no-referrer"
              className="h-10 max-w-[240px] object-contain object-left"
              style={{ opacity: 0.9 }}
            />
          ) : (
            <span className="text-2xl font-bold text-white hero-text-shadow">
              {sectionLogo.label}
            </span>
          )}
        </div>
      )}

      <div className="relative z-10 flex-none h-[40vh] px-16 max-w-4xl flex flex-col justify-end pb-6">
        {/* Keyed inner wrapper does the crossfade; the dots below sit OUTSIDE it
            so they persist and animate their width instead of remounting each
            rotation. */}
        <div key={`hero-copy-${shown?.key ?? "empty"}`} className="animate-[fadeIn_0.35s_ease]">
        {shown?.event ? (
          <EventHeroCopy item={shown} />
        ) : shown ? (
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

        {/* Carousel dots — only while auto-rotating; the active one elongates in
            the brand cyan, matching the web hero. */}
        {showDots && (
          <div className="flex items-center gap-2 mt-5">
            {heroRotation.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === rotIdx % heroRotation.length ? "w-7 bg-[#22d3ee]" : "w-1.5 bg-white/35"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Rails scroll in their own pane; the hero above never moves. The pane
          carries its own top-transparent → solid fade (backgrounds on a
          scroll container don't scroll with content), so cards settle onto a
          calm dark base instead of clashing with the hero art.
          A defined "shelf" seam — a hairline top highlight + an upward shadow —
          separates the rails from the hero, which otherwise dissolved into the
          same #00050d and read as one surface. Explicit rgba (not Tailwind
          /opacity, which can compile to color-mix and not paint on the TV). */}
      <div className="tv-fade-rails relative z-10 flex-1 overflow-y-auto pb-12 pt-2 border-t border-[rgba(255,255,255,0.10)] shadow-[0_-18px_38px_-10px_rgba(0,0,0,0.7)]">
        {rails.slice(0, railBudget).map(
          (rail, railIdx) =>
            (rail.items.length > 0 || rail.trailing || rail.leading) && (
              <TvRail
                key={rail.title}
                title={rail.title}
                seeAllHref={rail.seeAllHref}
                seeAllFirst={rail.seeAllFirst}
                leading={rail.leading}
              >
                {rail.items.map((item, i) => {
                  const focusProps = {
                    onCardFocus: () => setFocused(item),
                    tvAutoFocus: railIdx === 0 && i === 0,
                  };
                  return item.event ? (
                    <TvEventCard
                      key={item.key}
                      game={item.event.game}
                      leagueKey={item.event.leagueKey}
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
                    <TvPosterCard
                      key={item.key}
                      tmdbId={item.tmdbId!}
                      title={item.title}
                      poster={item.poster}
                      backdrop={item.backdrop}
                      kind={item.kind!}
                      season={item.season}
                      episode={item.episode}
                      progress={item.progress}
                      sublabel={item.sublabel}
                      badge={item.badge}
                      provider={item.provider}
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

/**
 * Hero copy for a live/upcoming event, scaled up from the website's event hero
 * (components/HeroBanner.tsx → EventContent): league eyebrow, LIVE dot, the
 * matchup, the kickoff time, and which of OUR channels carry it.
 *
 * Display-only by design — nothing here is focusable. On the TV the hero
 * describes whatever card the remote is sitting on, and Enter on that card
 * opens the channel panel that does the tuning; making the hero focusable too
 * would put a second, competing target in TvNav's geometry.
 */
function EventHeroCopy({ item }: { item: TvBrowseItem }) {
  const ev = item.event!;
  const { game } = ev;
  const live = game.state === "in";
  const final = game.state === "post";
  const carriers = ev.carriers ?? [];
  const [primary, ...also] = carriers;

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        {ev.leagueLogo && (
          <img
            src={ev.leagueLogo}
            alt=""
            referrerPolicy="no-referrer"
            className="w-9 h-9 object-contain"
          />
        )}
        <span className="text-lg font-bold uppercase tracking-wide text-white/85 hero-text-shadow">
          {ev.leagueName}
        </span>
        {live && (
          <span className="flex items-center gap-2 text-base font-bold text-white bg-[#c7040c] rounded px-2 py-0.5">
            <span className="w-2 h-2 rounded-full bg-white" />
            LIVE
          </span>
        )}
      </div>

      <h1 className="text-6xl font-extrabold text-white leading-[1.05] line-clamp-2 mb-3 hero-text-shadow">
        {game.shortName || item.title}
      </h1>

      <p className="text-xl font-medium text-[#c7d5e0] mb-2 hero-text-shadow">
        {live || final ? game.detail || (final ? "Final" : "") : etTime(game.dateUtc)}
      </p>

      {primary ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-lg font-semibold text-black bg-white rounded-full px-5 py-1.5">
            {live ? `Watch live on ${primary}` : `Watch on ${primary}`}
          </span>
          {also.length > 0 && (
            <>
              <span className="text-base text-white/50">Also on</span>
              {also.slice(0, 3).map((c) => (
                <span
                  key={c}
                  className="text-base font-medium text-white/85 bg-white/10 rounded-full px-4 py-1.5"
                >
                  {c}
                </span>
              ))}
            </>
          )}
        </div>
      ) : (
        <p className="text-lg text-white/60 hero-text-shadow">Not on your channels</p>
      )}
    </>
  );
}

/** Big team crest for the event hero (larger than the card's). UFC passes
 *  `portrait`: fighter headshots are photos, so they're cropped to a circle
 *  rather than letterboxed like a club crest. */
function HeroCrest({
  team,
  portrait,
  showScore,
}: {
  team: EventTeam;
  portrait?: boolean;
  showScore?: boolean;
}) {
  const hasScore = showScore && team.score !== undefined && team.score !== "";
  return (
    <div className="flex flex-col items-center gap-3 min-w-0">
      {team.logo ? (
        <img
          src={team.logo}
          alt=""
          referrerPolicy="no-referrer"
          className={
            portrait
              ? "w-32 h-32 rounded-full object-cover bg-white/5 drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]"
              : "w-32 h-32 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]"
          }
        />
      ) : (
        <div className="w-32 h-32 rounded-full bg-white/10" />
      )}
      <span className="text-xl font-semibold text-white/90 truncate max-w-40 text-center hero-text-shadow">
        {team.name}
      </span>
      {hasScore && (
        <span className="text-4xl font-black text-white tabular-nums hero-text-shadow">
          {team.score}
        </span>
      )}
    </div>
  );
}
