"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "tvspot_scroll";

/**
 * Per-route scroll restoration across full reloads.
 *
 * Next's App Router restores scroll for in-app navigations, but a mobile tab
 * eviction is a full document reload — scroll position is lost and you land at the
 * top of a long rail. We snapshot scrollY per path (in localStorage, so it also
 * survives eviction) and restore it after the content has height again.
 */
export function useScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    const readMap = (): Record<string, number> => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || "{}");
      } catch {
        return {};
      }
    };

    // Restore. Content loads async (even from cache), so retry over ~1s until the
    // page is tall enough for the target to actually stick.
    let cancelled = false;
    const target = readMap()[pathname];
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (typeof target === "number" && target > 0) {
      for (const d of [0, 150, 400, 800]) {
        timers.push(
          setTimeout(() => {
            if (!cancelled && Math.abs(window.scrollY - target) > 4) {
              window.scrollTo(0, target);
            }
          }, d),
        );
      }
    }

    // Save (throttled) as the user scrolls.
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        const map = readMap();
        map[pathname] = window.scrollY;
        try {
          localStorage.setItem(KEY, JSON.stringify(map));
        } catch {}
      }, 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      timers.forEach(clearTimeout);
      if (t) clearTimeout(t);
    };
  }, [pathname]);
}
