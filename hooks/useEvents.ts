"use client";

import { useState, useEffect } from "react";
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
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { payload, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setData(payload);
          setLoading(false);
          return;
        }
      }
    } catch {}

    setLoading(true);
    fetch(`/api/events?date=${day}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: EventsResponse | null) => {
        if (cancelled) return;
        setData(payload);
        if (payload) {
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ payload, ts: Date.now() })); } catch {}
        }
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [day]);

  return { data, loading };
}
