"use client";

import { useState, useEffect, useCallback } from "react";
import type { StreamCheck } from "@/lib/stream-verify";

export type SourceStatus = "checking" | "working" | "dead" | "unknown";

interface UseStreamCheck {
  /** Verdict per source URL, for the currently-probed set. */
  results: Record<string, StreamCheck>;
  /** True while a probe round is in flight. */
  loading: boolean;
  /** Status for one URL, accounting for the in-flight state. */
  statusOf: (url: string) => SourceStatus;
  /** How many of `urls` have verified as working. */
  workingCount: number;
  /** Re-run the probe (e.g. a manual "recheck" button). */
  recheck: () => void;
}

/**
 * Probes a set of live-TV source URLs via /api/stream-check and reports which
 * actually play. Re-probes whenever the set of URLs changes (keyed by content,
 * not array identity, so a re-render with an equivalent array won't refetch).
 *
 * `loading` is derived from whether `results` belong to the current URL set,
 * so the effect only ever calls setState after the fetch resolves — never
 * synchronously in the effect body.
 */
export function useStreamCheck(urls: string[]): UseStreamCheck {
  const [results, setResults] = useState<Record<string, StreamCheck>>({});
  // The URL-set key that `results` were produced for. "" = nothing probed yet.
  const [checkedKey, setCheckedKey] = useState("");
  const [nonce, setNonce] = useState(0);

  const key = urls.join("|");
  const loading = key !== "" && checkedKey !== key;

  useEffect(() => {
    if (urls.length === 0) return; // nothing to probe
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/stream-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });
        const data: { results?: StreamCheck[] } = await res.json();
        if (!active) return;
        const map: Record<string, StreamCheck> = {};
        for (const r of data.results || []) map[r.url] = r;
        setResults(map);
        setCheckedKey(key);
      } catch {
        if (!active) return;
        // Probe failed — record the attempt so we stop showing "checking",
        // but surface no verdicts rather than false negatives.
        setResults({});
        setCheckedKey(key);
      }
    })();
    return () => {
      active = false;
    };
    // `key`/`nonce` capture the meaningful inputs; `urls` identity is excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const current = checkedKey === key;

  const statusOf = useCallback(
    (url: string): SourceStatus => {
      if (!current) return "checking";
      const r = results[url];
      if (r) return r.ok ? "working" : "dead";
      return "unknown";
    },
    [results, current]
  );

  const workingCount = current
    ? urls.reduce((n, u) => (results[u]?.ok ? n + 1 : n), 0)
    : 0;

  const recheck = useCallback(() => {
    setResults({});
    setCheckedKey(""); // force the loading state until the new probe resolves
    setNonce((n) => n + 1);
  }, []);

  return { results, loading, statusOf, workingCount, recheck };
}
