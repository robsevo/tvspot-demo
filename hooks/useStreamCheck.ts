"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { StreamCheck } from "@/lib/stream-verify";

/** Keep probing until at least this many sources verify working + non-busy. */
const TARGET_WORKING = 3;
const WATCH_POLL_MS = 20000;
const WATCH_MAX_ROUNDS = 15; // ~5 min, then stop to bound background load

export type SourceStatus = "checking" | "working" | "dead" | "busy" | "unknown";

interface UseStreamCheck {
  /** Verdict per source URL, for the currently-probed set. */
  results: Record<string, StreamCheck>;
  /** True while a probe round is in flight. */
  loading: boolean;
  /** Status for one URL, accounting for the in-flight state. */
  statusOf: (url: string) => SourceStatus;
  /** How many of `urls` have verified as working. */
  workingCount: number;
  /** How many are BUSY (connection-limited) — not dead, just momentarily in use. */
  busyCount: number;
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

  const workingNow = current ? urls.reduce((n, u) => (results[u]?.ok ? n + 1 : n), 0) : 0;

  // Layer 2 watcher: soft-reprobe (merge results, NO loading flash) so a busy
  // source that frees up — or a dead one that recovers — is detected and the
  // player's auto-pick promotes it. Runs only while we're short of TARGET_WORKING
  // and there are non-working candidates worth re-checking; bounded to avoid
  // indefinite background load.
  const urlsRef = useRef(urls);
  useEffect(() => { urlsRef.current = urls; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const softReprobe = useCallback(async () => {
    const us = urlsRef.current;
    if (us.length === 0) return;
    try {
      const res = await fetch("/api/stream-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: us }),
      });
      const data: { results?: StreamCheck[] } = await res.json();
      const map: Record<string, StreamCheck> = {};
      for (const r of data.results || []) map[r.url] = r;
      setResults((prev) => ({ ...prev, ...map }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!current || workingNow >= TARGET_WORKING) return;
    const hasRetryable = urls.some((u) => results[u] && !results[u].ok);
    if (!hasRetryable) return;
    let rounds = 0;
    const id = setInterval(() => {
      rounds += 1;
      softReprobe();
      if (rounds >= WATCH_MAX_ROUNDS) clearInterval(id);
    }, WATCH_POLL_MS);
    return () => clearInterval(id);
    // Re-arm when the working count changes (progress toward target) or the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, key, workingNow, softReprobe]);

  const statusOf = useCallback(
    (url: string): SourceStatus => {
      if (!current) return "checking";
      const r = results[url];
      // "busy" (connection-limited) is distinct from dead — kept as a candidate,
      // but de-prioritized vs a working non-busy source when auto-picking.
      if (r) return r.ok ? "working" : r.busy ? "busy" : "dead";
      return "unknown";
    },
    [results, current]
  );

  const workingCount = workingNow;

  const busyCount = current
    ? urls.reduce((n, u) => (results[u]?.busy ? n + 1 : n), 0)
    : 0;

  const recheck = useCallback(() => {
    setResults({});
    setCheckedKey(""); // force the loading state until the new probe resolves
    setNonce((n) => n + 1);
  }, []);

  return { results, loading, statusOf, workingCount, busyCount, recheck };
}
