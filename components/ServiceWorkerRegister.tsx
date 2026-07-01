"use client";

import { useEffect } from "react";

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
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // Reload once when a NEW worker takes over after a deploy, so users aren't
    // left on a half-updated shell. `hadController` is false on the very first
    // install (initial clients.claim), so we don't reload on first visit.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshed = false;
    const onControllerChange = () => {
      if (refreshed || !hadController) return;
      refreshed = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
