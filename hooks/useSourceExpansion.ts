"use client";

import { useState, useEffect, useRef } from "react";
import { channelSlug } from "@/lib/sources";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";

/**
 * Fetches additional verified source URLs for a channel from /api/extra-sources
 * when `enabled` is true. Fires at most once per channel session.
 *
 * `enabled` should be computed by the caller after the initial probe settles
 * (e.g. `!loading && workingCount < 2`). The caller owns the timing; this hook
 * owns the fetch, deduplication, and AbortController cleanup.
 *
 * Returns the extra URLs to merge into the probe pool.
 */
export function useSourceExpansion(
  channelName: string,
  probedUrls: string[],
  enabled: boolean,
): string[] {
  const slug = channelSlug(channelName);
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const hasExpanded = useRef(false);
  const prevSlug = useRef(slug);

  // Reset on channel change.
  useEffect(() => {
    if (slug === prevSlug.current) return;
    prevSlug.current = slug;
    hasExpanded.current = false;
    setExtraUrls([]);
  }, [slug]);

  useEffect(() => {
    if (!enabled) return;
    if (hasExpanded.current) return;
    if (probedUrls.length === 0) return;

    hasExpanded.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetchWithDeadline("/api/extra-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, exclude: probedUrls }),
          signal: controller.signal,
        }, DEADLINE.normal);
        if (!res.ok) return;
        const data: { urls?: string[] } = await res.json();
        if (Array.isArray(data.urls) && data.urls.length > 0) {
          setExtraUrls(data.urls);
        }
      } catch {
        // Aborted (channel changed) or network error — silently ignore.
      }
    })();

    return () => controller.abort();
    // probedUrls identity is excluded intentionally — content is captured via
    // the exclude list passed in the request body above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, slug]);

  return extraUrls;
}
