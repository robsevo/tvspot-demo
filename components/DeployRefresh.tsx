"use client";

import { useEffect } from "react";
import { isPlaybackActive, onPlaybackChange } from "@/lib/playbackState";

/**
 * Reload gracefully when THIS page's build no longer matches the deployment
 * that's live.
 *
 * Without this, an open client keeps its old build until a navigation trips
 * Next's version-skew fallback: chunk/RSC fetches hit the new deployment,
 * mismatch, hard reload mid-use ("the site broke and rebuilt"). Worse, the
 * service worker's shell cache can RESURRECT the old build's HTML on that
 * reload — old page → skew → reload → cached old page → … a reload death
 * loop until the SW happens to update.
 *
 * Fix shape:
 *  - compare the page's OWN build id (baked at build time) against
 *    /api/version (served by whatever deployment is live). A stale page can
 *    always tell it's stale — however it got loaded.
 *  - before reloading, DELETE the SW shell caches so the reload fetches the
 *    new build from the network instead of the stale cache.
 *  - reload ONLY at invisible/boundary moments: backgrounded → now; re-opened
 *    → at re-entry, before the user starts doing anything. NEVER mid-use —
 *    a foreground reload, however "idle" the app looks, reads as the app
 *    hard-resetting itself; mid-use mismatches wait for the next background.
 *  - NEVER while a stream is playing (isPlaybackActive), even at re-entry — a
 *    reload mid-watch cuts the video. A pending reload instead fires shortly
 *    after playback stops (a short grace absorbs channel switches), or on the
 *    next background — whichever comes first. This is what makes a production
 *    deploy painless for someone actively watching.
 *  - 60s sessionStorage guard so no failure mode can reload-cycle the app.
 */
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

export default function DeployRefresh() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    // Local/hand builds aren't stamped — skew detection needs a real id.
    if (MY_BUILD === "dev") return;

    let pendingReload = false;
    let disposed = false;

    const reload = async () => {
      try {
        const last = Number(sessionStorage.getItem("tvspot_deploy_reload_ts") || 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem("tvspot_deploy_reload_ts", String(Date.now()));
      } catch {}
      // Drop the stale app-shell so the reload lands on the NEW build.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith("tvspot-shell")).map((k) => caches.delete(k)));
      } catch {}
      window.location.reload();
    };

    const check = async (atReentry = false) => {
      if (disposed) return;
      let id: string | null = null;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        id = (await res.json())?.id || null;
      } catch {
        return; // offline / transient — never reload on a failed check
      }
      if (!id || id === "dev" || id === MY_BUILD) return;
      // A different build is live and this page is stale. NEVER reload while
      // the user is actively in the app ("the app hard reset on me") — only
      // when it's invisible (hidden) or at the natural re-entry boundary,
      // before they've started doing anything. And NEVER while a stream is
      // playing, even at re-entry — that would cut the video. Deferred reloads
      // fire when playback stops (below), at the next idle lull (armIdleTimer),
      // or on the next background.
      if (document.visibilityState === "hidden") { void reload(); return; }
      if (atReentry && !isPlaybackActive()) { void reload(); return; }
      pendingReload = true;
      armIdleTimer(); // mid-session deploy: reload at the next foreground lull
    };

    // Idle-reload: a deploy detected mid-session (while foreground) can't reload
    // immediately — that reads as a hard reset under active use. But if we do
    // nothing, the user's next tap trips Next's skew reload, which is the SAME
    // reset at a WORSE moment (feels tap-triggered). So when the user goes quiet
    // — no interaction for IDLE_MS while still foreground — reload at that lull,
    // beating the tap. Any interaction re-arms the timer, so we never reload out
    // from under someone actively browsing; playback blocks it outright.
    const IDLE_MS = 20_000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearIdleTimer = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
    const armIdleTimer = () => {
      clearIdleTimer();
      if (!pendingReload || disposed) return;
      idleTimer = setTimeout(() => {
        if (disposed || !pendingReload) return;
        if (document.visibilityState !== "visible") return; // hidden path owns this
        if (isPlaybackActive()) return;                      // never cut a stream
        void reload();
      }, IDLE_MS);
    };
    // Cheap no-op until an update is pending, so the always-on listeners cost
    // nothing in the common case.
    const onActivity = () => { if (pendingReload) armIdleTimer(); };
    const activityEvents = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearIdleTimer();
        if (pendingReload) void reload();
      } else {
        void check(true); // re-entry: catch deploys that shipped while backgrounded
      }
    };
    const onPageHide = () => {
      if (pendingReload) void reload();
    };

    // When playback stops with an update pending, reload after a short grace so
    // the user lands on the new build at the natural "done watching" moment. The
    // grace absorbs a channel switch (old player pauses → new player plays within
    // ~1s); if playback resumes, cancel and keep waiting.
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStopTimer = () => { if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; } };
    const unsubPlayback = onPlaybackChange((active) => {
      if (active) { clearStopTimer(); clearIdleTimer(); return; }
      if (!pendingReload || disposed) return;
      clearStopTimer();
      stopTimer = setTimeout(() => {
        if (!disposed && pendingReload && !isPlaybackActive()) void reload();
      }, 2500);
    });

    // First mount IS a re-entry boundary — "re-opened, before the user does
    // anything." When the service worker serves a stale shell after a deploy,
    // this is the ONE safe moment to reload cleanly (cache-cleared → new build)
    // BEFORE the user taps a channel and trips Next's mid-navigation skew reload
    // ("tapped a channel and the site rebuilt"). Guarded by !isPlaybackActive()
    // inside check() and the 60s sessionStorage backstop against loops.
    void check(true);
    // Poll often enough that a mid-session deploy is detected within a couple of
    // minutes — so the idle-lull reload has a chance to fire before the user's
    // next tap trips Next's skew reload. /api/version is a tiny no-store function.
    const interval = setInterval(() => void check(), 2 * 60_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    activityEvents.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    return () => {
      disposed = true;
      clearStopTimer();
      clearIdleTimer();
      unsubPlayback();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      activityEvents.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, []);

  return null;
}
