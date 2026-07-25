"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { StreamCheck } from "@/lib/stream-verify";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";

/** Keep probing until at least this many sources verify working + non-busy. */
const TARGET_WORKING = 3;
const WATCH_POLL_MS = 20000;
const WATCH_MAX_ROUNDS = 15; // ~5 min, then stop to bound background load

/**
 * Consecutive failed probes before a source is reported "dead".
 *
 * These panels are connection-limited and demonstrably flap probe-to-probe (see
 * lib/vod-resolve — the resolver already refuses to trust a single verdict). With
 * no hysteresis, one unlucky probe flipped a source that was actively playing to
 * "dead", which is what made sources appear to vanish and come back on their own.
 * A source that has EVER verified is reported "busy" (try later) rather than dead
 * until it has failed this many rounds in a row.
 */
const DEAD_STREAK = 2;

/** Per-URL probe history, so a verdict is a trend rather than a coin flip. */
interface UrlMeta {
  failStreak: number;
  everOk: boolean;
}

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
  /** True while a MANUAL recheck round is in flight. Distinct from `loading`:
   *  previous verdicts stay on screen throughout, so the UI can show a per-row
   *  spinner instead of blanking every badge to "checking". */
  revalidating: boolean;
}

/** Update per-URL history from one probe round: reset the streak on success,
 *  extend it on failure, and remember that a URL has ever verified. */
function foldMeta(
  prev: Record<string, UrlMeta>,
  round: Record<string, StreamCheck>,
): Record<string, UrlMeta> {
  const next = { ...prev };
  for (const [url, r] of Object.entries(round)) {
    const cur = next[url] ?? { failStreak: 0, everOk: false };
    next[url] = r.ok
      ? { failStreak: 0, everOk: true }
      : { failStreak: cur.failStreak + 1, everOk: cur.everOk };
  }
  return next;
}

/**
 * Probes a set of source URLs via /api/stream-check and reports which
 * actually play. Re-probes whenever the set of URLs changes (keyed by content,
 * not array identity, so a re-render with an equivalent array won't refetch).
 * mode "live" (default) validates HLS playlists server-side; "vod" is a
 * reachability probe for progressive/remux/embed sources.
 *
 * `loading` is derived from whether `results` belong to the current URL set,
 * so the effect only ever calls setState after the fetch resolves — never
 * synchronously in the effect body.
 */
export function useStreamCheck(urls: string[], opts?: { mode?: "live" | "vod" }): UseStreamCheck {
  const mode = opts?.mode ?? "live";
  const [results, setResults] = useState<Record<string, StreamCheck>>({});
  // Probe history per URL — what makes a verdict a trend instead of a coin flip.
  const [meta, setMeta] = useState<Record<string, UrlMeta>>({});
  // The URL-set key that `results` were produced for. "" = nothing probed yet.
  const [checkedKey, setCheckedKey] = useState("");
  const [nonce, setNonce] = useState(0);
  // A manual recheck keeps the old verdicts visible; this flags the round instead.
  const [revalidating, setRevalidating] = useState(false);

  const key = urls.join("|");
  // `loading` = the FIRST round for this URL set only. A recheck must NOT set it:
  // callers freeze auto-failover while loading, and blanking every badge on every
  // recheck is exactly the flicker this hook used to cause.
  const loading = key !== "" && checkedKey !== key;

  useEffect(() => {
    if (urls.length === 0) return; // nothing to probe
    let active = true;
    (async () => {
      try {
        const res = await fetchWithDeadline("/api/stream-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls, mode }),
        }, DEADLINE.normal);
        const data: { results?: StreamCheck[] } = await res.json();
        if (!active) return;
        const map: Record<string, StreamCheck> = {};
        for (const r of data.results || []) map[r.url] = r;
        // MERGE, never replace: a URL absent from this round keeps its last known
        // verdict rather than reverting to "unknown" and churning the list.
        setResults((prev) => ({ ...prev, ...map }));
        setMeta((prev) => foldMeta(prev, map));
        setCheckedKey(key);
        setRevalidating(false);
      } catch {
        if (!active) return;
        // Probe failed — record the attempt so we stop showing "checking", but
        // KEEP prior verdicts: a failed round is our problem, not evidence that
        // every source died.
        setCheckedKey(key);
        setRevalidating(false);
      }
    })();
    return () => {
      active = false;
    };
    // `key`/`nonce`/`mode` capture the meaningful inputs; `urls` identity is excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, mode]);

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
      const res = await fetchWithDeadline("/api/stream-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: us, mode }),
      }, DEADLINE.normal);
      const data: { results?: StreamCheck[] } = await res.json();
      const map: Record<string, StreamCheck> = {};
      for (const r of data.results || []) map[r.url] = r;
      setResults((prev) => ({ ...prev, ...map }));
      setMeta((prev) => foldMeta(prev, map));
    } catch {}
  }, [mode]);

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
      const r = results[url];
      // Only claim "checking" when we have NOTHING to show for this URL yet —
      // otherwise the previous verdict stays visible while a round runs.
      if (!r) return current ? "unknown" : "checking";
      if (r.ok) return "working";
      if (r.busy) return "busy";
      // Failed — but hold the line until it fails consistently. A source that has
      // verified before is "busy" (come back to it) until DEAD_STREAK rounds agree.
      const m = meta[url];
      if (m && m.everOk && m.failStreak < DEAD_STREAK) return "busy";
      return "dead";
    },
    [results, current]
  );

  const workingCount = workingNow;

  const busyCount = current
    ? urls.reduce((n, u) => (results[u]?.busy ? n + 1 : n), 0)
    : 0;

  const recheck = useCallback(() => {
    // Deliberately does NOT clear results/checkedKey. Old verdicts stay on screen
    // (and the list keeps its membership) while the new round runs; `revalidating`
    // drives a per-row spinner instead of a blanket "checking" flash.
    setRevalidating(true);
    setNonce((n) => n + 1);
  }, []);

  return { results, loading, statusOf, workingCount, busyCount, recheck, revalidating };
}
