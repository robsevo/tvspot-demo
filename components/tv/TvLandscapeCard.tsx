"use client";

import { useState } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import { prewarmVod } from "@/lib/vodPrewarm";

interface Props {
  tmdbId: number;
  title: string;
  /** Preferred art — 16:9. Falls back to poster, then a text tile. */
  backdrop?: string;
  poster?: string;
  kind: "movie" | "series";
  /** 0-100: paints a resume bar along the bottom (Continue Watching). */
  progress?: number;
  /** Small line under the card, e.g. "S2 E4" or the source channel. */
  sublabel?: string;
  /** Prime-style corner badge: "TRENDING", "ON NOW", "TOP 10"… */
  badge?: string;
  /** Provider wordmark etched bottom-right of the art, like Prime's. */
  provider?: string;
  /** Etch the title into the art (grids with no hero). Browse rails pass
   *  false — there the pinned hero carries the title. */
  showTitle?: boolean;
  /** Fill the parent's column (grids) instead of the fixed rail width. */
  fluid?: boolean;
  /** Hero-follows-focus: the browse screen listens here. */
  onCardFocus?: () => void;
  /** Seed the remote's cursor here on page entry (first card of first rail). */
  tvAutoFocus?: boolean;
}

/** Smallest TMDB size that still looks right in a 320×180 tile. The ladders
 *  differ by asset type and do NOT overlap: backdrops offer w300/w780/w1280,
 *  posters offer …/w342/w500/w780. Asking for a size the type doesn't have 404s,
 *  which is why this has to be chosen per type rather than globally. */
const CARD_BACKDROP_SIZE = "w300";
const CARD_POSTER_SIZE = "w342";

/**
 * Downsize TMDB art for rail cards. Painting 70+ full-size images into 320×180
 * tiles blows past the 2019 TV's raster budget — the compositor then paints
 * tiles WHITE even though every <img> reports loaded (verified on-device:
 * naturalWidth 1280, canvas readback shows real art, screen shows white), and a
 * cold /tv paint builds all of them at once, which is enough to take the whole
 * renderer down on a ~1GB box.
 *
 * Rewrites ANY size segment — w<n> or "original", in both the encoded and plain
 * forms of the proxied URL — rather than enumerating known sizes. The previous
 * version listed only w1280 and w500, so the catalog's w780 backdrops sailed
 * through at full size: measured on prod, 38 of 73 card images came down as
 * 780×439, which is ~52MB of the 59.7MB decoded on a cold home screen. Matching
 * the shape instead of the values means the next size TMDB hands us can't
 * silently reintroduce that.
 */
function cardArt(url: string, isBackdrop: boolean): string {
  const size = isBackdrop ? CARD_BACKDROP_SIZE : CARD_POSTER_SIZE;
  return url
    .replace(/%2F(?:w\d+|original)%2F/, `%2F${size}%2F`)
    .replace(/\/(?:w\d+|original)\//, `/${size}/`);
}

/** Prime-style landscape card: 16:9 art, corner badge, provider mark,
 *  resume bar. Focus is the TV's hover — it prewarms the resolve. */
export default function TvLandscapeCard({
  tmdbId,
  title,
  backdrop,
  poster,
  kind,
  progress,
  sublabel,
  badge,
  provider,
  showTitle = true,
  fluid,
  onCardFocus,
  tvAutoFocus,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const href = kind === "series" ? `/tv/vod/series/${tmdbId}` : `/tv/vod/movie/${tmdbId}`;
  const raw = backdrop || poster;
  // Which ladder to use is decided by which field we actually took.
  const art = raw ? cardArt(raw, Boolean(backdrop)) : raw;

  return (
    <Link
      href={href}
      data-tv
      {...(tvAutoFocus ? { "data-tv-autofocus": true } : {})}
      onFocus={() => {
        prewarmVod(kind, tmdbId);
        onCardFocus?.();
      }}
      className={`block focus:outline-none ${fluid ? "w-full" : "w-80 shrink-0"}`}
    >
      {/* Rail cards use an EXPLICIT height and round the <img> itself instead of
          aspect-video + overflow-hidden clipping: on the Tizen webview those two
          were the only structural differences from the hero <img> (which paints),
          and the cards composited as WHITE tiles even with the bitmaps decoded
          (verified on-device). Fluid (search grid) keeps aspect-video for
          responsive width. */}
      <div
        className={`tv-card-shadow relative rounded-lg bg-[#1a242f] ring-1 ring-white/10 ${
          fluid ? "aspect-video overflow-hidden" : "h-[11.25rem]"
        }`}
      >
        {art && !imgError ? (
          <img
            src={art}
            alt={title}
            // NB: no loading="lazy" — the Tizen webview never fires the
            // intersection load for lazy <img> nested inside the page's
            // vertical + the rail's horizontal scroll container, so every
            // card stayed blank (and onError never fired for the fallback).
            // The 10-foot UI renders a bounded card count; eager is correct.
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover rounded-lg"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <Film className="w-8 h-8 text-white/20" />
            <span className="text-base text-white/50 text-center mt-2 line-clamp-2">{title}</span>
          </div>
        )}
        {badge && (
          <span className="absolute top-2 right-2 text-xs font-bold tracking-wide text-black bg-white rounded px-2 py-0.5">
            {badge}
          </span>
        )}
        {showTitle && art && !imgError && (
          <div className="tv-fade-card-title absolute inset-x-0 bottom-0 rounded-b-lg px-4 pt-10 pb-3">
            <p className="text-lg font-semibold text-white truncate">{title}</p>
          </div>
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
      {sublabel && <p className="mt-2 text-base text-[#8197a4] truncate">{sublabel}</p>}
    </Link>
  );
}
