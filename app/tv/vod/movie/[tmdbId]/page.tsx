"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { proxyFetch } from "@/lib/api";
import { mergeSources } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { useCatalogItem } from "@/hooks/useCatalogItem";
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
  // Hero "Play" deep-link (?play=1): start playback as soon as sources exist.
  // window.location (not useSearchParams) — this page is client-only and a
  // Suspense boundary for one flag is noise.
  const autoPlayWanted = useRef(false);
  useEffect(() => {
    try {
      autoPlayWanted.current = new URLSearchParams(window.location.search).get("play") === "1";
    } catch {}
  }, []);

  const { items, updateProgress, remove } = useContinueWatching();

  // Catalog fallback: the backend's details record is EMPTY for many trending
  // titles — the catalog row (which the user just came from) fills the header
  // while the vod-extract resolver independently finds the streams.
  const catItem = useCatalogItem("movie", tmdbId);
  const display = {
    title: detail?.title || catItem?.title || "",
    backdrop: detail?.backdrop || catItem?.backdrop || catItem?.poster,
    overview: detail?.overview || catItem?.overview,
    year: detail?.year || catItem?.year,
    rating: detail?.rating || catItem?.rating,
    service: detail?.service || catItem?.service,
  };

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

  useEffect(() => {
    if (autoPlayWanted.current && sources.length > 0) {
      autoPlayWanted.current = false;
      setPlaying(true);
    }
  }, [sources]);

  const cwId = Number(tmdbId);
  const cwItem = items.find((i) => i.tmdbId === cwId && i.kind === "movie");
  const resumeTime =
    cwItem && cwItem.progress > 2 && cwItem.progress < 95
      ? (cwItem.progress / 100) * cwItem.duration
      : 0;

  const handleProgress = useCallback(
    (t: number, d: number) => {
      if (!display.title || !isFinite(d) || d <= 0) return;
      const pct = (t / d) * 100;
      if (pct > 95) {
        remove(cwId, "movie");
      } else {
        updateProgress({
          tmdbId: cwId,
          title: display.title,
          poster: display.backdrop,
          kind: "movie",
          progress: pct,
          duration: d,
          updatedAt: Date.now(),
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [display.title, display.backdrop, cwId, updateProgress, remove],
  );

  const closePlayback = useCallback(() => setPlaying(false), []);

  if (failed && !catItem) {
    return (
      <div className="px-16 py-20">
        <p className="text-2xl text-[#aebbc5]">This title isn&apos;t available right now.</p>
        <p className="text-xl text-[#8197a4] mt-2">Press Back to return.</p>
      </div>
    );
  }

  if (!detail && !catItem) {
    return <p className="px-16 py-20 text-xl text-[#8197a4]">Loading…</p>;
  }

  return (
    <div className="relative min-h-screen">
      {display.backdrop && (
        <>
          <img
            src={display.backdrop}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0f171e] via-[#0f171e]/75 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f171e] to-transparent" />
        </>
      )}

      <div className="relative px-16 pt-[26vh] pb-16 max-w-3xl">
        <h1 className="text-5xl font-bold text-white mb-4">{display.title}</h1>
        <div className="flex items-center gap-4 mb-6 text-lg text-[#aebbc5]">
          {display.year && <span>{display.year}</span>}
          {display.rating && (
            <span className="border border-[#8197a4]/60 rounded px-2 py-0.5 text-base">
              {display.rating}
            </span>
          )}
          {display.service && <span>{display.service}</span>}
        </div>
        {display.overview && (
          <p className="text-xl text-[#aebbc5] leading-relaxed mb-10 line-clamp-4">
            {display.overview}
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
            className="flex items-center gap-3 bg-white text-black text-2xl font-bold px-10 py-5 rounded-lg disabled:opacity-50"
          >
            <Play className="w-7 h-7 fill-black" />
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
              className="flex items-center gap-3 bg-white/15 text-white text-2xl font-semibold px-10 py-5 rounded-lg"
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
          title={display.title}
          poster={display.backdrop}
          initialTime={fromStart ? 0 : resumeTime}
          onClose={closePlayback}
          onProgress={handleProgress}
        />
      )}
    </div>
  );
}
