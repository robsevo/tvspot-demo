"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { TVKEY, exitTvApp } from "@/lib/tv";
import { pickNextIndex } from "@/lib/tvNavGeometry";

/**
 * Remote-control (D-pad) navigation for the /tv experience.
 *
 * Focus model: every interactive element carries `data-tv`. They're real
 * <button>/<a>/<input> elements, so Enter activates them through the browser's
 * own keydown→click mapping — this provider only implements ARROW movement and
 * Back. An arrow press focuses the geometrically nearest `data-tv` element in
 * that direction, strongly preferring candidates that overlap the current one
 * on the cross axis (same row/column), which handles rails, grids, and button
 * rows without per-page wiring.
 *
 * Scoping: while a `data-tv-trap` element is mounted (overlay/modal), only
 * candidates inside the LAST one in DOM order are reachable — an open overlay
 * owns the remote.
 *
 * Back (Tizen 10009; Escape in desktop browsers for dev): the innermost
 * registered useTvBack handler wins; with none registered, Back goes
 * router.back(), or exits the app at the /tv root. A focused text input eats
 * Back as blur() — on the TV that closes the on-screen keyboard instead of
 * leaving the page.
 */

type Dir = "left" | "right" | "up" | "down";

const DIR_BY_CODE: Record<number, Dir> = {
  [TVKEY.left]: "left",
  [TVKEY.right]: "right",
  [TVKEY.up]: "up",
  [TVKEY.down]: "down",
};

function isTextInput(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Focusable candidates in the active scope (innermost trap, else the page). */
function candidates(): HTMLElement[] {
  const traps = document.querySelectorAll<HTMLElement>("[data-tv-trap]");
  const scope: ParentNode = traps.length ? traps[traps.length - 1] : document;
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-tv]")).filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** Nearest candidate in `dir` from `curEl`, by primary-axis distance with a
 *  cross-axis drift penalty; non-overlapping candidates only win when nothing
 *  in the same row/column exists (e.g. dropping from a hero button to a rail).
 *
 *  CROSS-AXIS DRIFT IS A GAP, NOT A CENTRE DISTANCE (fixed 2026-08-16). It used
 *  to be `Math.abs(dx)` between centres, which punished WIDE candidates for
 *  being wide — even when they fully CONTAINED the current element. The EPG
 *  guide is where that bites: a channel row with no programme data renders ONE
 *  full-width button spanning the whole timeline, so its centre sits hours away
 *  from a narrow programme block sitting directly above it.
 *
 *  Measured with the guide's own geometry (PX_PER_MIN 8, ROW_H 112, 6h span),
 *  pressing DOWN from a 30-minute block in row 0:
 *      adjacent empty row 1 (contains it) ... 2748
 *      row 2 with an aligned programme ......  224   <- won
 *  so the remote skipped straight past every channel with no schedule. Scored as
 *  a gap the same two are 112 and 224, the adjacent row wins, and that is what a
 *  viewer means by "down". Overlapping candidates now cost 0 drift, so width is
 *  no longer a penalty while alignment still breaks ties. */
function pickNext(curEl: HTMLElement, dir: Dir, els: HTMLElement[]): HTMLElement | null {
  // Scoring lives in lib/tvNavGeometry so it can be tested without a DOM,
  // React, or jsdom (scripts/test-tv-nav.ts). This half owns only the element
  // -> rectangle mapping; keeping a second copy of the maths here is how the
  // two silently drift apart.
  const others = els.filter((el) => el !== curEl);
  const i = pickNextIndex(
    curEl.getBoundingClientRect(),
    others.map((el) => el.getBoundingClientRect()),
    dir,
  );
  return i < 0 ? null : others[i]!;
}

function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  } catch {
    el.scrollIntoView();
  }
}

interface TvNavContextValue {
  /** Push a Back handler; returns its unregister. Innermost push wins. */
  registerBack: (handler: () => void) => () => void;
}

const TvNavContext = createContext<TvNavContextValue>({
  registerBack: () => () => {},
});

/** Intercept the remote's Back while mounted (overlay open, player active).
 *  Pass null to deactivate. `handler` must be referentially stable (useCallback). */
export function useTvBack(handler: (() => void) | null): void {
  const { registerBack } = useContext(TvNavContext);
  useEffect(() => {
    if (!handler) return;
    return registerBack(handler);
  }, [handler, registerBack]);
}

export function TvNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const backStack = useRef<Array<() => void>>([]);

  const registerBack = useCallback((handler: () => void) => {
    backStack.current.push(handler);
    return () => {
      const i = backStack.current.lastIndexOf(handler);
      if (i !== -1) backStack.current.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const code = e.keyCode;
      const active = document.activeElement as HTMLElement | null;
      const inText = isTextInput(active);

      if (code === TVKEY.back || code === TVKEY.escape) {
        e.preventDefault();
        if (inText) {
          active.blur(); // close the on-screen keyboard, don't leave the page
          return;
        }
        const handler = backStack.current[backStack.current.length - 1];
        if (handler) {
          handler();
          return;
        }
        if (pathnameRef.current === "/tv") exitTvApp();
        else router.back();
        return;
      }

      const dir = DIR_BY_CODE[code];
      if (!dir) return;
      // In a text field, left/right move the caret; only up/down leave it.
      if (inText && (dir === "left" || dir === "right")) return;

      const els = candidates();
      if (els.length === 0) return;
      e.preventDefault();

      const curEl = active && els.includes(active) ? active : null;
      let next = curEl
        ? pickNext(curEl, dir, els)
        : (els.find((el) => el.hasAttribute("data-tv-autofocus")) ?? els[0]);

      // Vertical moves that land in a horizontal rail snap to that rail's FIRST
      // tile, not the geometrically-nearest one. Channel/poster rows read as
      // "scroll down = start of the next list from the left"; nearest-x picking
      // otherwise drops you onto the 2nd/3rd tile depending on where you came
      // from. Scoped to [data-tv-row] (TvRail) so grids keep cell-below nav.
      if (next && (dir === "up" || dir === "down")) {
        const row = next.closest<HTMLElement>("[data-tv-row]");
        if (row && !row.contains(curEl)) {
          const firstInRow = Array.from(
            row.querySelectorAll<HTMLElement>("[data-tv]"),
          ).find((el) => els.includes(el));
          if (firstInRow) next = firstInRow;
        }
      }
      if (next) focusEl(next);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // Seed focus on mount and after route changes, retrying briefly because the
  // rails/grids render from async fetches. Never steals focus that is already
  // on a candidate (e.g. an overlay that focused itself).
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const els = candidates();
      const active = document.activeElement as HTMLElement | null;
      if (active && els.includes(active)) {
        clearInterval(timer);
        return;
      }
      if (els.length > 0) {
        focusEl(els.find((el) => el.hasAttribute("data-tv-autofocus")) ?? els[0]);
        clearInterval(timer);
        return;
      }
      if (tries >= 20) clearInterval(timer); // ~4s — page has no focusables (player)
    }, 200);
    return () => clearInterval(timer);
  }, [pathname]);

  return <TvNavContext.Provider value={{ registerBack }}>{children}</TvNavContext.Provider>;
}
