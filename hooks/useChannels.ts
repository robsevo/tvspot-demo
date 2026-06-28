"use client";

import { useState, useEffect, useCallback } from "react";
import { proxyFetch } from "@/lib/api";
import type { ChannelsResponse, Channel } from "@/lib/types";

const CACHE_KEY = "tvspot_channels";
const CACHE_TTL = 60000; // 60 seconds

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Check session cache
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          setChannels(data);
          setLoading(false);
          return;
        }
      }

      const data = await proxyFetch<ChannelsResponse>("/api/lounge/live-channels");
      setChannels(data.channels);
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data: data.channels, timestamp: Date.now() })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return { channels, loading, error, refetch: fetchChannels };
}