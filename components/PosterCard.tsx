"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Film, Play } from "lucide-react";
import { prewarmVod } from "@/lib/vodPrewarm";

interface Props {
  tmdbId: number;
  title: string;
  poster?: string;
  kind: "movie" | "series";
  service?: string;
  rating?: number | string;
  year?: string;
  /** For a series, deep-link straight to a specific episode (Continue Watching). */
  season?: number;
  episode?: number;
}

export default function PosterCard({ tmdbId, title, poster, kind, season, episode }: Props) {
  const [imgError, setImgError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Handle cached images: if already loaded before React attaches onLoad
  // naturalWidth > 0 distinguishes successful loads from cached errors
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  const href = kind === "series"
    ? `/vod/series/${tmdbId}${episode ? `?s=${season ?? 1}&e=${episode}` : ""}`
    : `/vod/movie/${tmdbId}`;

  // Prewarm the clean-stream resolve the moment the user shows intent (press on
  // mobile, hover on desktop), so the 10-13s provider-a resolve is already running —
  // or done — by the time the detail page mounts. Fire-and-forget + deduped.
  const prewarm = () => prewarmVod(kind, tmdbId);

  return (
    <Link
      href={href}
      onPointerDown={prewarm}
      onPointerEnter={prewarm}
      className="block w-full group focus:outline-none focus:ring-1 focus:ring-brand/50 rounded-md"
    >
      <div className="hud-card hud-corners relative aspect-[2/3] rounded-lg overflow-hidden bg-card ring-1 ring-white/5">
        {poster && !imgError ? (
          <img
            ref={imgRef}
            src={poster}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`w-full h-full object-cover transition-all duration-500 ${
              loaded ? "opacity-100" : "opacity-0"
            } group-hover:scale-105`}
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-card to-surface p-3">
            <Film className="w-10 h-10 text-text-muted/30" />
            <span className="text-[11px] text-text-muted/50 text-center mt-2 line-clamp-3">{title}</span>
          </div>
        )}

        {!loaded && !imgError && poster && (
          <div className="absolute inset-0 hud-skeleton" />
        )}

        {/* Futuristic hover overlay: gradient sweep + glowing play button */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="w-11 h-11 rounded-full bg-brand flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-75 group-hover:scale-100 shadow-lg shadow-brand/50 hud-glow">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}