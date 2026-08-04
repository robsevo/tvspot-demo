"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Horizontal rail for the 10-foot UI. The row scrolls, but never shows a
 *  scrollbar — TvNav's scrollIntoView keeps the focused card centered. */
export default function TvRail({
  title,
  seeAllHref,
  seeAllFirst,
  leading,
  children,
}: {
  title: string;
  /**
   * Renders a focusable "See all" tile in the row, opening a full grid of that
   * row's category. End of the row by default; see seeAllFirst.
   *
   * Deliberately not a chip in the header: TvNav picks focus geometrically, so
   * a chip sitting above the cards is either left-aligned — and then intercepts
   * every downward move through the page, adding a stop per rail — or
   * right-aligned, where the cross-axis penalty makes it effectively
   * unreachable.
   */
  seeAllHref?: string;
  /**
   * Put that tile at the START of the row instead of the end.
   *
   * Used by the provider browse (/tv/vod), where the Movies and Series rails
   * are a truncated slice of a much larger catalog — there, "see everything" is
   * a primary action rather than an afterthought, and burying it past 18
   * posters means holding Right to reach it. The trending/genre rails on the
   * browse tabs keep it at the end, where the row really is the whole story.
   */
  seeAllFirst?: boolean;
  /**
   * Focusable tile pinned at the START of the row, before the content (the
   * "Full guide" entry on Live TV).
   *
   * Being first has a real navigation consequence, and it's the wanted one:
   * TvNav snaps a vertical move into a rail onto that rail's FIRST tile, so
   * arriving from above lands on this tile rather than on a channel.
   */
  leading?: ReactNode;
  children: ReactNode;
}) {
  /* Poster-shaped: seeAllHref is only ever set on VOD rails (TvProviderBrowse /
     TvCatalogTabPage), so this tile sits beside 280×420 TvPosterCards and must
     match their footprint. Channel/event rails use `leading`/`trailing` instead
     and keep their own shape.

     Styled as a quiet end-cap rather than a card: at poster height the bright
     blue-steel channel surface read as a big empty slab next to real artwork. A
     flat dark fill with a hairline edge and a ringed chevron says "more this
     way" without competing with the posters. Explicit rgba — Tailwind /opacity
     utilities compile to color-mix(), which the TV's Chromium 63 drops.

     Built once and placed at either end, so the two positions can never drift
     apart visually. */
  const seeAllTile = seeAllHref ? (
    <Link
      href={seeAllHref}
      data-tv
      className="tv-card-shadow w-[280px] h-[420px] shrink-0 rounded-lg flex flex-col items-center justify-center gap-4 focus:outline-none"
      style={{
        backgroundColor: "#121a24",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span
        className="flex items-center justify-center w-16 h-16 rounded-full"
        style={{ border: "2px solid rgba(255,255,255,0.30)" }}
      >
        <ChevronRight className="w-8 h-8" style={{ color: "#e6eef5" }} />
      </span>
      <span className="text-base font-medium" style={{ color: "#c7d5e0" }}>
        See all
      </span>
    </Link>
  ) : null;

  return (
    <section className="py-2">
      <h2 className="px-16 text-2xl font-bold text-white mb-2">{title}</h2>
      {/* py-2 is the minimum that clears the focus cursor: the global
          [data-tv]:focus rule draws a 3px outline at 4px offset, so a focused
          card needs 7px of breathing room or it clips against the row edge. */}
      <div data-tv-row className="flex gap-5 overflow-x-auto px-16 py-2">
        {leading}
        {seeAllFirst && seeAllTile}
        {children}
        {!seeAllFirst && seeAllTile}
      </div>
    </section>
  );
}
