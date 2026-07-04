"use client";

import { useEffect } from "react";
import { isPlaybackActive, onPlaybackChange } from "@/lib/playbackState";

/**
 * Registers the app-shell service worker (public/sw.js).
 *
 * The SW caches the app shell so a reload repaints in one frame instead of
 * blanking → auth round-trip → data re-fetch. Production only: in dev the Next
 * chunk hashes change constantly and a SW would serve stale bundles.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        // Check for a new sw.js immediately (not just the browser's own cadence)
        // so a post-deploy VERSION bump rotates stale caches on the FIRST page
        // load after a deploy instead of a navigation later.
        .then((reg) => reg.update().catch(() => {}))
        .catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // Reload once when a NEW worker takes over after a deploy, so users aren't
    // left on a half-updated shell. `hadController` is false on the very first
    // install (initial clients.claim), so we don't reload on first visit.
    // NEVER reload while a stream is playing — defer to the moment playback stops
    // so a deploy never cuts the video (same gate as DeployRefresh).
    const hadController = !!navigator.serviceWorker.controller;
    let refreshed = false;
    let pending = false;
    const doReload = () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    };
    const onControllerChange = () => {
      if (refreshed || !hadController) return;
      if (isPlaybackActive()) { pending = true; return; }
      doReload();
    };
    const unsubPlayback = onPlaybackChange((active) => {
      if (!active && pending) doReload();
    });
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      unsubPlayback();
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
