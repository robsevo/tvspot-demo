"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { StreamCheck } from "@/lib/stream-verify";
import { groupByHost } from "@/lib/liveSources";
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
 * until it has failed this many rounds in a row — as is any source whose failure
 * was `retryable` (timeout / connection limit), even on its first sighting.
 *
 * 3, not 2. Repeating one channel's probe three times over ~10s produced
 * verdict sequences like `dead(timeout) | ok | ok` and `ok | dead(500) |
 * dead(403)` on sources that were fine — two rounds is simply not enough
 * evidence on panels that flap this hard, and calling one dead puts an ✗ on a
 * source that plays. Permanent failures (401/403/400) are unaffected: they are
 * neither `retryable` nor previously-ok, so they still badge dead on sight.
 */
const DEAD_STREAK = 3;

/**
 * Max simultaneous /api/stream-check requests per probe pass.
 *
 * A pass is sharded ONE REQUEST PER UPSTREAM PANEL (see runProbe) and a channel
 * spreads over as many as 13 panels, so this has to clear that in ONE wave. At 8
 * a 12-panel channel needed two waves and the pass took 9.4s end to end where
 * the single unsharded request took 6.2s — first verdicts were 10x faster but
 * the pass as a whole got slower, which is the wrong trade for anything gated on
 * completion.
 *
 * It costs no extra load upstream: the old single request already fanned out
 * with an unbounded Promise.all across every panel bucket, so 16 concurrent
 * shards is strictly fewer simultaneous connections to the relay than before —
 * just spread over more (short) function invocations.
 */
const PROBE_CONCURRENCY = 16;

/** Per-URL probe history, so a verdict is a trend rather than a coin flip. */
interface UrlMeta {
  failStreak: number;
  everOk: boolean;
}

export type SourceStatus = "checking" | "working" | "dead" | "busy" | "unknown";

interface UseStreamCheck {
  /** Verdict per source URL, for the currently-probed set. */
  results: Record<string, StreamCheck>;
  /** True while the FIRST probe pass for this URL set is still running. */
  loading: boolean;
  /**
   * LIVE status for one URL — updates as each shard lands.
   *
   * For the failover/auto-pick logic ONLY. Drive a badge off this and the UI
   * flickers: verdicts now arrive per panel, so a source's chip would change
   * up to a dozen times while one pass runs. Use `badgeOf` for anything the
   * user looks at.
   */
  statusOf: (url: string) => SourceStatus;
  /**
   * SETTLED status for one URL — what a chip should show.
   *
   * Holds every source at "checking" until the whole pass has finished, so the
   * badges reveal together, once, instead of flickering in one panel at a time.
   * Playback does NOT wait for this (see statusOf) — the point is that the auto-
   * pick reacts to the first verdict while the list the user is reading stays
   * still.
   */
  badgeOf: (url: string) => SourceStatus;
  /** How many of `urls` have verified as working. */
  workingCount: number;
  /** How many are BUSY (connection-limited) — not dead, just momentarily in use. */
  busyCount: number;
  /** Re-run the probe (e.g. a manual "recheck" button). */
  recheck: () => void;
  /** True while a MANUAL recheck pass is in flight. Distinct from `loading`:
   *  previous verdicts stay on screen throughout, so the UI can show a per-row
   *  spinner instead of blanking every badge to "checking". */
  revalidating: boolean;
}

interface Options {
  mode?: "live" | "vod";
  /**
   * The source currently ON SCREEN. Excluded from background re-probes.
   *
   * Not a micro-optimisation: every source URL is a relay.example.com wrapper
   * around a connection-limited panel, and several panels advertise
   * max_connections=1. Re-probing the stream you are watching asks its panel for
   * a SECOND slot — measured 456 "connection limit" responses across four panels
   * in the lineup — so the watchdog was manufacturing the stalls it existed to
   * detect. Playback is also better evidence than any probe could be.
   */
  skip?: string | null;
}

/** Update per-URL history from one probe pass: reset the streak on success,
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
 * VERDICTS ARRIVE INCREMENTALLY. See runProbe for why that matters.
 */
export function useStreamCheck(urls: string[], opts?: Options): UseStreamCheck {
  const mode = opts?.mode ?? "live";
  const skip = opts?.skip ?? null;
  const [results, setResults] = useState<Record<string, StreamCheck>>({});
  // Probe history per URL — what makes a verdict a trend instead of a coin flip.
  const [meta, setMeta] = useState<Record<string, UrlMeta>>({});
  // The URL-set key that a completed pass covered. "" = nothing probed yet.
  const [checkedKey, setCheckedKey] = useState("");
  const [nonce, setNonce] = useState(0);
  // A manual recheck keeps the old verdicts visible; this flags the pass instead.
  const [revalidating, setRevalidating] = useState(false);

  const key = urls.join("|");
  // `loading` = the FIRST pass for this URL set only. A recheck must NOT set it:
  // callers use it to gate one-shot work, and blanking every badge on every
  // recheck is exactly the flicker this hook used to cause.
  const loading = key !== "" && checkedKey !== key;

  /** Merge one shard's verdicts into state. Called as each shard lands. */
  const absorb = useCallback((batch: StreamCheck[]) => {
    if (batch.length === 0) return;
    const map: Record<string, StreamCheck> = {};
    for (const r of batch) map[r.url] = r;
    // MERGE, never replace: a URL absent from this pass keeps its last known
    // verdict rather than reverting to "unknown" and churning the list.
    setResults((prev) => ({ ...prev, ...map }));
    setMeta((prev) => foldMeta(prev, map));
  }, []);

  /**
   * Run one probe pass over `list`, surfacing each shard's verdicts the moment
   * they land rather than at the end.
   *
   * SHARDED PER UPSTREAM PANEL. The server serialises probes per panel inside a
   * single request (connection limits — see lib/stream-verify), so one request
   * carrying every source meant the whole pass finished no sooner than the
   * slowest panel's whole chain. Measured on production: a TSN pass took
   * 6002ms EVERY time because one panel black-holes and burns the full 6s
   * budget, while the verdicts for the four working panels were already known
   * at ~400ms. 24/7 Rick and Morty took 12.6s for the same reason — two
   * timeouts serialised on one panel.
   *
   * Nothing could be shown, ranked or auto-picked until that finished, which is
   * what made tuning in and Recheck feel dead. One request per panel keeps the
   * per-panel serialisation intact (a shard is one panel) while letting a fast
   * panel's verdicts land in ~400ms regardless of what the slow one is doing.
   */
  const runProbe = useCallback(
    async (list: string[], alive: () => boolean) => {
      if (list.length === 0) return;
      // VOD sources are probed concurrently server-side already (no per-panel
      // chain to break up), and the set is capped small — one request is right.
      const shards = mode === "vod" ? [list] : groupByHost(list);
      let next = 0;
      const worker = async () => {
        while (next < shards.length) {
          const shard = shards[next++];
          try {
            const res = await fetchWithDeadline(
              "/api/stream-check",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ urls: shard, mode }),
              },
              DEADLINE.normal,
            );
            const data: { results?: StreamCheck[] } = await res.json();
            if (!alive()) return;
            absorb(data.results || []);
          } catch {
            // This shard's panel is our problem, not evidence its sources died:
            // leave their prior verdicts (or "checking") alone.
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PROBE_CONCURRENCY, shards.length) }, worker),
      );
    },
    [mode, absorb],
  );

  useEffect(() => {
    if (urls.length === 0) return;
    let active = true;
    (async () => {
      await runProbe(urls, () => active);
      if (!active) return;
      // Pass complete — whatever landed is what we know.
      setCheckedKey(key);
      setRevalidating(false);
    })();
    return () => {
      active = false;
    };
    // `key`/`nonce`/`mode` capture the meaningful inputs; `urls` identity is excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, runProbe]);

  const current = checkedKey === key;

  const workingNow = current ? urls.reduce((n, u) => (results[u]?.ok ? n + 1 : n), 0) : 0;

  // Layer 2 watcher: soft-reprobe (merge results, NO loading flash) so a busy
  // source that frees up — or a dead one that recovers — is detected and the
  // player's auto-pick promotes it. Runs only while we're short of TARGET_WORKING
  // and there are non-working candidates worth re-checking; bounded to avoid
  // indefinite background load.
  const urlsRef = useRef(urls);
  useEffect(() => { urlsRef.current = urls; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const skipRef = useRef(skip);
  skipRef.current = skip;

  const softReprobe = useCallback(async () => {
    // Only the sources whose verdict could still IMPROVE, and never the one on
    // screen (see Options.skip). Re-verifying a source we already know works
    // costs a slot on its panel and can tell us nothing new; that made the
    // watchdog re-open ~13 relay connections every 20s for five minutes,
    // against the same box that is carrying the video.
    const candidates = urlsRef.current.filter(
      (u) => u !== skipRef.current && !resultsRef.current[u]?.ok,
    );
    if (candidates.length === 0) return;
    await runProbe(candidates, () => true);
  }, [runProbe]);

  useEffect(() => {
    if (!current || workingNow >= TARGET_WORKING) return;
    const hasRetryable = urls.some((u) => u !== skip && results[u] && !results[u].ok);
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
      // otherwise the previous verdict stays visible while a pass runs.
      if (!r) return current ? "unknown" : "checking";
      if (r.ok) return "working";
      if (r.busy) return "busy";
      // Failed — but hold the line until it fails CONSISTENTLY. Two kinds of
      // failure earn that patience:
      //   • a source that has verified before (the panels flap probe-to-probe);
      //   • a `retryable` failure — a timeout, which measures our budget rather
      //     than the source. 81.31.194.66 needs 11s cold and carries 89 of our
      //     sources; at a 6s budget its first verdict was always a false "dead",
      //     and the first pass is the one that decides what plays.
      const m = meta[url];
      const streak = m?.failStreak ?? 1;
      if (streak < DEAD_STREAK && (m?.everOk || r.retryable)) return "busy";
      return "dead";
    },
    [results, meta, current],
  );

  // Badges wait for the pass; playback does not. `loading` is the first pass for
  // this URL set — during it every chip reads "checking" and nothing moves. A
  // manual recheck deliberately leaves `loading` false, so previous verdicts stay
  // on screen (blanking them on every press was an older flicker bug).
  const badgeOf = useCallback(
    (url: string): SourceStatus => (loading ? "checking" : statusOf(url)),
    [loading, statusOf],
  );

  const workingCount = workingNow;

  const busyCount = useMemo(
    () => (current ? urls.filter((u) => statusOf(u) === "busy").length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, key, statusOf],
  );

  const recheck = useCallback(() => {
    // Deliberately does NOT clear results/checkedKey. Old verdicts stay on screen
    // (and the list keeps its membership) while the new pass runs; `revalidating`
    // drives a per-row spinner instead of a blanket "checking" flash.
    setRevalidating(true);
    setNonce((n) => n + 1);
  }, []);

  return { results, loading, statusOf, badgeOf, workingCount, busyCount, recheck, revalidating };
}
