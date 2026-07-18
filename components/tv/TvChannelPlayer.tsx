"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useChannels } from "@/hooks/useChannels";
import { getChannelSources, channelSlug } from "@/lib/sources";
import { useStreamCheck, type SourceStatus } from "@/hooks/useStreamCheck";
import VideoPlayer from "@/components/VideoPlayer";
import { LogoImage } from "@/components/LogoImage";
import { useTvBack } from "@/components/tv/TvNav";
import { TVKEY } from "@/lib/tv";
import { Check, X, Loader2, RefreshCw } from "lucide-react";

/** How many sources to surface in the overlay. */
const MAX_SOURCES = 6;
/** Transient channel/source banner lifetime. */
const BANNER_MS = 3500;
/** Info overlay auto-closes after this much remote inactivity. */
const OVERLAY_IDLE_MS = 8000;

function StatusDot({ status }: { status: SourceStatus }) {
  if (status === "checking") return <Loader2 className="w-4 h-4 animate-spin text-text-muted" />;
  if (status === "working") return <Check className="w-4 h-4 text-green-400" />;
  if (status === "dead") return <X className="w-4 h-4 text-red-400" />;
  if (status === "busy") return <span className="w-3 h-3 rounded-full bg-amber-400" />;
  return null;
}

/**
 * Full-screen live player for the TV shell. The source pipeline — verified
 * links first, live probing, busy-aware auto-pick, drop cooldowns — is a port
 * of ChannelPlayer's state machine; only the control surface differs:
 *
 *   Up/Down (or ChannelUp/Down)  zap to the prev/next channel
 *   Left/Right                   cycle to another source
 *   Enter                        info overlay (sources, status, recheck)
 *   Play/Pause media keys        pause/resume
 *   Back                         close the overlay, else leave the player
 */
export default function TvChannelPlayer({ channelName }: { channelName: string }) {
  const { channels } = useChannels();
  const router = useRouter();

  const channel = channels.find((c) => channelSlug(c.name) === channelName);

  // ── source pipeline (ported from ChannelPlayer) ─────────────────────────
  const probedUrls = useMemo(() => {
    if (!channel) return [];
    const merged = [
      ...getChannelSources(channel.name),
      channel.primary_url,
      ...(channel.backup_urls || []),
    ].filter((u): u is string => Boolean(u));
    return Array.from(new Set(merged)).slice(0, 20);
  }, [channel]);

  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const expansionFired = useRef(false);

  const allUrls = useMemo(
    () =>
      extraUrls.length > 0
        ? [...new Set([...probedUrls, ...extraUrls])].slice(0, 24)
        : probedUrls,
    [probedUrls, extraUrls],
  );

  const { statusOf, workingCount, busyCount, loading, recheck } = useStreamCheck(allUrls);

  const channelSlugValue = channel ? channelSlug(channel.name) : "";
  const prevChannelSlug = useRef(channelSlugValue);
  useEffect(() => {
    if (channelSlugValue === prevChannelSlug.current) return;
    prevChannelSlug.current = channelSlugValue;
    expansionFired.current = false;
    setExtraUrls([]);
  }, [channelSlugValue]);

  // Probe settled short of 2 working sources → pull the waiting-bench URLs.
  useEffect(() => {
    if (loading || workingCount >= 2 || expansionFired.current || probedUrls.length === 0) return;
    expansionFired.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/extra-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: channelSlugValue, exclude: probedUrls }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: { urls?: string[] } = await res.json();
        if (Array.isArray(data.urls) && data.urls.length > 0) setExtraUrls(data.urls);
      } catch {}
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, workingCount, channelSlugValue]);

  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [failedAt, setFailedAt] = useState<Record<string, number>>({});
  const FAIL_COOLDOWN_MS = 60000;

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const [prevName, setPrevName] = useState(channel?.name);
  if (channel?.name !== prevName) {
    setPrevName(channel?.name);
    setPickedUrl(null);
    setFailedAt({});
    setConfirmedUrl(null);
  }

  const isDead = (u: string) => {
    if (failedAt[u] !== undefined && Date.now() - failedAt[u] < FAIL_COOLDOWN_MS) return true;
    if (u === confirmedUrl) return false;
    return statusOf(u) === "dead";
  };

  const shownWorking =
    workingCount + (confirmedUrl && statusOf(confirmedUrl) !== "working" ? 1 : 0);

  const displayUrls = useMemo(() => {
    const alive = allUrls.filter((u) => !isDead(u));
    const base = (alive.length > 0 ? alive : allUrls).slice(0, MAX_SOURCES);
    if (pickedUrl && allUrls.includes(pickedUrl) && !base.includes(pickedUrl)) {
      return [pickedUrl, ...base].slice(0, MAX_SOURCES);
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUrls, statusOf, pickedUrl, failedAt]);

  const pickValid = pickedUrl != null && allUrls.includes(pickedUrl) && !isDead(pickedUrl);
  const pickRank = (u: string): number => {
    if (u === confirmedUrl) return -1;
    const s = statusOf(u);
    if (s === "working") return 0;
    if (s === "checking" || s === "unknown") return 1;
    if (s === "busy") return 2;
    return 3;
  };
  const firstAlive = allUrls
    .filter((u) => !isDead(u))
    .sort((a, b) => pickRank(a) - pickRank(b))[0];
  const fallback =
    firstAlive ??
    [...allUrls].sort((a, b) => (failedAt[a] ?? 0) - (failedAt[b] ?? 0))[0] ??
    "";
  const src = pickValid ? (pickedUrl as string) : fallback;

  const handleSourceFailure = useCallback(() => {
    if (!src) return;
    setFailedAt((prev) => ({ ...prev, [src]: Date.now() }));
  }, [src]);

  const recheckAll = useCallback(() => {
    setFailedAt({});
    recheck();
  }, [recheck]);

  // ── TV controls ─────────────────────────────────────────────────────────
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = overlayOpen;

  // Transient banner: shows on channel entry and on source change.
  const [bannerText, setBannerText] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBanner = useCallback((text: string) => {
    setBannerText(text);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBannerText(null), BANNER_MS);
  }, []);
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);
  useEffect(() => {
    if (channel) showBanner(channel.name);
  }, [channel?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const zap = useCallback(
    (delta: 1 | -1) => {
      if (!channel) return;
      const idx = channels.findIndex((c) => c.name === channel.name);
      const next = channels[idx + delta];
      if (next) router.replace(`/tv/live/${channelSlug(next.name)}`);
    },
    [channel, channels, router],
  );

  const cycleSource = useCallback(
    (delta: 1 | -1) => {
      if (displayUrls.length < 2) return;
      const cur = Math.max(0, displayUrls.indexOf(src));
      const next = (cur + delta + displayUrls.length) % displayUrls.length;
      setPickedUrl(displayUrls[next]);
      showBanner(`Source ${next + 1} of ${displayUrls.length}`);
    },
    [displayUrls, src, showBanner],
  );

  // Remote keys while the overlay is CLOSED. With it open, TvNav's spatial
  // focus owns the arrows (the overlay is a data-tv-trap) and Back closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayOpenRef.current) return;
      const code = e.keyCode;
      switch (code) {
        case TVKEY.up:
        case TVKEY.channelUp:
          e.preventDefault();
          zap(1);
          return;
        case TVKEY.down:
        case TVKEY.channelDown:
          e.preventDefault();
          zap(-1);
          return;
        case TVKEY.left:
          e.preventDefault();
          cycleSource(-1);
          return;
        case TVKEY.right:
          e.preventDefault();
          cycleSource(1);
          return;
        case TVKEY.enter:
          e.preventDefault();
          setOverlayOpen(true);
          return;
        case TVKEY.playPause:
        case TVKEY.play:
        case TVKEY.pause: {
          e.preventDefault();
          const v = videoElRef.current;
          if (!v) return;
          if (code === TVKEY.play ? v.paused : code === TVKEY.pause ? !v.paused : true) {
            if (v.paused) void v.play().catch(() => {});
            else v.pause();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zap, cycleSource]);

  // Back closes the overlay while it's open (innermost handler wins; with the
  // overlay closed, TvNav's default Back leaves the player).
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);
  useTvBack(overlayOpen ? closeOverlay : null);

  // The overlay auto-closes after idle so it can't sit over the video forever.
  useEffect(() => {
    if (!overlayOpen) return;
    let timer = setTimeout(closeOverlay, OVERLAY_IDLE_MS);
    const rearm = () => {
      clearTimeout(timer);
      timer = setTimeout(closeOverlay, OVERLAY_IDLE_MS);
    };
    window.addEventListener("keydown", rearm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", rearm);
    };
  }, [overlayOpen, closeOverlay]);

  if (!channel) {
    // Lineup still loading (cold start straight into a deep link) vs a truly
    // unknown slug — don't flash "not found" while the list is on its way.
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-2xl text-text-secondary">
          {channels.length === 0 ? "Tuning…" : "Channel not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* VideoPlayer renders a w-full aspect-video box — on a 16:9 panel that
          IS the screen; just strip its mobile rounding. */}
      <div className="w-full h-full flex items-center justify-center [&>div]:rounded-none">
        <VideoPlayer
          src={src}
          channelName={channel.name}
          title={channel.name}
          isLive
          videoElRef={videoElRef}
          onPlay={() => setConfirmedUrl(src)}
          onStall={handleSourceFailure}
          onError={handleSourceFailure}
        />
      </div>

      {/* Channel/source banner (top-left, transient) */}
      {bannerText && !overlayOpen && (
        <div className="absolute top-10 left-12 flex items-center gap-4 bg-black/70 rounded-2xl px-6 py-4 animate-fade-in">
          <div className="w-16 h-10">
            <LogoImage
              name={channel.name}
              logoUrl={channel.logo_url || channel.logo}
              className="w-full h-full"
              fallbackClassName="text-lg font-bold text-white/80"
            />
          </div>
          <p className="text-2xl font-semibold text-white">{bannerText}</p>
        </div>
      )}

      {/* Info overlay: sources + status + recheck. data-tv-trap hands the
          arrows to spatial focus among the chips while it's open. */}
      {overlayOpen && (
        <div
          data-tv-trap
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent px-12 pt-24 pb-10 animate-fade-in"
        >
          <div className="flex items-center gap-5 mb-6">
            <div className="w-20 h-12">
              <LogoImage
                name={channel.name}
                logoUrl={channel.logo_url || channel.logo}
                className="w-full h-full"
                fallbackClassName="text-xl font-bold text-white/80"
              />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{channel.name}</p>
              <p className="text-lg text-text-secondary">
                {loading
                  ? "Checking sources…"
                  : shownWorking > 0
                    ? `${shownWorking} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${allUrls.length}`
                    : busyCount > 0
                      ? `${busyCount} busy — will connect when free`
                      : `0 of ${allUrls.length} sources online`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {displayUrls.map((url, i) => {
              const status = isDead(url) ? "dead" : statusOf(url);
              const isCurrent = url === src;
              return (
                <button
                  key={url}
                  data-tv
                  {...(isCurrent ? { "data-tv-autofocus": true } : {})}
                  onClick={() => {
                    setPickedUrl(url);
                    setOverlayOpen(false);
                  }}
                  className={`flex items-center gap-2.5 px-6 py-3.5 rounded-xl text-xl font-medium ${
                    isCurrent
                      ? "bg-brand text-white"
                      : status === "dead"
                        ? "bg-card text-text-muted"
                        : "bg-card text-text-secondary"
                  }`}
                >
                  <StatusDot status={status} />
                  Source {i + 1}
                </button>
              );
            })}
            <button
              data-tv
              onClick={recheckAll}
              disabled={loading}
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl text-xl font-medium bg-card text-text-secondary disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
              Recheck
            </button>
          </div>

          <p className="mt-6 text-base text-text-muted">
            Up/Down: channel · Left/Right: source · Back: close
          </p>
        </div>
      )}
    </div>
  );
}
