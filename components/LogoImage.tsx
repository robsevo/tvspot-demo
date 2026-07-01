"use client";

import { useState } from "react";
import { getLogoCandidates } from "@/lib/logos";

interface Props {
  name: string;
  /** Real logo URL from the backend (e.g. a channel's logo_url). Tried first. */
  logoUrl?: string | null;
  className?: string;
  /** Class for the text-initials fallback. Default suits a dark backdrop;
   *  override (e.g. dark text) when the logo sits on a light background. */
  fallbackClassName?: string;
  /** Class applied directly to the <img> element (for CSS filters etc.). */
  imgClassName?: string;
}

/**
 * Renders a logo, trying sources in order until one loads:
 *   1. the backend-provided logo (proxied through /api/lounge/logo-proxy), if given
 *   2. a DuckDuckGo favicon matched by brand domain (lib/logos.ts)
 *   3. text initials
 * Each failed source advances to the next via the <img> onError handler.
 */
export function LogoImage({ name, logoUrl, className = "", fallbackClassName = "text-white/80", imgClassName = "" }: Props) {
  // Try reliable brand-favicon sources FIRST (Simple Icons / Google favicon by
  // domain), then the backend logo-proxy as a last resort. The backend's
  // /static/channel-logos path currently returns an HTML login page for many
  // channels — an <img> "succeeds" on that (broken image) and never errors, so
  // putting it first left logos blank. Domain favicons resolve far more channels.
  const candidates = [
    ...getLogoCandidates(name),
    logoUrl ? `/api/lounge/logo-proxy?url=${encodeURIComponent(logoUrl)}` : null,
  ].filter((u): u is string => Boolean(u));

  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (src) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <img
          src={src}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          // rounded-md so square logo tiles (e.g. TSN) match the rounded container
          // instead of showing hard square corners inside it.
          className={`w-full h-full object-contain rounded-md ${imgClassName}`}
          onError={() => setIdx((i) => i + 1)}
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className={`text-[10px] font-bold leading-none ${fallbackClassName}`}>{initials}</span>
    </div>
  );
}
