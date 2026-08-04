"use client";

import { useState } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import { prewarmVod, warmFirstSource } from "@/lib/vodPrewarm";

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

/** Smallest TMDB size that still looks right in a 280×420 tile. The ladders
 *  differ by asset type and do NOT overlap: posters offer w154/w185/w342/w500,
 *  backdrops offer w300/w780/w1280. Asking for a size the type lacks 404s,
 *  which is why this is chosen per type rather than globally.
 *
 *  w185, NOT w342, and this is a stability constraint rather than a taste call.
 *  A decoded bitmap costs w×h×4 bytes, so per card:
 *      old 16:9 backdrop  w300 → 300×169 → ~203 KB
 *      poster             w342 → 342×513 → ~702 KB   (3.5× the old card!)
 *      poster             w185 → 185×278 → ~206 KB
 *  Across the ~190 cards a full TV home mounts that is ~35 MB before the
 *  portrait switch, ~133 MB at w342, ~39 MB at w185 — on a box with ≤1GB of
 *  RAM. w342 froze the Samsung outright, and this codebase already documents
 *  the same failure mode more gently (cards compositing WHITE once a screenful
 *  of bitmaps blows the raster budget).
 *
 *  THE TILE GREW 200×300 → 280×420 AND THIS DID NOT, deliberately. Decode cost
 *  is set by the SOURCE pixels, not by the CSS box, so a bigger tile costs no
 *  extra memory at the same source size — but stepping the source up is a
 *  CLIFF, not a slope: the ladder's next rung is w342, and w342 is the ~133 MB
 *  figure that froze the Samsung. There is nothing between w185 and w342.
 *
 *  So the upscale is now 1.51× (280 / 185), up from 1.08×. That is the real
 *  cost of the bigger tile and it is a deliberate trade: slightly soft art on a
 *  screen viewed from 8+ feet, against a TV that stays up. If the softness ever
 *  needs fixing, the way to afford w342 is to mount FEWER cards (cut the
 *  per-rail cap), not to raise this constant and hope — redo the arithmetic
 *  above against the current rail count first. */
const CARD_POSTER_SIZE = "w185";
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
 * driven by a remote instead of a thumb. 280×420 — the largest tile the 40vh
 * hero split still leaves room for; see the height budget in TvBrowseScreen.
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
      // Warm the EXACT episode this card opens, not the series default. A
      // Continue Watching tile deep-links to ?s=&e=&play=1, and the resolver is
      // keyed per episode — prewarming without them warmed S1E1 while the
      // viewer pressed S2E4 and then waited out the full resolve. Movies ignore
      // both args. Never prewarm a stream we are about to delete.
      if (!onSelect) {
        prewarmVod(kind, tmdbId, season, episode);
        // Resolving only gets a URL list; the 14.5s wait is the relay starting
        // ffmpeg for it. Dwelling on a card is the one window long enough to
        // absorb that, so spend it. Self-debounced — arrowing past a card warms
        // nothing. See warmFirstSource.
        warmFirstSource(kind, tmdbId, season, episode);
      }
      onCardFocus?.();
    },
    className: `block focus:outline-none ${fluid ? "w-full" : "w-[280px] shrink-0"}`,
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
          fluid ? "aspect-[2/3] overflow-hidden" : "h-[420px]"
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
        <p className={`mt-2 text-base text-[#8197a4] truncate ${fluid ? "" : "w-[280px]"}`}>
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
