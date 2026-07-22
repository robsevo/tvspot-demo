"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { UPDATE_NOTICE_TEXT, updateNoticeActive } from "@/lib/updateNotice";

/**
 * Yellow "update in progress" banner, shown on mobile/web and on the TV.
 *
 * Rendered client-side only (mount guard): the notice depends on the current
 * clock, and rendering it during SSR would produce markup that disagrees with
 * the client the moment the window closes — a hydration mismatch.
 *
 * Re-checks on a timer so it disappears on its own when the window expires,
 * without needing a reload.
 *
 * `variant`:
 *   • "flow" (mobile/web) — a normal block at the top of <main>, so it pushes
 *     content down instead of covering the fixed TopBar's controls.
 *   • "tv" — a fixed strip along the BOTTOM. TV pages are full-bleed panes sized
 *     to the viewport, so an in-flow banner would overflow them; the bottom also
 *     keeps it clear of TvTopNav's tabs. Deliberately NOT focusable (no data-tv)
 *     — it's display-only and must not become a D-pad stop.
 */
export default function UpdateNotice({ variant = "flow" }: { variant?: "flow" | "tv" }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const tick = () => setActive(updateNoticeActive());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!active) return null;

  // Explicit hex, never Tailwind /opacity utilities: on the TV's Chromium 63
  // those compile to color-mix() and the declaration is dropped entirely, which
  // is exactly how a warning banner ends up invisible on the one screen that
  // most needs it.
  const isTv = variant === "tv";

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        isTv
          ? "fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 px-8 py-4"
          : "flex items-start gap-2 px-4 py-2.5"
      }
      style={{ backgroundColor: "#facc15", color: "#1a1a00" }}
    >
      <AlertTriangle
        className={isTv ? "w-7 h-7 shrink-0" : "w-4 h-4 shrink-0 mt-0.5"}
        strokeWidth={2.5}
      />
      <p className={isTv ? "text-2xl font-semibold" : "text-[13px] font-semibold leading-snug"}>
        {UPDATE_NOTICE_TEXT}
      </p>
    </div>
  );
}
