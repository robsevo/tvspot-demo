"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { proxyFetch } from "@/lib/api";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import Link from "next/link";
import { ChevronLeft, Play } from "lucide-react";
import VodPlayer from "@/components/VodPlayer";
import { mergeSources } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import { ExternalLink } from "lucide-react";
import type { VodDetail } from "@/lib/types";

export default function VodMoviePage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceIndex, setSourceIndex] = useState(0);
  // Click-to-play gate: the embed iframe autoplays on mount no matter what allow/
  // sandbox we set, so we DON'T mount it until the user taps play. Tracked by the
  // source URL so switching sources re-gates (render-time derive, no setState-in-effect).
  const [startedUrl, setStartedUrl] = useState<string | null>(null);
  // Clean direct HLS streams resolved on-demand (ad-free, played in our own
  // VideoPlayer). Empty until /api/vod-extract returns; embed is the fallback.
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

  // Unified source list: backend "Source N" first (stable default — see mergeSources
  // for why leading with them stops the player restarting when HD resolves in), then
  // the clean HD streams as one-tap alternatives, embeds last.
  const sources = useMemo(
    () => mergeSources(resolved, detail?.stream_urls, detail?.embed_urls),
    [detail, resolved],
  );
  const idx = Math.min(sourceIndex, Math.max(0, sources.length - 1));
  const current = sources[idx];

  // Auto-failover: when the playing source is pronounced dead (error / stall /
  // never-started timeout), advance to the next and keep playing without a
  // re-tap. Wraps nothing — past the last source we show an honest failure.
  const [autoResume, setAutoResume] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const advanceSource = useCallback((lastTime: number) => {
    // Carry the position into the next source so failover resumes where the
    // dead source stopped, instead of restarting the movie. Threshold matches
    // pickSource (>5s): the old 30s cutoff meant every early-playback failure
    // restarted the NEXT source from 0:00 — chained across sources, that's the
    // "movie keeps restarting" loop.
    if (lastTime > 5) setResumeTime(lastTime);
    setSourceIndex((i) => {
      if (i + 1 >= sources.length) {
        setAllFailed(true);
        return i;
      }
      setAutoResume(true);
      return i + 1;
    });
  }, [sources.length]);
  const pickSource = useCallback((i: number) => {
    setAllFailed(false);
    setAutoResume(false);
    // Carry the current position into the picked source so switching resumes where
    // you were instead of restarting (the player remounts on the new URL).
    if (posRef.current > 5) setResumeTime(posRef.current);
    setSourceIndex(i);
  }, []);

  // Continue Watching: resume position captured ONCE (so ongoing progress writes
  // don't keep re-seeking the player), plus a throttled save back to the store.
  const { items: cwItems, updateProgress } = useContinueWatching();
  const [resumeTime, setResumeTime] = useState<number | undefined>(undefined);
  const resumeCaptured = useRef(false);
  // Latest playback position, so switching source resumes there instead of at zero.
  const posRef = useRef(0);
  useEffect(() => {
    if (resumeCaptured.current) return;
    const it = cwItems.find((i) => i.tmdbId === Number(tmdbId) && i.kind === "movie");
    if (it && it.duration) {
      resumeCaptured.current = true;
      setResumeTime((it.progress / 100) * it.duration);
    }
  }, [cwItems, tmdbId]);

  const handleProgress = useCallback(
    (t: number, d: number) => {
      if (t > 0) posRef.current = t;
      if (!detail || !d) return;
      updateProgress({
        tmdbId: Number(tmdbId),
        title: detail.title,
        poster: detail.backdrop,
        kind: "movie",
        progress: (t / d) * 100,
        duration: d,
        updatedAt: Date.now(), // overwritten by the hook; required by the type
      });
    },
    [detail, tmdbId, updateProgress],
  );

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
            <div className="rounded-xl overflow-hidden bg-black">
              {current.kind === "embed" ? (
                startedUrl === current.url ? (
                  <iframe
                    src={current.url}
                    allowFullScreen
                    allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                    // Mounted only after the user taps play, so this is a user-gesture
                    // start (not autoplay). Sandbox stays off so providers play.
                    className="w-full h-full aspect-video"
                    style={{ border: "none" }}
                    key={current.url}
                  />
                ) : (
                  <button
                    onClick={() => setStartedUrl(current.url)}
                    className="relative w-full aspect-video bg-black flex items-center justify-center group"
                    aria-label="Play"
                  >
                    {detail.backdrop && (
                      <img src={detail.backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                    )}
                    <span className="relative w-16 h-16 rounded-full bg-brand/90 flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Play className="w-8 h-8 text-white fill-white" />
                    </span>
                  </button>
                )
              ) : (
                <VodPlayer
                  src={current.url}
                  autoPlay={autoResume}
                  title={detail.title}
                  poster={detail.backdrop}
                  initialTime={resumeTime}
                  onProgress={handleProgress}
                  onSourceFail={advanceSource}
                  key={current.url}
                />
              )}
            </div>
            {autoResume && !allFailed && (
              <p className="text-text-muted text-[10px] mt-1.5">
                Previous source failed — switched to {current.label}.
              </p>
            )}
            {allFailed && (
              <p className="text-red-400/90 text-xs mt-1.5">
                None of the sources are playing right now. Try again in a minute, or pick a source above to retry.
              </p>
            )}
            <SourceTroubleHint resetKey={idx} />
          </div>
        )}
      </div>
    </div>
  );
}