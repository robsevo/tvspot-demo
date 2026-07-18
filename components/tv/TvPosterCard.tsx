"use client";

import { useState } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import { prewarmVod } from "@/lib/vodPrewarm";

interface Props {
  tmdbId: number;
  title: string;
  poster?: string;
  kind: "movie" | "series";
}

/** Poster card for TV rails. Focus is the TV's "hover": landing on a card
 *  prewarms the clean-stream resolve, same as press/hover does on mobile. */
export default function TvPosterCard({ tmdbId, title, poster, kind }: Props) {
  const [imgError, setImgError] = useState(false);
  const href = kind === "series" ? `/tv/vod/series/${tmdbId}` : `/tv/vod/movie/${tmdbId}`;

  return (
    <Link
      href={href}
      data-tv
      onFocus={() => prewarmVod(kind, tmdbId)}
      className="block w-44 shrink-0 focus:outline-none"
    >
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-card ring-1 ring-white/5">
        {poster && !imgError ? (
          <img
            src={poster}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-card to-surface p-3">
            <Film className="w-10 h-10 text-text-muted/30" />
            <span className="text-sm text-text-muted/60 text-center mt-2 line-clamp-3">
              {title}
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 text-base text-text-secondary truncate">{title}</p>
    </Link>
  );
}
