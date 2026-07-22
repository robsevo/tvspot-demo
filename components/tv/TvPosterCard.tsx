"use client";

import { useState } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import { prewarmVod } from "@/lib/vodPrewarm";

interface Props {
  tmdbId: number;
  title: string;
  /** Preferred art — the SAME 2:3 poster the web/mobile cards use. Falls back to
   *  the 16:9 backdrop (letterboxed by object-cover), then a text tile. */
  poster?: string;
  backdrop?: string;
  kind: "movie" | "series";
  /** Deep-link a series card to a specific episode (Continue Watching). */
  season?: number;
  episode?: number;
  /** 0-100: paints a resume bar along the bottom (Continue Watching). */
  progress?: number;
  /** Small line under the card, e.g. "S2 E4" — information the ART CANNOT
   *  carry. The title deliberately has no caption: poster art already says it. */
  sublabel?: string;
  /** Prime-style corner badge: "TRENDING", "ON NOW", "TOP 10"… */
  badge?: string;
  /** Provider wordmark etched bottom-right of the art. */
  provider?: string;
  /** Fill the parent's column (grids) instead of the fixed rail width. */
  fluid?: boolean;
  /** When set, the tile becomes a <button> that runs this instead of a link to
   *  the title — used by "Remove titles" mode on My Stuff. Same swap
   *  TvChannelCard makes for the channel panel. */
  onSelect?: () => void;
  /** Paint the badge red and dim the art: this tile's action destroys data. */
  danger?: boolean;
  /** Hero-follows-focus: the browse screen listens here. */
  onCardFocus?: () => void;
  /** Seed the remote's cursor here on page entry (first card of first rail). */
  tvAutoFocus?: boolean;
}

/** Smallest TMDB size that still looks right in a 200×300 tile. The ladders
 *  differ by asset type and do NOT overlap: posters offer …/w342/w500/w780,
 *  backdrops offer w300/w780/w1280. Asking for a size the type lacks 404s,
 *  which is why this is chosen per type rather than globally.
 *
 *  w342 is a deliberate ceiling, not a guess: the TV's compositor paints cards
 *  WHITE once a screenful of full-size bitmaps blows its raster budget. Measured
 *  on prod, 38 of 73 card images once came down at 780×439 — ~52MB of the 59.7MB
 *  decoded on a cold home screen. A 342×513 poster decodes to ~700KB and still
 *  oversamples the 200×300 tile on a 1080p panel. */
const CARD_POSTER_SIZE = "w342";
const CARD_BACKDROP_SIZE = "w300";

/** Rewrites ANY size segment — w<n> or "original", in both the encoded and the
 *  plain form of the proxied URL — rather than enumerating known sizes, so the
 *  next size TMDB hands us can't silently reintroduce full-size decodes. */
function cardArt(url: string, isPoster: boolean): string {
  const size = isPoster ? CARD_POSTER_SIZE : CARD_BACKDROP_SIZE;
  return url
    .replace(/%2F(?:w\d+|original)%2F/, `%2F${size}%2F`)
    .replace(/\/(?:w\d+|original)\//, `/${size}/`);
}

/**
 * Portrait 2:3 poster card for the 10-foot UI — the same art, aspect and shape
 * as the web/mobile PosterCard, scaled up for a TV viewed from a couch and
 * driven by a remote instead of a thumb. 200×300 is what the 40vh hero split
 * leaves room for; see the height budget in TvBrowseScreen.
 *
 * No title caption by design: a poster IS the title treatment, and the row of
 * captions under 16:9 cards was costing a whole card row of vertical space.
 * Focus is the TV's hover — the white outline + lift come from the global
 * `.tv-root [data-tv]:focus` rule, and focus prewarms the stream resolve.
 */
export default function TvPosterCard({
  tmdbId,
  title,
  poster,
  backdrop,
  kind,
  season,
  episode,
  progress,
  sublabel,
  badge,
  provider,
  fluid,
  onSelect,
  danger,
  onCardFocus,
  tvAutoFocus,
}: Props) {
  const [imgError, setImgError] = useState(false);

  // A series card with a specific episode (Continue Watching) deep-links to it
  // and auto-plays, so it resumes where the viewer left off rather than opening
  // the show at S1E1.
  const href =
    kind === "series"
      ? season && episode
        ? `/tv/vod/series/${tmdbId}?s=${season}&e=${episode}&play=1`
        : `/tv/vod/series/${tmdbId}`
      : `/tv/vod/movie/${tmdbId}`;

  // Poster first — the whole point of this card. Which ladder to use is decided
  // by which field we actually took.
  const raw = poster || backdrop;
  const art = raw ? cardArt(raw, Boolean(poster)) : raw;

  const common = {
    "data-tv": true as const,
    ...(tvAutoFocus ? { "data-tv-autofocus": true } : {}),
    onFocus: () => {
      // Never prewarm a stream we are about to delete.
      if (!onSelect) prewarmVod(kind, tmdbId);
      onCardFocus?.();
    },
    className: `block focus:outline-none ${fluid ? "w-full" : "w-[200px] shrink-0"}`,
  };

  const inner = (
    <>
      {/* EXPLICIT height + the <img> rounding ITSELF, rather than aspect-[2/3]
          with overflow-hidden: on the Tizen webview that clipping combination is
          what made cards composite as WHITE tiles even with the bitmaps decoded
          (verified on-device). Fluid (grids) keeps aspect-[2/3] for responsive
          width, matching the web PosterCard. */}
      <div
        className={`tv-card-shadow relative rounded-lg bg-[#1a242f] ring-1 ring-white/10 ${
          fluid ? "aspect-[2/3] overflow-hidden" : "h-[300px]"
        }`}
        style={danger ? { opacity: 0.55 } : undefined}
      >
        {art && !imgError ? (
          <img
            src={art}
            alt={title}
            // NB: no loading="lazy" — the Tizen webview never fires the
            // intersection load for lazy <img> nested inside the page's vertical
            // + the rail's horizontal scroll container, so every card stayed
            // blank (and onError never fired for the fallback).
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover rounded-lg"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <Film className="w-8 h-8 text-white/20" />
            {/* Only place the title is drawn: with no art, nothing else says it. */}
            <span className="text-base text-white/60 text-center mt-2 line-clamp-4">
              {title}
            </span>
          </div>
        )}

        {badge && (
          <span
            className="absolute top-2 right-2 text-xs font-bold tracking-wide rounded px-2 py-0.5"
            style={
              danger
                ? { backgroundColor: "#c7040c", color: "#ffffff" }
                : { backgroundColor: "#ffffff", color: "#000000" }
            }
          >
            {badge}
          </span>
        )}

        {provider && (
          <span
            className="absolute bottom-2 right-3 text-sm font-bold text-white/90"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
          >
            {provider}
          </span>
        )}

        {typeof progress === "number" && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 rounded-b-lg overflow-hidden bg-white/20">
            <div
              className="h-full bg-[#e50914]"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
        )}
      </div>

      {sublabel && (
        <p className={`mt-2 text-base text-[#8197a4] truncate ${fluid ? "" : "w-[200px]"}`}>
          {sublabel}
        </p>
      )}
    </>
  );

  // Remove-mode tiles act on the list rather than navigating, so they must be
  // buttons — same swap TvChannelCard makes for the channel panel. Enter
  // activates either one through the browser's own keydown→click mapping, so
  // TvNav needs no special case.
  if (onSelect) {
    return (
      <button type="button" {...common} onClick={onSelect}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={href} {...common}>
      {inner}
    </Link>
  );
}
