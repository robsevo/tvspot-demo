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
  const art = backdrop || poster;

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
      <div className="relative aspect-video rounded-lg overflow-hidden bg-[#1a242f] ring-1 ring-white/10">
        {art && !imgError ? (
          <img
            src={art}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
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
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10 pb-3">
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
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
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
