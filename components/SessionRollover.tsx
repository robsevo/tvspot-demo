"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isPlaybackActive, onPlaybackChange } from "@/lib/playbackState";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";

/**
 * Lands an app whose session has genuinely died on /login, cleanly.
 *
 * Without this, a page left open past its session just becomes a zombie: the UI
 * looks alive, every API call 401s, and the user is stuck staring at a broken
 * app until they reload by hand. Middleware only redirects on a document
 * navigation, and an app left open never navigates.
 *
 * WHAT THIS IS NOT, ANY MORE: until 2026-07-27 this watcher was armed to the
 * 4 AM ET rollover, because the token was *built* to die there — so it fired
 * every single morning on every device and logged everyone out on purpose. That
 * boundary is gone (see lib/auth.ts): sessions are 30 days, slid forward by
 * middleware on every request from an active user. A session now ends only
 * because the app went unused for a month, credentials rotated, or JWT_SECRET
 * changed — all rare, none of them scheduled. So this no longer has a time to
 * wait for; it just confirms, occasionally and on re-entry, that we're still
 * signed in.
 *
 * Rules kept from the original, because they were the good part:
 *  - the server is the source of truth (/api/auth/me), never a client clock;
 *  - never mid-playback — a direct relay stream can outlive the cookie, and
 *    cutting video is worse than a late redirect. A pending logout fires shortly
 *    after playback stops;
 *  - location.replace(), not SPA nav: the session is gone, so dropping client
 *    state is correct and middleware guarantees the destination;
 *  - a once-guard so no failure mode can redirect-cycle the app.
 */

/**
 * How stale a confirmation may get before we re-check on re-entry. Long on
 * purpose: this is a safety net for a rare event, not a poll. Re-opening the app
 * all day costs at most one tiny request every few hours.
 */
const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;

export default function SessionRollover() {
  const { username } = useAuth();
  // Survives re-mounts within the session so tab-switching can't turn the
  // re-entry check into a request per switch.
  const lastConfirmedAt = useRef(0);

  useEffect(() => {
    // Not signed in (or on /login): nothing to watch. The optimistic cached
    // username can flash on /login, but toLogin() guards pathname.
    if (!username || typeof window === "undefined") return;

    let disposed = false;
    let checking = false;
    let pendingLogout = false;

    if (lastConfirmedAt.current === 0) lastConfirmedAt.current = Date.now();

    const toLogin = () => {
      if (window.location.pathname === "/login") return;
      try {
        // Once-guard: no failure mode may redirect-cycle the app.
        const last = Number(sessionStorage.getItem("tvspot_session_logout_ts") || 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem("tvspot_session_logout_ts", String(Date.now()));
      } catch {}
      window.location.replace("/login");
    };

    const verify = async () => {
      if (disposed || checking) return;
      checking = true;
      let loggedIn: boolean | null = null; // null = couldn't tell (network blip)
      try {
        // Deadlined: `checking` is only cleared after this settles, so a fetch
        // that never answers would permanently disable detection.
        const res = await fetchWithDeadline(
          "/api/auth/me",
          { cache: "no-store", credentials: "include" },
          DEADLINE.auth,
        );
        if (res.ok) loggedIn = Boolean((await res.json())?.username);
      } catch {}
      checking = false;
      if (disposed) return;

      // Couldn't confirm — say nothing. Leaving lastConfirmedAt alone means the
      // next re-entry retries, which is the safe direction: a network blip must
      // never log anyone out.
      if (loggedIn === null) return;

      if (loggedIn) {
        lastConfirmedAt.current = Date.now();
        return;
      }

      // Session really is gone. Leave now unless a stream is playing.
      if (!isPlaybackActive()) {
        toLogin();
        return;
      }
      pendingLogout = true;
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastConfirmedAt.current < RECHECK_AFTER_MS) return;
      void verify();
    };

    // Playback stopped with a logout pending → go after a short grace (absorbs
    // an episode/channel switch; if playback resumes, this re-defers).
    const unsubPlayback = onPlaybackChange((active) => {
      if (active || !pendingLogout || disposed) return;
      setTimeout(() => {
        if (!disposed && pendingLogout && !isPlaybackActive()) toLogin();
      }, 2_500);
    });

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      unsubPlayback();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [username]);

  return null;
}
