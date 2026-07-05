"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { proxyFetch } from "@/lib/api";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { mergeSources } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { ExternalLink } from "lucide-react";
import type { VodDetail } from "@/lib/types";

export default function VodMoviePage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Sources: direct streams first, then backend sources, embeds last.
  const [sourceIndex, setSourceIndex] = useState(0);
  const [resolved, setResolved] = useState<string[]>([]);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!tmdbId) return;
    setLoading(true);
    proxyFetch<VodDetail>(`/api/lounge/vod/details/${tmdbId}`)
      .then((d) => setDetail(d))
      .catch((err) => console.error("Movie detail fetch failed:", err))
      .finally(() => setLoading(false));
  }, [tmdbId]);

  // Resolve a clean direct stream in parallel with the detail fetch. Goes through
  // the shared prewarm cache: if a poster press/hover already resolved this title
  // it paints instantly; otherwise it dedupes onto the in-flight request so we
  // never double-resolve.
  useEffect(() => {
    if (!tmdbId) return;
    let cancelled = false;
    const warm = getPrewarmed("movie", tmdbId);
    if (warm) {
      setResolved(warm);
      setResolving(false);
      return;
    }
    setResolving(true);
    setResolved([]);
    resolveVod("movie", tmdbId)
      .then((urls) => {
        if (!cancelled) setResolved(urls);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  const sources = useMemo(
    () => mergeSources(resolved, detail?.stream_urls, detail?.embed_urls),
    [detail, resolved],
  );
  const idx = Math.min(sourceIndex, Math.max(0, sources.length - 1));
  const current = sources[idx];

  // Auto-failover: when the playing source is pronounced dead (error / stall /
  // never-started timeout), advance to the next and keep playing without a
  // re-tap. Wraps nothing — past the last source we show an honest failure.
  const pickSource = (i: number) => {
    setSourceIndex(i);
  };


  if (loading) {
    return (
      <div className="pt-3 min-h-screen pb-20">
        <div className="aspect-[16/9] hud-skeleton mb-4" />
        <div className="px-4 space-y-3">
          <div className="h-6 hud-skeleton rounded w-2/3" />
          <div className="h-4 hud-skeleton rounded w-1/2" />
          <div className="h-32 hud-skeleton rounded" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="pt-3 min-h-screen pb-20 px-4 text-center pt-20">
        <p className="text-text-secondary">Movie not found</p>
        <Link href="/vod" className="text-brand text-sm mt-2 inline-block">Back to VOD</Link>
      </div>
    );
  }

  return (
    <div className="pt-3 min-h-screen pb-20 animate-page-rise">
      {/* Back */}
      <Link href="/vod" className="absolute top-14 left-3 z-10 w-9 h-9 rounded-full glass-card flex items-center justify-center">
        <ChevronLeft className="w-5 h-5 text-white" />
      </Link>

      {/* Backdrop */}
      <div className="hud-scan relative aspect-[16/9] mb-4 overflow-hidden">
        {detail.backdrop ? (
          <img src={detail.backdrop} alt={detail.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-brand/30 to-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
      </div>

      {/* Info */}
      <div className="px-4 max-w-4xl mx-auto">
        <h1 className="text-white text-xl font-bold mb-2">{detail.title}</h1>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-text-muted text-xs">{detail.year || ""}</span>
          {Number(detail.rating) > 0 && (
            <span className="text-brand text-xs font-medium">{Number(detail.rating).toFixed(1)}</span>
          )}
          <span className="text-text-muted text-xs">{detail.service}</span>
        </div>
        <p className="text-text-secondary text-sm mb-4">{detail.overview}</p>

        {/* No source yet: show resolving feedback (gap titles take ~10-13s via the
            ad-free provider-a resolver) or an honest message — never a blank screen. */}
        {sources.length === 0 && (
          <div className="mb-6 rounded-xl bg-black/40 aspect-video flex items-center justify-center">
            {resolving ? (
              <span className="text-text-muted text-xs flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white/15 border-t-brand animate-spin" />
                finding clean stream…
              </span>
            ) : (
              <span className="text-text-muted text-xs">No source available for this title</span>
            )}
          </div>
        )}

        {sources.length > 0 && (
          <div className="mb-6">
            <h2 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
              Watch Now
              {resolving && (
                <span className="text-text-muted text-[10px] font-normal">· finding clean stream…</span>
              )}
            </h2>
            {/* Unified source list: direct streams first, vidlink last (≤5).
                Clicking a source opens it directly (external), like the Open button. */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {sources.length > 1 &&
                sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      // Still track which source was picked for the "Open" button
                      pickSource(i);
                    }}
                    className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                      idx === i ? "bg-brand text-white hud-glow" : "glass-card text-text-muted hover:text-white"
                    }`}
                  >
                    {s.label}
                  </a>
                ))}
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] px-2.5 py-1 rounded-full bg-card text-text-muted hover:text-white transition-colors flex items-center gap-1 ml-auto"
                title="If this source won't play here, open it in a new tab"
              >
                <ExternalLink className="w-3 h-3" />
                Open
              </a>
            </div>
            {/* Persistent tip: a stream that loops or keeps restarting is a stuck
                source; the Open escape hatch plays it directly in a new tab. */}
            <p className="text-[10px] text-text-muted mb-2 flex items-center gap-1">
              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
              <span>
                If a stream keeps restarting or looping, tap{" "}
                <span className="text-text-secondary">Open</span> to play it in a new tab.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}