"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { proxyFetch } from "@/lib/api";
import { writeCache } from "@/lib/localCache";
import { lastRolloverMs } from "@/lib/dailyBoundary";
import { fetchJson, DEADLINE } from "@/lib/fetchDeadline";
import { EPG_BATCH } from "@/hooks/useEpg";
import type {
  CatalogItem,
  ChannelsResponse,
  EpgProgram,
  EpgResponse,
} from "@/lib/types";

/**
 * First-sign-in-of-the-day loading splash.
 *
 * Why it exists: on the first open after the nightly backend refresh the app's
 * server caches are cold, so the trending catalog (~20s+ rebuild) and the EPG
 * (backend serves {} while warming) take ~10s to fill and the home page sits
 * half-loaded. This overlay covers that window with the TVSpot identity AND uses
 * the time to PREWARM the exact localStorage caches the pages read — so when it
 * lifts, Home and the guide paint instantly.
 *
 * Shown at most once per 4 AM ET rollover (the same boundary as nightly logout),
 * claimed via localStorage the moment it appears so a same-morning reload (e.g.
 * DeployRefresh) doesn't re-trigger it. Dismissal is adaptive: at least MIN_MS,
 * lifts as soon as the trending prewarm settles, hard-capped at MAX_MS.
 */

// Cache keys/shapes mirror the consumers so a prewarm write paints them directly:
const EPOCH_KEY = "tvspot_splash_epoch";
const TRENDING_CACHE_KEY = "tvspot_trending_v1"; // HomeClient.tsx
const TRENDING_CACHE_MAX = 300;
const CHANNELS_CACHE_KEY = "tvspot_channels"; // hooks/useChannels.ts
const EPG_CACHE_KEY = "tvspot_epg_v1"; // hooks/useEpg.ts

const MIN_MS = 3500; // don't flash by — let the animation read
const MAX_MS = 15000; // hard cap even if the backend is still cold
const STATUS = [
  "Signing you in…",
  "Loading channels…",
  "Fetching your TV guide…",
  "Almost ready…",
];

/** Prewarm the trending rails (the home-blocking, cold-start bottleneck). */
async function prewarmTrending(): Promise<void> {
  try {
    const data = await proxyFetch<{ movies: CatalogItem[]; series: CatalogItem[] }>(
      "/api/lounge/catalog?trending=true",
    );
    const movies = (data.movies || []).slice(0, TRENDING_CACHE_MAX);
    const series = (data.series || []).slice(0, TRENDING_CACHE_MAX);
    if (movies.length > 0) writeCache(TRENDING_CACHE_KEY, { movies, series });
  } catch {
    // Non-fatal: HomeClient still fetches on its own; the splash just lifts.
  }
}

/** Prewarm channels + EPG so /live is instant later (best-effort, non-gating). */
async function prewarmLive(): Promise<void> {
  try {
    const data = await proxyFetch<ChannelsResponse>("/api/lounge/live-channels");
    const channels = data.channels || [];
    if (channels.length > 0) writeCache(CHANNELS_CACHE_KEY, channels);
    const names = channels.map((c) => c.name).filter(Boolean);
    if (names.length === 0) return;

    // ONE BATCH ONLY. This used to request every channel at once, which is the
    // ~6.3MB single-shot response useEpg was batched (EPG_BATCH) to avoid: the
    // 2019 TV's ~1GB webview can't reliably download and JSON.parse that, and
    // the attempt janks or wedges the main thread at app start — on /tv this
    // prewarm runs on every load. Warming the first batch gives the guide a
    // useful head start at a fraction of the cost; useEpg fetches the rest.
    const { ok, data: epg } = await fetchJson<EpgResponse>(
      `/api/lounge/epg?channels=${encodeURIComponent(names.slice(0, EPG_BATCH).join(","))}`,
      { credentials: "include" },
      DEADLINE.background,
    );
    if (!ok || !epg) return;
    // Trim to the fields the grid renders (same shape useEpg caches).
    const map: Record<string, Pick<EpgProgram, "title" | "start_utc" | "stop_utc">[]> = {};
    for (const [name, progs] of Object.entries(epg.programmes || {})) {
      map[name] = progs.map((p) => ({
        title: p.title,
        start_utc: p.start_utc,
        stop_utc: p.stop_utc,
      }));
    }
    if (Object.keys(map).length > 0) writeCache(EPG_CACHE_KEY, map);
  } catch {
    // Non-fatal: useEpg has its own retry/backoff.
  }
}

export default function DailySplash() {
  const { username } = useAuth();
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const decidedRef = useRef(false);

  // The splash is a POST-sign-in loading screen — it must never paint over the
  // login form. On web a returning visitor can hold a still-valid cookie (so
  // `username` is already set from the server) while sitting on /login; without
  // this the splash would flash before they've done anything. Skipping the login
  // routes also covers the moment login() sets `username` a beat before
  // router.push navigates away. The splash then fires correctly on the
  // destination (/, /tv), which is "opened the page" / "actually logged in".
  const onLoginRoute = pathname === "/login" || pathname === "/tv/login";

  // Decide once (per mount) whether this is the first sign-in since the last
  // 4 AM ET rollover, and claim it immediately so reloads don't re-show it.
  useEffect(() => {
    if (onLoginRoute || !username || decidedRef.current || typeof window === "undefined") return;
    decidedRef.current = true;

    let epoch = 0;
    try {
      epoch = lastRolloverMs();
    } catch {
      return;
    }
    let stored = 0;
    try {
      stored = Number(localStorage.getItem(EPOCH_KEY)) || 0;
    } catch {}
    if (stored >= epoch) return; // already shown since the last rollover

    try {
      localStorage.setItem(EPOCH_KEY, String(epoch));
    } catch {}
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    setShow(true);
  }, [username, onLoginRoute]);

  // Lifecycle: prewarm the caches and drive adaptive dismissal while shown.
  useEffect(() => {
    if (!show) return;
    const startedAt = Date.now();
    let cancelled = false;
    let dismissed = false;
    let minTimer: ReturnType<typeof setTimeout> | undefined;

    const dismiss = () => {
      if (dismissed || cancelled) return;
      dismissed = true;
      setLeaving(true);
      window.setTimeout(() => setShow(false), 450); // after the opacity fade
    };

    const hard = window.setTimeout(dismiss, MAX_MS);
    const statusTimer = window.setInterval(() => {
      setStatusIdx((i) => Math.min(i + 1, STATUS.length - 1));
    }, 2500);

    prewarmLive(); // fire-and-forget; keeps warming even after the splash lifts
    prewarmTrending().finally(() => {
      if (cancelled) return;
      const wait = Math.max(0, MIN_MS - (Date.now() - startedAt));
      minTimer = setTimeout(dismiss, wait);
    });

    return () => {
      cancelled = true;
      clearTimeout(hard);
      clearInterval(statusTimer);
      if (minTimer) clearTimeout(minTimer);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-label="Loading TVSpot"
      className={`fixed inset-0 z-[70] flex flex-col items-center justify-center overflow-hidden bg-surface transition-opacity duration-[450ms] ${
        leaving ? "opacity-0 pointer-events-none" : "opacity-100 animate-fade-in"
      }`}
    >
      {/* Faint HUD grid — inline (not the .hud-grid-bg class, which forces
          position:relative and would collapse the fixed overlay to the top). */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 34px), repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 34px)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 20%, #000 0%, transparent 78%)",
          maskImage:
            "radial-gradient(ellipse at 50% 20%, #000 0%, transparent 78%)",
        }}
      />
      {/* Soft brand glow behind the lockup */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 38%, rgba(56,189,248,0.12), transparent 60%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-6">
        <div className={`rounded-2xl ${reduced ? "" : "neon-pulse"}`}>
          <img
            src="/tvspot-logo.svg"
            alt="TVSpot"
            className={`w-20 h-20 ${reduced ? "" : "animate-pulse"}`}
            style={{ filter: "drop-shadow(0 0 18px rgba(56,189,248,0.5))" }}
          />
        </div>

        <h1 className="text-2xl font-bold text-white hud-text-glow tracking-tight">
          TVSpot
        </h1>

        {reduced ? (
          <div className="w-3 h-3 rounded-full bg-cyan-400" />
        ) : (
          <div className="w-10 h-10 rounded-full border-[3px] border-white/15 border-t-cyan-400 border-r-brand animate-spin" />
        )}

        <p className="text-text-muted text-sm min-h-[1.25rem] text-center">
          {STATUS[statusIdx]}
        </p>

        <div className="w-48 h-1 rounded-full overflow-hidden bg-white/10">
          <div className={`h-full w-full ${reduced ? "bg-brand" : "brand-sheen"}`} />
        </div>
      </div>
    </div>
  );
}
