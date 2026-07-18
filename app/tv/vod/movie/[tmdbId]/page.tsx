"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { proxyFetch } from "@/lib/api";
import { mergeSources } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import TvVodPlayback from "@/components/tv/TvVodPlayback";
import type { VodDetail } from "@/lib/types";

/** TV movie page: backdrop hero + Play/Restart. Embeds are dropped (no way to
 *  drive a third-party iframe with a remote); direct streams + resolved HD
 *  cover playback, with TvVodPlayback's automatic failover between them. */
export default function TvMoviePage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState<string[]>(() => getPrewarmed("movie", tmdbId) ?? []);
  const [playing, setPlaying] = useState(false);
  const [fromStart, setFromStart] = useState(false);

  const { items, updateProgress, remove } = useContinueWatching();

  useEffect(() => {
    let cancelled = false;
    proxyFetch<VodDetail>(`/api/lounge/vod/details/${tmdbId}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    resolveVod("movie", tmdbId).then((urls) => {
      if (!cancelled && urls.length > 0) setResolved(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  const sources = useMemo(
    () => mergeSources(resolved, detail?.stream_urls, []),
    [detail, resolved],
  );

  const cwId = Number(tmdbId);
  const cwItem = items.find((i) => i.tmdbId === cwId && i.kind === "movie");
  const resumeTime =
    cwItem && cwItem.progress > 2 && cwItem.progress < 95
      ? (cwItem.progress / 100) * cwItem.duration
      : 0;

  const handleProgress = useCallback(
    (t: number, d: number) => {
      if (!detail || !isFinite(d) || d <= 0) return;
      const pct = (t / d) * 100;
      if (pct > 95) {
        remove(cwId, "movie");
      } else {
        updateProgress({
          tmdbId: cwId,
          title: detail.title,
          poster: detail.backdrop,
          kind: "movie",
          progress: pct,
          duration: d,
          updatedAt: Date.now(),
        });
      }
    },
    [detail, cwId, updateProgress, remove],
  );

  const closePlayback = useCallback(() => setPlaying(false), []);

  if (failed) {
    return (
      <div className="px-16 py-20">
        <p className="text-2xl text-text-secondary">This title isn&apos;t available right now.</p>
        <p className="text-xl text-text-muted mt-2">Press Back to return.</p>
      </div>
    );
  }

  if (!detail) {
    return <p className="px-16 py-20 text-xl text-text-muted">Loading…</p>;
  }

  return (
    <div className="relative min-h-screen">
      {detail.backdrop && (
        <>
          <img
            src={detail.backdrop}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-transparent" />
        </>
      )}

      <div className="relative px-16 pt-[28vh] pb-16 max-w-4xl">
        <h1 className="text-5xl font-bold text-white mb-4">{detail.title}</h1>
        <p className="text-xl text-text-secondary mb-6">
          {[detail.year, detail.rating, detail.service].filter(Boolean).join(" · ")}
        </p>
        {detail.overview && (
          <p className="text-xl text-text-secondary leading-relaxed mb-10 line-clamp-4">
            {detail.overview}
          </p>
        )}

        <div className="flex items-center gap-5">
          <button
            data-tv
            data-tv-autofocus
            disabled={sources.length === 0}
            onClick={() => {
              setFromStart(false);
              setPlaying(true);
            }}
            className="flex items-center gap-3 bg-brand text-white text-2xl font-semibold px-10 py-5 rounded-xl disabled:opacity-50"
          >
            <Play className="w-7 h-7 fill-white" />
            {sources.length === 0
              ? "Finding streams…"
              : resumeTime > 0
                ? "Resume"
                : "Play"}
          </button>

          {resumeTime > 0 && sources.length > 0 && (
            <button
              data-tv
              onClick={() => {
                setFromStart(true);
                setPlaying(true);
              }}
              className="flex items-center gap-3 bg-card text-text-secondary text-2xl font-semibold px-10 py-5 rounded-xl"
            >
              <RotateCcw className="w-6 h-6" />
              From beginning
            </button>
          )}
        </div>
      </div>

      {playing && sources.length > 0 && (
        <TvVodPlayback
          sources={sources}
          title={detail.title}
          poster={detail.backdrop}
          initialTime={fromStart ? 0 : resumeTime}
          onClose={closePlayback}
          onProgress={handleProgress}
        />
      )}
    </div>
  );
}
