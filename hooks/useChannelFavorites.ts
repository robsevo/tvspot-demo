"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "tvspot_channel_favs";

/** Favorite live channels (by channel name), persisted like My List — the
 *  Live TV guide's "Favorites" category and the channel panel's toggle. */
export function useChannelFavorites() {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setNames(JSON.parse(stored));
    } catch {}
  }, []);

  const persist = (next: string[]) => {
    setNames(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };

  const toggle = useCallback(
    (name: string) => {
      persist(names.includes(name) ? names.filter((n) => n !== name) : [name, ...names]);
    },
    [names],
  );

  const isFavorite = useCallback((name: string) => names.includes(name), [names]);

  return { names, toggle, isFavorite };
}
