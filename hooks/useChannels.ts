"use client";

import { useState, useEffect, useCallback } from "react";
import { proxyFetch } from "@/lib/api";
import { readCache, writeCache } from "@/lib/localCache";
import type { ChannelsResponse, Channel } from "@/lib/types";

const CACHE_KEY = "tvspot_channels";
const CACHE_TTL = 60000; // 60 seconds — after this we revalidate in the background

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async (background = false) => {
    try {
      if (!background) setLoading(true);
      setError(null);
      const data = await proxyFetch<ChannelsResponse>("/api/lounge/live-channels");
      // Don't let a transient empty revalidation blank the channel grid.
      if (!background || (data.channels?.length ?? 0) > 0) {
        setChannels(data.channels);
      }
      if ((data.channels?.length ?? 0) > 0) writeCache(CACHE_KEY, data.channels);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
  }, [fetchChannels]);

  return { channels, loading, error, refetch: () => fetchChannels(false) };
}