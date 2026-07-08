"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { nextRolloverMs } from "@/lib/dailyBoundary";
import { isPlaybackActive, onPlaybackChange } from "@/lib/playbackState";

/**
 * Client half of the nightly 4 AM ET forced-logout.
 *
 * The JWT/cookie dies at the boundary (lib/auth.ts) and middleware redirects
 * the NEXT document navigation to /login — but an app left open overnight
 * never navigates. It just sits there as a zombie: UI looks alive, every API
 * call 401s, and the morning starts with a broken app until someone reloads by
 * hand. This watcher notices the boundary from INSIDE the open page and lands
 * it on /login cleanly instead.
 *
 * How:
 *  - arm a timer for the next 4 AM ET (raw boundary, no min-TTL skip), and
 *    re-check on visibility re-entry — mobile browsers freeze timers while
 *    backgrounded, so the wake-up check is what usually fires in practice.
 *  - on/after the boundary, confirm with /api/auth/me before acting. The
 *    server is the source of truth: client clock skew or a fresh post-boundary
 *    login (token now expires TOMORROW) must never log anyone out early.
 *  - never mid-playback — a direct relay stream can outlive the JWT, and
 *    cutting video is worse than a late logout. A deferred logout fires shortly
 *    after playback stops (same safe-moment rules as DeployRefresh).
 *  - location.replace() (not SPA nav): the session is gone, so dropping client
 *    state is correct, and middleware guarantees the destination.
 */
export default function SessionRollover() {
  const { username } = useAuth();

  useEffect(() => {
    // Not signed in (or on /login): nothing to watch. The optimistic cached
    // username can flash on /login, but the mount path only ARMS a future
    // timer — it never fetches or redirects — and toLogin() guards pathname.
    if (!username || typeof window === "undefined") return;

    let disposed = false;
    let checking = false;
    let pendingLogout = false;
    let boundary = nextRolloverMs(Date.now(), 0);
    let timer: ReturnType<typeof setTimeout> | null = null;

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

    const arm = (atMs: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void maybeExpire(), Math.max(1_000, atMs - Date.now()));
    };

    const maybeExpire = async () => {
      if (disposed || checking) return;
      checking = true;
      let loggedIn: boolean | null = null; // null = couldn't tell (network blip)
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) loggedIn = Boolean((await res.json())?.username);
      } catch {}
      checking = false;
      if (disposed) return;
      if (loggedIn === null) {
        arm(Date.now() + 60_000); // can't confirm — retry, don't guess
        return;
      }
      if (loggedIn) {
        // Still valid (fresh token issued near the boundary) — watch the next one.
        boundary = nextRolloverMs(Date.now(), 0);
        arm(boundary);
        return;
      }
      // Session is dead. Leave now unless a stream is playing.
      if (!isPlaybackActive()) {
        toLogin();
        return;
      }
      pendingLogout = true;
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() >= boundary) void maybeExpire();
    };

    // Playback stopped with a logout pending → go after a short grace (absorbs
    // an episode/channel switch; if playback resumes, the check re-defers).
    const unsubPlayback = onPlaybackChange((active) => {
      if (active || !pendingLogout || disposed) return;
      setTimeout(() => {
        if (!disposed && pendingLogout && !isPlaybackActive()) toLogin();
      }, 2_500);
    });

    arm(boundary);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubPlayback();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [username]);

  return null;
}
