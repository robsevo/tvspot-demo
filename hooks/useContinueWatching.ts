"use client";

import { useState, useEffect, useCallback } from "react";
import type { ContinueWatchingItem } from "@/lib/types";

const STORAGE_KEY = "tvspot_continue_watching";
const MAX_ITEMS = 50;

export function useContinueWatching() {
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setItems(JSON.parse(stored));
    } catch {}
  }, []);

  const persist = (newItems: ContinueWatchingItem[]) => {
    setItems(newItems);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newItems));
  };

  const updateProgress = useCallback(
    (item: ContinueWatchingItem) => {
      const filtered = items.filter(
        (i) => !(i.tmdbId === item.tmdbId && i.kind === item.kind && i.season === item.season && i.episode === item.episode)
      );
      const updated = [{ ...item, updatedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      persist(updated);
    },
    [items]
  );

  const remove = useCallback(
    (tmdbId: number, kind: "movie" | "series", season?: number, episode?: number) => {
      persist(
        items.filter(
          (i) => !(i.tmdbId === tmdbId && i.kind === kind && i.season === season && i.episode === episode)
        )
      );
    },
    [items]
  );

  return { items, updateProgress, remove };
}