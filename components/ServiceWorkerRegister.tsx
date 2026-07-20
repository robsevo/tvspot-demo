"use client";

import { useEffect } from "react";
import { isPlaybackActive, onPlaybackChange } from "@/lib/playbackState";
import { TV_UA_RE } from "@/lib/tv";

/**
 * Registers the app-shell service worker (public/sw.js).
 *
 * The SW caches the app shell so a reload repaints in one frame instead of
 * blanking → auth round-trip → data re-fetch. Production only: in dev the Next
 * chunk hashes change constantly and a SW would serve stale bundles.
 *
 * NOT ON THE TV — and it actively removes itself there. The SW was built for a
 * MOBILE problem: browser tab eviction under memory pressure, where an instant
 * shell repaint is the whole point. A TV app is launched fresh from the Tizen
 * wrapper every time, so that benefit is small — while the cost turned out to
 * be large and repeated on the RU7100:
 *
 *  - it keeps a stale shell + chunk set alive on the device, so DEPLOYS DO NOT
 *    REACH THE TV. Several fixes were shipped, verified on prod, and still
 *    "did nothing" because the box was serving yesterday's bundle;
 *  - a cached shell references that build's chunk HASHES, so a shell/asset
 *    mismatch leaves the page dead with no JS at all (see chunk-guard history);
 *  - and it made the failures unreadable: the device ran code that no longer
 *    matched anything I could inspect or redeploy.
 *
 * Removing it makes the TV honest: what is deployed is what runs. The unregister
 * + cache purge below is the migration path for TVs that already carry one — it
 * runs once, on the first load after this ships, and then there is nothing left
 * to go stale.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    if (TV_UA_RE.test(navigator.userAgent)) {
      // Tear down anything a previous build left installed, then stop. Both
      // steps are needed: unregistering alone leaves the Cache Storage entries
      // (and their memory) behind on a 1GB box.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister().catch(() => false))))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k).catch(() => false))))
          .catch(() => {});
      }
      return;
    }

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
