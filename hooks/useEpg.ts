"use client";

import { useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/localCache";
import { fetchJson, DEADLINE } from "@/lib/fetchDeadline";
import type { EpgProgram, EpgResponse } from "@/lib/types";

const CACHE_KEY = "tvspot_epg_v1";
const FRESH_MS = 15 * 60_000; // cache newer than this → paint it, skip the network
const REVALIDATE_MS = 15 * 60_000; // background refresh cadence while the guide is open
const RETRY_MS = [2_000, 5_000, 15_000, 60_000]; // backoff after a failed/empty fetch
// The full guide (107 channels × a week of programmes) is ~6MB in ONE response,
// and the 2019 Samsung webview (Tizen 5.0 ≈ Chromium 63, ~1GB) chokes on that
// single fetch+JSON.parse — EPG never loaded on the TV. Fetch in channel
// batches (~1MB each) so the guide loads there and fills in progressively; the
// big parse no longer spikes the main thread mid-playback either.
export const EPG_BATCH = 20;

export type EpgMap = Record<string, EpgProgram[]>;

/**
 * TV guide with stale-while-revalidate + retry semantics.
 *
 * The guide used to load with a single fire-and-forget fetch, so any transient
 * backend window (nightly API bounce, box under load, flaky mobile radio)
 * blanked every row to "No schedule data" until a lucky full reload. This hook:
 *  - paints instantly from the last-good localStorage copy,
 *  - retries failed fetches with backoff instead of giving up,
 *  - treats an EMPTY programmes map as a failure — the backend serves {} while
 *    its cache warms right after a restart, and that must never clobber a real
 *    guide,
 *  - revalidates when the app returns to the foreground / comes back online,
 *    and on a gentle interval while the page stays open.
 */
export function useEpg(channelNames: string[]) {
  const [epg, setEpg] = useState<EpgMap>({});
  // True once we have something to say: cached data painted, or the first
  // network attempt settled (even unsuccessfully). Gates the outage notice so
  // it never flashes during a normal first load.
  const [ready, setReady] = useState(false);
  const namesKey = channelNames.join(",");
  const st = useRef({ fetching: false, lastSuccess: 0, attempt: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });

  useEffect(() => {
    if (!namesKey) return;
    let cancelled = false;
    const state = st.current;

    // Drop desc + anything else the grid never renders: the raw response is
    // ~2MB (mostly descriptions); trimmed it fits comfortably in localStorage.
    const trim = (m: EpgResponse["programmes"]): EpgMap => {
      const out: EpgMap = {};
      for (const [name, progs] of Object.entries(m || {})) {
        out[name] = progs.map((p) => ({ title: p.title, start_utc: p.start_utc, stop_utc: p.stop_utc }));
      }
      return out;
    };

    const schedule = (ms: number) => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => void refresh(), ms);
    };

    const refresh = async () => {
      if (cancelled || state.fetching) return;
      state.fetching = true;
      try {
        const names = namesKey.split(",");
        // Seed from the last-good cache so a batch that fails this round never
        // erases a channel we already had — the write is always a union.
        const merged: EpgMap = { ...(readCache<EpgMap>(CACHE_KEY)?.data ?? {}) };
        let anyData = false;
        // Give up early when the network is plainly down. The batches run in
        // SEQUENCE, so without this a dead backend costs every batch its full
        // deadline before the guide reports anything (6 batches × 15s = 90s of
        // "Loading guide…", which reads as a hang even though it is bounded).
        // Two consecutive failures is enough evidence; the retry/backoff below
        // is what recovers, not grinding through the remaining batches.
        const MAX_CONSECUTIVE_FAILURES = 2;
        let consecutiveFailures = 0;
        for (let i = 0; i < names.length; i += EPG_BATCH) {
          if (cancelled) return;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
          const batch = names.slice(i, i + EPG_BATCH);
          // Per-batch DEADLINE (not an abort): one slow batch can't sink the
          // rest, and the total isn't capped by a single timer (the TV is slow,
          // batches are many). It has to be a real deadline because this loop is
          // SEQUENTIAL — on the TV, where AbortController cannot cancel a fetch,
          // a single batch that never settles wedges every remaining batch and
          // leaves "Loading guide…" up forever.
          try {
            const { ok, data } = await fetchJson<EpgResponse>(
              `/api/lounge/epg?channels=${encodeURIComponent(batch.join(","))}`,
              { credentials: "include" },
              DEADLINE.normal,
            );
            if (!ok || !data) { consecutiveFailures++; continue; }
            const map = trim(data.programmes);
            // An empty batch is a real answer from a warming backend, not a
            // network failure — don't let it trip the early exit.
            consecutiveFailures = 0;
            if (Object.keys(map).length === 0) continue;
            anyData = true;
            Object.assign(merged, map);
            // Progressive paint — rows fill in as batches land.
            if (!cancelled) {
              setEpg((prev) => ({ ...prev, ...map }));
              setReady(true);
            }
          } catch {
            // This batch failed (timeout/network) — skip it, keep the others.
            consecutiveFailures++;
          }
        }
        // Treat "every batch empty/failed" as a failure so we retry rather than
        // clobber a real guide with {} (the backend serves {} while warming).
        if (!anyData) throw new Error("EPG empty — backend warming / all batches failed");
        writeCache(CACHE_KEY, merged);
        state.lastSuccess = Date.now();
        state.attempt = 0;
        if (!cancelled) schedule(REVALIDATE_MS);
      } catch {
        // Keep whatever is on screen (cached or previous fetch) and retry.
        if (!cancelled) {
          setReady(true);
          const delay = RETRY_MS[Math.min(state.attempt, RETRY_MS.length - 1)];
          state.attempt += 1;
          schedule(delay);
        }
      } finally {
        state.fetching = false;
      }
    };

    // Last-good copy first, then revalidate only if it has aged out.
    const cached = readCache<EpgMap>(CACHE_KEY);
    if (cached && Object.keys(cached.data).length > 0) {
      setEpg(cached.data);
      setReady(true);
      state.lastSuccess = Date.now() - cached.ageMs;
      if (cached.ageMs > FRESH_MS) void refresh();
      else schedule(FRESH_MS - cached.ageMs);
    } else {
      void refresh();
    }

    // Returning to the app (or coming back online) after the guide aged → refresh.
    // Mobile browsers freeze background timers, so this is the reliable wake path.
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - state.lastSuccess > FRESH_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      cancelled = true;
      clearTimeout(state.timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [namesKey]);

  return { epg, ready };
}
