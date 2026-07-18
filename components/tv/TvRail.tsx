"use client";

import type { ReactNode } from "react";

/** Horizontal rail for the 10-foot UI. The row scrolls, but never shows a
 *  scrollbar — TvNav's scrollIntoView keeps the focused card centered. */
export default function TvRail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-4">
      <h2 className="px-16 text-2xl font-bold text-white mb-4">{title}</h2>
      <div className="flex gap-5 overflow-x-auto px-16 py-2">{children}</div>
    </section>
  );
}
