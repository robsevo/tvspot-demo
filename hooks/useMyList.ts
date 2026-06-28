"use client";

import { useState, useEffect, useCallback } from "react";
import type { MyListItem } from "@/lib/types";

const STORAGE_KEY = "tvspot_mylist";

export function useMyList() {
  const [items, setItems] = useState<MyListItem[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setItems(JSON.parse(stored));
    } catch {}
  }, []);

  const persist = (newItems: MyListItem[]) => {
    setItems(newItems);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newItems));
  };

  const add = useCallback(
    (item: MyListItem) => {
      const exists = items.some((i) => i.tmdbId === item.tmdbId && i.kind === item.kind);
      if (!exists) {
        persist([item, ...items]);
      }
    },
    [items]
  );

  const remove = useCallback(
    (tmdbId: number, kind: "movie" | "series") => {
      persist(items.filter((i) => !(i.tmdbId === tmdbId && i.kind === kind)));
    },
    [items]
  );

  const isInList = useCallback(
    (tmdbId: number, kind: "movie" | "series") => {
      return items.some((i) => i.tmdbId === tmdbId && i.kind === kind);
    },
    [items]
  );

  return { items, add, remove, isInList };
}