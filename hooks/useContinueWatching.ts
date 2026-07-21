"use client";

import { useState, useEffect, useCallback } from "react";
import type { ContinueWatchingItem } from "@/lib/types";

const STORAGE_KEY = "tvspot_continue_watching";
const MAX_ITEMS = 50;

/** One row per SHOW, keeping the most-recently-watched entry. A series used to
 *  accumulate a separate Continue Watching row for every episode you touched;
 *  the rail should carry one tile per show at the episode you're actually on. */
function dedupeByTitle(list: ContinueWatchingItem[]): ContinueWatchingItem[] {
  const seen = new Set<string>();
  const out: ContinueWatchingItem[] = [];
  // Newest first, so the first entry seen for a title is the one we keep.
  for (const i of [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
    const k = `${i.kind}:${i.tmdbId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out;
}

export function useContinueWatching() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Collapse any legacy multi-episode rows on load, so existing data gets the
      // one-per-show treatment without waiting for a re-watch.
      if (stored) setItems(dedupeByTitle(JSON.parse(stored)));
    } catch {}
  }, []);

  const persist = (newItems: ContinueWatchingItem[]) => {
    setItems(newItems);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newItems));
  };

  const updateProgress = useCallback(
    (item: ContinueWatchingItem) => {
      // Drop EVERY prior row for this title (any season/episode), so a series
      // keeps a single row that advances to the latest episode watched.
      const filtered = items.filter(
        (i) => !(i.tmdbId === item.tmdbId && i.kind === item.kind),
      );
      const updated = [{ ...item, updatedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      persist(updated);
    },
    [items]
  );

  const remove = useCallback(
    // Episode-agnostic: there is only one row per title now, so finishing (or
    // dismissing) any episode clears the show's row.
    (tmdbId: number, kind: "movie" | "series") => {
      persist(items.filter((i) => !(i.tmdbId === tmdbId && i.kind === kind)));
    },
    [items]
  );

  return { items, updateProgress, remove };
}