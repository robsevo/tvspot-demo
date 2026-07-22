"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { proxyFetch, HttpError } from "@/lib/api";
import { readCache, writeCache } from "@/lib/localCache";
import type { ChannelsResponse, Channel } from "@/lib/types";

const CACHE_KEY = "tvspot_channels";
const CACHE_TTL = 60000; // 60 seconds — after this we revalidate in the background

// Backoff after a failed/warming fetch. The backend answers 503
// `channels_warming` while its lineup rebuilds after a restart (it used to
// simply block, which is what left the TV on an empty grid for minutes). A 503
// explicitly means "come back shortly", so retrying is the point — without it
// the app keeps its stale list and never picks up the real one until a reload.
const RETRY_MS = [2_000, 5_000, 15_000, 45_000];

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Retry bookkeeping in a ref, so scheduling never re-renders or re-subscribes.
  const retry = useRef<{
    attempt: number;
    timer?: ReturnType<typeof setTimeout>;
    cancelled: boolean;
  }>({ attempt: 0, cancelled: false });

  const fetchChannels = useCallback(async (background = false) => {
    try {
      if (!background) setLoading(true);
      setError(null);
      const data = await proxyFetch<ChannelsResponse>("/api/lounge/live-channels");
      // Don't let a transient empty revalidation blank the channel grid.
      if (!background || (data.channels?.length ?? 0) > 0) {
        setChannels(data.channels);
      }
      if ((data.channels?.length ?? 0) > 0) {
        writeCache(CACHE_KEY, data.channels);
        retry.current.attempt = 0; // real data — reset the backoff
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
      // A warming backend (503) or a transient network failure is recoverable:
      // keep what's on screen and try again with backoff. Anything the server
      // calls a client error (4xx) won't fix itself, so don't spin on it.
      const status = err instanceof HttpError ? err.status : 0;
      if ((status === 0 || status >= 500) && !retry.current.cancelled) {
        const wait = RETRY_MS[Math.min(retry.current.attempt, RETRY_MS.length - 1)];
        retry.current.attempt += 1;
        clearTimeout(retry.current.timer);
        retry.current.timer = setTimeout(() => {
          if (!retry.current.cancelled) fetchChannels(true);
        }, wait);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const state = retry.current;
    state.cancelled = false;
    // Paint instantly from the last-known list (survives tab eviction), then only
    // hit the network if it's stale.
    const cached = readCache<Channel[]>(CACHE_KEY);
    if (cached && cached.data.length > 0) {
      setChannels(cached.data);
      setLoading(false);
      if (cached.ageMs > CACHE_TTL) fetchChannels(true);
    } else {
      fetchChannels(false);
    }
    return () => {
      state.cancelled = true;
      clearTimeout(state.timer);
    };
  }, [fetchChannels]);

  return { channels, loading, error, refetch: () => fetchChannels(false) };
}
