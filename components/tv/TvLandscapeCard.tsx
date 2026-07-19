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
  /** Small line under the title, e.g. "S2 E4" for continue-watching. */
  sublabel?: string;
}

/** Prime-style landscape card: 16:9 art, title etched into a bottom gradient,
 *  optional resume bar. Focus is the TV's hover — it prewarms the resolve. */
export default function TvLandscapeCard({
  tmdbId,
  title,
  backdrop,
  poster,
  kind,
  progress,
  sublabel,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const href = kind === "series" ? `/tv/vod/series/${tmdbId}` : `/tv/vod/movie/${tmdbId}`;
  const art = backdrop || poster;

  return (
    <Link
      href={href}
      data-tv
      onFocus={() => prewarmVod(kind, tmdbId)}
      className="block w-80 shrink-0 focus:outline-none"
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
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10 pb-3">
          <p className="text-lg font-semibold text-white truncate">{title}</p>
          {sublabel && <p className="text-sm text-[#8197a4] truncate">{sublabel}</p>}
        </div>
        {typeof progress === "number" && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-[#1399ff]" style={{ width: `${Math.round(progress)}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}
