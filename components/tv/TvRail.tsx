"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Horizontal rail for the 10-foot UI. The row scrolls, but never shows a
 *  scrollbar — TvNav's scrollIntoView keeps the focused card centered. */
export default function TvRail({
  title,
  seeAllHref,
  children,
}: {
  title: string;
  /**
   * Renders a focusable "See all" tile at the END of the row, opening a full
   * grid of that row's category.
   *
   * Deliberately not a chip in the header: TvNav picks focus geometrically, so
   * a chip sitting above the cards is either left-aligned — and then intercepts
   * every downward move through the page, adding a stop per rail — or
   * right-aligned, where the cross-axis penalty makes it effectively
   * unreachable. End-of-row is also what the existing "Full guide" tile does.
   */
  seeAllHref?: string;
  children: ReactNode;
}) {
  return (
    <section className="py-2">
      <h2 className="px-16 text-2xl font-bold text-white mb-2">{title}</h2>
      {/* py-2 is the minimum that clears the focus cursor: the global
          [data-tv]:focus rule draws a 3px outline at 4px offset, so a focused
          card needs 7px of breathing room or it clips against the row edge. */}
      <div data-tv-row className="flex gap-5 overflow-x-auto px-16 py-2">
        {children}
        {seeAllHref && (
          <Link
            href={seeAllHref}
            data-tv
            /* Poster-shaped: seeAllHref is only ever set on VOD rails
               (TvProviderBrowse / TvCatalogTabPage), so this tile sits beside
               176×264 TvPosterCards and must match them. Channel/event rails
               use `trailing` instead and keep their own tile shape. */
            className="tv-card-shadow tv-channel-surface w-[176px] h-[264px] shrink-0 rounded-lg ring-1 ring-white/10 flex flex-col items-center justify-center gap-2 text-[#c7d5e0] focus:outline-none"
          >
            <ChevronRight className="w-8 h-8" />
            <span className="text-base font-medium">See all</span>
          </Link>
        )}
      </div>
    </section>
  );
}
