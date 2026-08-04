"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "tvspot_scroll";

/**
 * How long a saved offset stays meaningful.
 *
 * Restoration exists for "the tab was evicted and reloaded under me". It is not
 * a bookmark: coming back tomorrow and being dropped where you stopped reading
 * yesterday is disorienting, and it is what made opening the app land at the
 * bottom of Home.
 */
const MAX_AGE_MS = 30 * 60 * 1000;

/** Restore attempts, ms after mount. Content arrives async even from cache, so
 *  the page usually isn't tall enough on the first tick. */
const ATTEMPTS = [0, 150, 400, 800];

/**
 * Only the FIRST route rendered in a given document may restore.
 *
 * Module scope = per document load, which is exactly the lifetime we want. Every
 * later pathname change is a client-side navigation, and those are Next's job
 * (the App Router already restores scroll for them) — this hook re-restoring on
 * top of that is what jumped you down the page on every tab switch.
 */
let restoreConsumed = false;

type Entry = { y: number; t: number };

function readMap(): Record<string, Entry> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    // Tolerate the old shape (bare numbers) by discarding it — a stale offset
    // with no timestamp is exactly what this change is here to stop honouring.
    const out: Record<string, Entry> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === "object" && typeof (v as Entry).y === "number") {
        out[k] = v as Entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Was this document REBUILT under the user (reload / back-forward), as opposed
 * to opened fresh?
 *
 * A fresh open should start where the page starts. Only a rebuild loses a
 * position the user still expects to be holding.
 */
function documentWasRebuilt(): boolean {
  try {
    const nav = performance.getEntriesByType?.("navigation")?.[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav?.type) return nav.type === "reload" || nav.type === "back_forward";
    // Chromium 63 on the 2019 Samsung reports through the deprecated API.
    const legacy = (performance as unknown as { navigation?: { type?: number } })
      .navigation?.type;
    return legacy === 1 || legacy === 2;
  } catch {
    return false;
  }
}

/**
 * Per-route scroll restoration across full reloads.
 *
 * Next's App Router restores scroll for in-app navigations, but a mobile tab
 * eviction is a full document reload — scroll position is lost and you land at
 * the top of a long rail. We snapshot scrollY per path (in localStorage, so it
 * also survives eviction) and restore it after the content has height again.
 *
 * WHAT WENT WRONG BEFORE: it restored on EVERY mount of every route. So it fired
 * on cold app opens and on ordinary tab switches, replaying whatever offset that
 * path last held — often from a previous session. And it fired before the
 * content had height, where window.scrollTo() silently CLAMPS to the bottom of
 * whatever is rendered. On a skeleton that is the bottom of the page, which is
 * precisely the "it jumps straight to the bottom when we open it or change
 * page" symptom. Three guards now: only a rebuilt document restores, only its
 * first route, and only once the page is genuinely tall enough to hold the
 * target — otherwise we leave the user at the top, which is the right way to
 * fail.
 */
export function useScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const mayRestore = !restoreConsumed && documentWasRebuilt();
    restoreConsumed = true;

    if (mayRestore) {
      const entry = readMap()[pathname];
      const target = entry && Date.now() - entry.t < MAX_AGE_MS ? entry.y : 0;
      if (target > 0) {
        for (const d of ATTEMPTS) {
          timers.push(
            setTimeout(() => {
              if (cancelled) return;
              // Never scroll past what actually exists — a clamped scrollTo is
              // how "restore" became "jump to the bottom".
              const max =
                document.documentElement.scrollHeight - window.innerHeight;
              if (target > max) return; // not tall enough yet; a later attempt may be
              if (Math.abs(window.scrollY - target) > 4) window.scrollTo(0, target);
            }, d),
          );
        }
      }
    }

    // Save (throttled) as the user scrolls, for whichever path is showing.
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        const map = readMap();
        map[pathname] = { y: window.scrollY, t: Date.now() };
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
