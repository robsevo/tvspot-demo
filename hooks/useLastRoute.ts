"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "tvspot_last_route";
const RESTORED_FLAG = "tvspot_route_restored";
// Only auto-restore a deep route on a genuine cold launch within this window, so
// a day-old "last route" doesn't yank you off Home when you open the app fresh.
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Persists the current route and, on a cold PWA launch, restores it.
 *
 * Installed PWAs always relaunch at `start_url` ("/") after the OS evicts them,
 * so a backgrounded-then-killed app dumps you back on Home even though you were
 * mid-stream. We remember the last route and — once per session, only for a
 * standalone (installed) cold-start that actually landed on "/" — replace it with
 * wherever you were. Guarded so tapping Home in a normal session never triggers it.
 */
export function useLastRoute() {
  const pathname = usePathname();
  const router = useRouter();

  // Restore once per session, installed launches only.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(RESTORED_FLAG)) return;
      sessionStorage.setItem(RESTORED_FLAG, "1");

      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        // iOS Safari add-to-home-screen
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!standalone) return;
      if (window.location.pathname !== "/") return;

      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const { path, ts } = JSON.parse(raw) as { path?: string; ts?: number };
      if (!path || path === "/" || !ts || Date.now() - ts > MAX_AGE_MS) return;
      router.replace(path);
    } catch {
      // matchMedia/storage unavailable — no restore, no harm.
    }
  }, [router]);

  // Persist the current route on every navigation.
  useEffect(() => {
    if (!pathname) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ path: pathname, ts: Date.now() }));
    } catch {}
  }, [pathname]);
}
