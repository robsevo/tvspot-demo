"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { proxyFetchRetry, HttpError } from "@/lib/api";
import Link from "next/link";
import { ChevronLeft, Check, X, Loader2, RefreshCw, ExternalLink, Info } from "lucide-react";
import { mergeSources, type PlayableSource } from "@/lib/sources";
import { resolveVod, getPrewarmed } from "@/lib/vodPrewarm";
import VodPlayer from "@/components/VodPlayer";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import { useSubtitles } from "@/hooks/useSubtitles";
import { useStreamCheck, type SourceStatus } from "@/hooks/useStreamCheck";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import type { VodDetail } from "@/lib/types";

/** Maximum sources to display. */
const MAX_SOURCES = 10; // raised from 6 — more failover depth + manual picks; only the chosen source streams

/** How many sources the OPENING probe round covers. Deliberately lower than
 *  MAX_SOURCES: auto-failover is frozen while a probe round is in flight, so the
 *  round's length is dead time before playback starts. Once the VOD index grew to
 *  ~9 sources/title (2026-07-25) probing all of them took seconds — and worse, a
 *  title's first rows are often mkv, whose probe goes through the relay's ffmpeg
 *  remux (one session each). Unprobed sources are NOT penalised: isDead() only
 *  excludes an EXPLICIT "dead" verdict, so everything stays listed and selectable,
 *  and `recheck` covers the rest on demand. */
const MAX_PROBE_SOURCES = 5;

/** Sources that dropped DURING playback cool down before retry — VOD sources
 *  that die mid-file usually need a couple of minutes (relay slot, provider). */
const FAIL_COOLDOWN_MS = 120000;

/** Small status indicator for a source button. */
function StatusDot({ status }: { status: SourceStatus }) {
  if (status === "checking") return <Loader2 className="w-3 h-3 animate-spin text-text-muted" />;
  if (status === "working") return <Check className="w-3 h-3 text-green-400" />;
  if (status === "dead") return <X className="w-3 h-3 text-red-400" />;
  if (status === "busy") return <span className="w-2 h-2 rounded-full bg-amber-400" title="Busy — connection limit" />;
  return null;
}

export default function VodMoviePage() {
  const { tmdbId } = useParams<{ tmdbId: string }>();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Fetch blew up for a reason OTHER than 404 (backend restarting, proxy 504…)
  // — the title probably exists, so offer Retry instead of "not found".
  const [fetchFailed, setFetchFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // Resolved direct stream URLs (prewarm cache + fresh resolution)
  const [resolved, setResolved] = useState<string[]>([]);
  const [resolving, setResolving] = useState(true);

  // Source selection: index into merged sources array
  const [sourceIndex, setSourceIndex] = useState(0);
  // Sources that dropped during playback → when, for cooldown-based recovery.
  const [failedAt, setFailedAt] = useState<Record<string, number>>({});
  // The URL that actually reached first frame — playback is ground truth, so a
  // probe verdict can never mark the on-screen source dead.
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);

  // Continue Watching integration
  const cwId = useMemo(() => (tmdbId ? Number(tmdbId) : 0), [tmdbId]);
  // Caption tracks for this title. Keyed to the movie, not the source, so a
  // failover to another URL keeps the same subtitles.
  const subtitles = useSubtitles("movie", tmdbId);
  const { items, updateProgress, remove } = useContinueWatching();
  // Resume position is snapshotted ONCE per title. Deriving it live from the
  // continue-watching entry (which playback rewrites every few seconds) fed an
  // ever-changing initialTime into the player — and for remux sources that
  // param is baked into the stream URL, so the movie restarted on every save.
  const resumeRef = useRef<number | null>(null);
  if (resumeRef.current === null && items.length > 0) {
    const e = items.find((i) => i.tmdbId === cwId && i.kind === "movie");
    resumeRef.current = e?.duration && e.duration > 0 ? (e.progress / 100) * e.duration : 0;
  }
  const resumeTime = resumeRef.current ?? 0;

  // Fetch movie details. Auto-retries the cold-start window (backend bouncing →
  // 503 vod_warming / 504 / timeout) with backoff so the page keeps its loading
  // skeleton and resolves the moment the box answers, instead of dead-ending on
  // the first miss. Only a 404 (or an exhausted ~60s retry budget) surfaces the
  // manual Retry screen.
  useEffect(() => {
    if (!tmdbId) return;
    const ctl = new AbortController();
    setLoading(true);
    setFetchFailed(false);
    proxyFetchRetry<VodDetail>(`/api/lounge/vod/details/${tmdbId}`, { signal: ctl.signal })
      .then((d) => {
        if (!ctl.signal.aborted) setDetail(d);
      })
      .catch((err) => {
        if (ctl.signal.aborted || err?.name === "AbortError") return;
        console.error("Movie detail fetch failed:", err);
        setFetchFailed(!(err instanceof HttpError && err.status === 404));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [tmdbId, retryTick]);

  // Resolve direct streams with prewarm caching
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

  // Merge sources: direct streams first, then backend sources, embeds last
  const sources: PlayableSource[] = useMemo(
    () => mergeSources(resolved, detail?.stream_urls, detail?.embed_urls),
    [detail, resolved]
  );

  // Server-side reachability probe (same machinery as live channels, VOD mode:
  // HEAD / range-GET — these are files and embed pages, not HLS playlists).
  // Probe the CHEAP sources first and cap the round. A remux source is a relay
  // /remux.m3u8 URL and each probe of one starts a relay ffmpeg session, so a title
  // whose leading rows are all mkv would spend the whole opening round waiting on
  // transcoders — and those sessions compete with the stream the viewer is actually
  // watching. Direct files/embeds answer in ms; remux sources stay in the list, just
  // unprobed (⇒ never judged dead) until a recheck. The `includes("remux")` test
  // still holds now that the URL is the relay's directly (see lib/vod-resolve).
  const probeUrls = useMemo(() => {
    const isRemux = (u: string) => u.includes("remux");
    const cheap = sources.filter((s) => !isRemux(s.url));
    return (cheap.length > 0 ? cheap : sources).slice(0, MAX_PROBE_SOURCES).map((s) => s.url);
  }, [sources]);
  const { statusOf, workingCount, busyCount, loading: checking, recheck, revalidating } = useStreamCheck(probeUrls, { mode: "vod" });

  // Ensure source index is valid
  const validIndex = Math.min(sourceIndex, Math.max(0, sources.length - 1));
  const currentSource = sources[validIndex];

  // Cooldown tick so a cooled-down source comes back on its own.
  useEffect(() => {
    const id = setInterval(() => setFailedAt((prev) => ({ ...prev })), 10000);
    return () => clearInterval(id);
  }, []);

  // A source is unusable if it dropped during playback (cooldown window) or the
  // probe judged it dead — unless it's the one actually playing right now.
  const isDead = useCallback(
    (src: PlayableSource) => {
      const url = src.url;
      if (failedAt[url] && Date.now() - failedAt[url] < FAIL_COOLDOWN_MS) return true;
      if (url === confirmedUrl) return false; // on screen and playing — reality wins
      return statusOf(url) === "dead";
    },
    [failedAt, statusOf, confirmedUrl]
  );

  // Working count that trusts playback: never claim "0 online" while a source plays.
  const shownWorking = workingCount + (confirmedUrl && statusOf(confirmedUrl) !== "working" ? 1 : 0);

  // Display sources: usable first; if everything is judged dead show them all
  // anyway so the user can still try (probes can be wrong for embeds).
  // Every source stays listed, always — a row vanishing because one probe round
  // flapped is what made sources "disappear and come back". Verdicts change the
  // BADGE and the RANK, never the membership. Sort is stable within a tier, and
  // the source actually playing is pinned first so it can't slide away underfoot.
  const displaySources = useMemo(() => {
    const tier = (s: PlayableSource) => {
      if (s.url === confirmedUrl) return 0;      // playing — reality beats any probe
      if (failedAt[s.url] && Date.now() - failedAt[s.url] < FAIL_COOLDOWN_MS) return 4;
      switch (statusOf(s.url)) {
        case "working": return 1;
        case "busy": return 2;
        case "dead": return 4;
        default: return 3;                        // unknown / unprobed / checking
      }
    };
    return sources
      .map((s, i) => ({ s, i, t: tier(s) }))
      .sort((a, b) => a.t - b.t || a.i - b.i)     // stable within tier
      .map((x) => x.s)
      .slice(0, MAX_SOURCES);
  }, [sources, statusOf, confirmedUrl, failedAt]);

  // Auto failover: if the current source is judged dead before it ever played,
  // advance to the first usable one. (Once playing, confirmedUrl shields it.)
  // Frozen while a probe round is in flight: verdicts are seconds away, and
  // hopping through unverified sources meanwhile is the recheck flicker.
  useEffect(() => {
    if (checking || sources.length === 0) return;
    if (currentSource && !isDead(currentSource)) return;
    const usable = sources.find((s) => !isDead(s));
    if (usable) {
      const idx = sources.indexOf(usable);
      if (idx >= 0 && idx !== validIndex) setSourceIndex(idx);
    }
  }, [checking, sources, isDead, currentSource, validIndex]);

  // Player pronounced the current source dead (stall / error / never started):
  // cool it down and advance, resuming the next source where this one died.
  // While a probe is in flight, record the failure but DON'T advance — the
  // auto-failover effect jumps once to a verified-working source when verdicts
  // land, instead of walking the unverified list.
  const handleSourceFailure = useCallback(
    (_lastTime: number) => {
      if (!currentSource) return;
      const failedUrl = currentSource.url;
      setConfirmedUrl((c) => (c === failedUrl ? null : c));
      setFailedAt((prev) => ({ ...prev, [failedUrl]: Date.now() }));
      if (checking) return;
      const after = sources.findIndex(
        (s, i) => i > validIndex && s.url !== failedUrl && !isDead(s)
      );
      const idx = after >= 0 ? after : sources.findIndex((s) => s.url !== failedUrl && !isDead(s));
      if (idx >= 0 && idx !== validIndex) setSourceIndex(idx);
    },
    [currentSource, sources, validIndex, isDead, checking]
  );

  // Save progress to Continue Watching. VideoPlayer already throttles this
  // callback (~8s), so no extra gating here. Finishing the movie clears the row.
  const handleProgress = useCallback(
    (currentTime: number, duration: number) => {
      if (!detail || !cwId || !duration || duration <= 0) return;
      if (currentTime >= duration - 30) {
        remove(cwId, "movie");
        return;
      }
      updateProgress({
        tmdbId: cwId,
        title: detail.title,
        poster: detail.backdrop,
        kind: "movie",
        progress: Math.round((currentTime / duration) * 100),
        duration,
        updatedAt: Date.now(),
      });
    },
    [detail, cwId, updateProgress, remove]
  );

  const handlePlay = useCallback(() => {
    if (currentSource) setConfirmedUrl(currentSource.url);
  }, [currentSource]);

  // Recheck: re-probe AND give playback-failed sources another chance.
  const recheckAll = useCallback(() => {
    setFailedAt({});
    recheck();
  }, [recheck]);

  if (loading) {
    return (
      <div className="pt-14 min-h-screen pb-20">
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
      <div className="min-h-screen pb-20 px-4 text-center pt-20">
        {fetchFailed ? (
          <>
            <p className="text-text-secondary">Couldn&apos;t load this title</p>
            <p className="text-text-muted text-xs mt-1">
              The server didn&apos;t respond — it may be restarting. Try again in a moment.
            </p>
            <div className="mt-4">
              <button
                onClick={() => setRetryTick((t) => t + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium min-h-[44px]"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </>
        ) : (
          <p className="text-text-secondary">Movie not found</p>
        )}
        <Link href="/vod" className="text-brand text-sm mt-3 inline-block">Back to VOD</Link>
      </div>
    );
  }

  return (
    <div className="relative pt-14 min-h-screen pb-20 animate-page-rise">
      {/* Back */}
      <Link href="/vod" className="absolute top-16 left-3 z-10 w-9 h-9 rounded-full glass-card flex items-center justify-center">
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

        {/* No sources yet */}
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

        {/* Player and source management */}
        {sources.length > 0 && currentSource && (
          <div className="mb-6 space-y-3">
            <VodPlayer
              src={currentSource.url}
              poster={detail.backdrop}
              title={detail.title}
              initialTime={resumeTime}
              autoPlay
              onProgress={handleProgress}
              onSourceFail={handleSourceFailure}
              onPlay={handlePlay}
              subtitles={subtitles}
            />

            {/* Open in new tab escape hatch */}
            <div className="flex items-center justify-end px-1">
              <a
                href={currentSource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] px-2.5 py-1 rounded-full bg-card text-text-muted hover:text-white transition-colors flex items-center gap-1"
                title="If this source won't play here, open it in a new tab"
              >
                <ExternalLink className="w-3 h-3" />
                Open
              </a>
            </div>

            <SourceTroubleHint
              resetKey={currentSource.url}
              message="Trouble with this stream? Try another source below."
            />

            {/* Source selector */}
            {sources.length > 1 && (
              <div className="flex flex-col gap-2">
                {/* Verification summary */}
                <div className="flex items-center justify-between px-1 text-xs text-text-muted">
                  <span>
                    {checking
                      ? "Checking sources…"
                      : shownWorking > 0
                        ? `${shownWorking} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${probeUrls.length}`
                        : busyCount > 0
                          ? `${busyCount} source${busyCount > 1 ? "s" : ""} busy — will connect when free`
                          : `0 of ${probeUrls.length} sources online`}
                  </span>
                  <button
                    onClick={recheckAll}
                    disabled={checking || revalidating}
                    className="flex items-center gap-1 text-text-secondary hover:text-white transition-colors disabled:opacity-50 min-h-[32px]"
                    aria-label="Re-check sources"
                  >
                    <RefreshCw className={`w-3 h-3 ${checking || revalidating ? "animate-spin" : ""}`} />
                    <span>Recheck</span>
                  </button>
                </div>

                <div className="flex gap-2 overflow-x-auto px-1">
                  {displaySources.map((src, idx) => {
                    const isCurrent = src.url === currentSource?.url;
                    const srcStatus: SourceStatus = isDead(src) ? "dead" : statusOf(src.url);
                    return (
                      <button
                        key={src.url}
                        onClick={() => {
                          const sourceIdx = sources.indexOf(src);
                          if (sourceIdx >= 0) setSourceIndex(sourceIdx);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                          isCurrent
                            ? "bg-brand text-white"
                            : srcStatus === "dead"
                              ? "bg-card text-text-muted opacity-60 hover:opacity-100"
                              : "bg-card text-text-secondary hover:text-white"
                        }`}
                      >
                        <StatusDot status={srcStatus} />
                        {revalidating && probeUrls.includes(src.url) && (
                          <Loader2 className="w-3 h-3 animate-spin text-text-muted" />
                        )}
                        {src.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Helpful tip */}
            <p className="flex items-start gap-1.5 px-1 text-[11px] text-text-muted">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span>
                If a stream keeps restarting or looping, tap{" "}
                <span className="text-text-secondary font-medium">Open</span> to play it in a new tab
                or try another source above.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
