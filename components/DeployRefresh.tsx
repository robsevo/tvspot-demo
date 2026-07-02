"use client";

import { useEffect } from "react";

/**
 * Reload gracefully when a NEW deployment ships while the app is open.
 *
 * Without this, the open client keeps its old build until a navigation trips
 * Next's version-skew fallback: chunk/RSC fetches hit the new deployment,
 * mismatch, and Next hard-reloads mid-use — "the site broke and rebuilt".
 *
 * Instead: poll /api/version at benign moments and, when the deployment id
 * changes, reload while it's invisible or near-invisible (the SW app shell
 * repaints in a frame; auth/player/route/scroll all restore):
 *   - app backgrounded → reload immediately (fully invisible)
 *   - app re-opened (visibilitychange → visible) → reload at re-entry, before
 *     the user navigates into a broken route (covers the overnight 4 AM deploy)
 *   - foreground + nothing playing → reload now (state restore makes it a blink)
 *   - foreground + video playing → don't interrupt; reload on next background
 */
export default function DeployRefresh() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    let baseline: string | null = null;
    let pendingReload = false;
    let disposed = false;

    const reload = () => {
      // Loop guard: if a reload just happened, don't chain another (e.g. a
      // misbehaving /api/version must never make the app reload-cycle).
      try {
        const last = Number(sessionStorage.getItem("tvspot_deploy_reload_ts") || 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem("tvspot_deploy_reload_ts", String(Date.now()));
      } catch {}
      window.location.reload();
    };

    const videoPlaying = (): boolean => {
      for (const v of document.querySelectorAll("video")) {
        if (!v.paused && !v.ended && v.readyState > 2) return true;
      }
      return false;
    };

    const check = async () => {
      if (disposed) return;
      let id: string | null = null;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        id = (await res.json())?.id || null;
      } catch {
        return; // offline / transient — never reload on a failed check
      }
      if (!id) return;
      if (baseline === null) {
        baseline = id;
        return;
      }
      if (id === baseline) return;
      // New deployment is live. Reload invisibly if we can, defer if not.
      if (document.visibilityState === "hidden" || !videoPlaying()) reload();
      else pendingReload = true;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pendingReload) reload();
      } else {
        void check(); // re-entry: catch deploys that shipped while backgrounded
      }
    };

    void check(); // establish baseline for this page load
    const interval = setInterval(() => void check(), 10 * 60_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", () => {
      if (pendingReload) reload();
    });

    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
