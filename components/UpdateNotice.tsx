"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { UPDATE_NOTICE_TEXT, updateNoticeActive } from "@/lib/updateNotice";

/** Height of each shell's header, so the notice can sit flush UNDER it.
 *  Mobile: TopBar is `fixed` with a safe-area inset plus a 48px (h-12) bar.
 *  TV: TvTopNav is in flow at ~76px — the same constant the TV panes size
 *  themselves against with h-[calc(100vh-76px)]. */
const MOBILE_HEADER_TOP = "calc(env(safe-area-inset-top, 0px) + 48px)";
const TV_HEADER_TOP = "76px";

/**
 * Yellow "update in progress" banner, shown on mobile/web and on the TV.
 *
 * Positioned FIXED directly beneath the header on both. It has to be fixed
 * rather than in flow: TopBar is `fixed`, so an in-flow banner at the top of
 * <main> renders BEHIND it and is invisible, and the TV panes are sized to
 * exactly 100vh−76px, so an in-flow banner would push them past the viewport.
 * Sitting under the header also means it survives scrolling — a warning you
 * scroll past is a warning nobody reads.
 *
 * Rendered client-side only (mount guard): the notice depends on the current
 * clock, so rendering it during SSR would disagree with the client the moment
 * the window closes — a hydration mismatch. Re-checks on a timer so it clears
 * itself when the window expires, with no reload.
 *
 * Deliberately NOT focusable (no data-tv) — it must never become a D-pad stop.
 */
export default function UpdateNotice({ variant = "mobile" }: { variant?: "mobile" | "tv" }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const tick = () => setActive(updateNoticeActive());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!active) return null;

  const isTv = variant === "tv";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-0 right-0 flex items-center gap-3 ${
        isTv ? "z-40 px-16 py-4" : "z-30 px-4 py-2.5"
      }`}
      style={{
        top: isTv ? TV_HEADER_TOP : MOBILE_HEADER_TOP,
        // Explicit hex, never Tailwind /opacity utilities: those compile to
        // color-mix(), which the TV's Chromium 63 drops outright — exactly how a
        // warning ends up invisible on the screen that most needs it.
        backgroundColor: "#facc15",
        color: "#1a1a00",
      }}
    >
      <AlertTriangle
        className={isTv ? "w-7 h-7 shrink-0" : "w-4 h-4 shrink-0"}
        strokeWidth={2.5}
      />
      <p className={isTv ? "text-2xl font-semibold" : "text-[13px] font-semibold leading-snug"}>
        {UPDATE_NOTICE_TEXT}
      </p>
    </div>
  );
}
