"use client";

import { useState, useEffect } from "react";
import { readCache, writeCache } from "@/lib/localCache";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";
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
/**
 * Why this exists rather than collapsing everything to `data === null`:
 * "you are signed out" and "there are no games today" are different facts, and
 * rendering them identically is what made a 401 look like an upstream outage for
 * days. `null` data with `error === "unauthorized"` is a session problem the user
 * can act on; `null` data with `error === null` is a genuinely empty schedule.
 */
export type EventsError = "unauthorized" | "failed" | null;

export function useEvents(date?: string) {
  const day = date || localDateStr();
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EventsError>(null);

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

    // Deadlined: this gates `loading` via .finally(), which never runs if the
    // request never settles — the TV's failure mode, not an exception.
    // credentials: "include" is REQUIRED — /api/events authenticates inside the
    // route handler (reads SESSION_COOKIE, 401s without it), and this call
    // passed `{}`, so the cookie was never attached. It is the same convention
    // every other authenticated fetch here already follows: useEpg.ts:115 and
    // lib/api.ts:35,61 all pass it; this hook was the only outlier.
    //
    // Why it presented as an upstream problem: the .then() below maps any
    // non-ok response to null, and the UI renders null as "No games on today".
    // So a 401 looked identical to an empty schedule — while ESPN was in fact
    // returning 11 MLS games for the date being asked about.
    fetchWithDeadline(`/api/events?date=${day}`, { credentials: "include" }, DEADLINE.normal)
      .then(async (r): Promise<{ payload: EventsResponse | null; err: EventsError }> => {
        if (r.ok) return { payload: (await r.json()) as EventsResponse, err: null };
        // A 401/403 is a SESSION problem, never an empty schedule. Keeping them
        // distinct is the whole point — mapping both to null is what rendered
        // "No games on today" over a signed-out session and sent the last
        // investigation upstream to ESPN, which was returning games the whole time.
        return { payload: null, err: r.status === 401 || r.status === 403 ? "unauthorized" : "failed" };
      })
      .then(({ payload, err }) => {
        if (cancelled) return;
        setError(err);
        if (payload) {
          setData(payload);
          writeCache(cacheKey, payload);
        } else if (!cached) {
          setData(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("failed");
        if (!cached) setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [day]);

  return { data, loading, error };
}
