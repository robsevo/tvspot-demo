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

/**
 * Downsize TMDB art for rail cards. The catalog hands out w1280 backdrops /
 * w500 posters (right for the hero pane); painting 70+ of those into 320×180
 * tiles decodes ~265MB of bitmaps and blows past the 2019 TV's raster budget —
 * the compositor then paints the tiles WHITE even though every <img> reports
 * loaded (verified on-device via DevTools: naturalWidth 1280, canvas readback
 * shows real art, screen shows white). Rewrites the size segment inside the
 * proxied URL (both encoded and plain forms); ladders differ per TMDB type:
 * backdrops have w300, posters' nearest is w342.
 */
function cardArt(url: string): string {
  return url
    .replace(/%2Fw1280%2F/, "%2Fw300%2F")
    .replace(/\/w1280\//, "/w300/")
    .replace(/%2Fw500%2F/, "%2Fw342%2F")
    .replace(/\/w500\//, "/w342/");
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
  const art = raw ? cardArt(raw) : raw;

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
