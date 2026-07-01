"use client";

import { useState, useEffect } from "react";
import { readCache, writeCache } from "@/lib/localCache";
import type { EventsResponse } from "@/lib/leagues";

/** Local YYYYMMDD (user's timezone), so "today's games" matches the user's day. */
function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const CACHE_TTL = 60_000;

/**
 * Today's (or a given date's) games across the tracked leagues, from /api/events.
 * Session-cached for 60s so the home hero and the Events page don't double-fetch.
 */
export function useEvents(date?: string) {
  const day = date || localDateStr();
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `tvspot_events_${day}`;

    // Paint instantly from cache (survives eviction); revalidate only when stale.
    const cached = readCache<EventsResponse>(cacheKey);
    if (cached && cached.data) {
      setData(cached.data);
      setLoading(false);
      if (cached.ageMs <= CACHE_TTL) return () => { cancelled = true; };
    } else {
      setLoading(true);
    }

    fetch(`/api/events?date=${day}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: EventsResponse | null) => {
        if (cancelled) return;
        if (payload) {
          setData(payload);
          writeCache(cacheKey, payload);
        } else if (!cached) {
          setData(null);
        }
      })
      .catch(() => { if (!cancelled && !cached) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [day]);

  return { data, loading };
}
