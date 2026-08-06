"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useStreamCheck, type SourceStatus } from "@/hooks/useStreamCheck";
import { useFirstFrameDeadline } from "@/hooks/useFirstFrameDeadline";
import { channelSlug } from "@/lib/sources";
import { appendSources, channelSourceList } from "@/lib/liveSources";
import { previewSourceFor } from "@/lib/previewHandoff";
import {
  recordFailure, isCondemned, byOldestFailure, type FailureMap,
} from "@/lib/sourceFailover";
import { notePlayback, reputationTable } from "@/lib/sourceReputation";
import {
  isDead as isDeadPure, rankSources, stickHolds, orderForDisplay,
  type SelectionContext,
} from "@/lib/sourceSelection";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";
import type { Channel } from "@/lib/types";

/**
 * The whole live source pipeline: build the candidate list, probe it, pick what
 * plays, fail over, and remember what worked.
 *
 * WHY IT'S A HOOK
 * ---------------
 * This state machine used to exist TWICE — inline in ChannelPlayer and again in
 * TvChannelPlayer, hand-ported and kept in sync by copying ~200 lines. That is
 * not a hypothetical maintenance cost: they had already drifted (the web
 * player's bench-expansion fetch was a bare `fetch` with no deadline while the
 * TV's used fetchWithDeadline, so on the one device where aborting a fetch does
 * nothing the web copy could hang forever), and every fix had to be made,
 * reviewed and re-reasoned twice.
 *
 * The two shells differ only in CONTROL SURFACE — touch chrome versus a D-pad
 * and a 10-foot overlay. That difference is real and belongs in the components.
 * Everything else is one algorithm, and it lives here. Ordering decisions are
 * further split into lib/sourceSelection (pure, testable without React).
 */

/** How many sources to probe / show at most. */
export const MAX_SOURCES = 10;
/** Initial candidate cap, before any bench expansion. */
const PROBE_CAP = 20;
/** Cap after the waiting-bench is merged in. Must be <= /api/stream-check's
 *  MAX_URLS, or the tail silently never gets a verdict. */
const EXPANDED_CAP = 24;
/** Below this many verified-working sources, pull the waiting bench. */
const EXPANSION_THRESHOLD = 2;
/**
 * Nightly bufferScore below which we pull the bench IMMEDIATELY, without
 * waiting for a probe pass to prove the channel is thin.
 *
 * Measured across 24 channels on 2026-08-05: the first verified source answered
 * HTTP 200 for 21 of them, and BOTH failures carried the lowest scores in the
 * sample — 25 and 23, against 50-80 for everything that worked. So the pipeline
 * already knows which channels are shaky; the player just never asked.
 *
 * Doing it up front is also strictly CHEAPER than the reactive path it
 * short-circuits. That one probes, waits for the pass to settle, fetches the
 * bench, and then re-probes the whole grown set — two full passes. Expanding
 * before the first probe starts means one larger pass instead.
 *
 * 40 sits in the empty band between the two clusters. Channels with no score at
 * all (0) are NOT treated as weak: an unscored channel is usually one the
 * nightly hasn't reached, not a bad one, and punishing unknowns would expand
 * every channel on a cold pipeline.
 */
const WEAK_CONFIDENCE = 40;
/** Cooldown re-evaluation tick, so a recovered source returns on its own. */
const COOLDOWN_TICK_MS = 5000;

export interface LiveSources {
  /** Every candidate, in stable input order. Source numbers index into this. */
  allUrls: string[];
  /** The URL to hand the player. */
  src: string;
  /** The row to render, best-first and capped. */
  displayUrls: string[];
  /** Settled verdict for a chip (holds at "checking" until the reveal). */
  badgeOf: (url: string) => SourceStatus;
  /** Should this source wear a red ✗? Only a SOLO drop earns one — a source
   *  caught in a relay-wide blip keeps its real badge. */
  condemned: (url: string) => boolean;
  /** Working count that trusts playback over any probe. */
  shownWorking: number;
  busyCount: number;
  /** Badges are still hidden (first pass, pre-reveal). */
  loading: boolean;
  /** The probe pass has genuinely finished. Gate expensive work on this. */
  settled: boolean;
  revalidating: boolean;
  /** User picked a source explicitly. */
  pick: (url: string) => void;
  /** Re-probe everything and clear playback cooldowns. */
  recheckAll: () => void;
  /** Wire to VideoPlayer's onStarted — frames are rendering. */
  onStarted: () => void;
  /** Wire to VideoPlayer's onStall and onError. */
  onFailure: () => void;
}

export function useLiveSources(
  channel: Channel | null | undefined,
  channelName: string,
): LiveSources {
  // Candidates, best-first: nightly-verified links, then the backend's live
  // links — deduped by STREAM identity (the same feed arrives in two encodings;
  // see lib/liveSources) and capped. Shared with the guide preview so both
  // agree on what "source 1" is.
  const probedUrls = useMemo(() => channelSourceList(channel, PROBE_CAP), [channel]);

  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const expansionFired = useRef(false);

  const allUrls = useMemo(
    () => (extraUrls.length > 0 ? appendSources(probedUrls, extraUrls, EXPANDED_CAP) : probedUrls),
    [probedUrls, extraUrls],
  );

  // Declared before the probe so the source ON SCREEN can be excluded from
  // background re-probes: several panels are max_connections=1, so asking for a
  // second slot on the stream you are watching manufactures the stall the
  // watchdog exists to detect.
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);

  // Probes every panel at once, on purpose. Staging it — lead with the playing
  // source's panel, hold the rest — was tried and measured 5x WORSE on the
  // Samsung (see the DO NOT DEFER note in useStreamCheck): the probe is what
  // the auto-pick uses to skip a dead source, so withholding it just means
  // starting on the dead one and waiting out the first-frame deadline.
  const { statusOf, badgeOf, workingCount, busyCount, loading, settled, recheck, revalidating } =
    useStreamCheck(allUrls, { skip: confirmedUrl });

  const channelSlugValue = channel ? channelSlug(channel.name) : "";
  const prevChannelSlug = useRef(channelSlugValue);
  useEffect(() => {
    if (channelSlugValue === prevChannelSlug.current) return;
    prevChannelSlug.current = channelSlugValue;
    expansionFired.current = false;
    setExtraUrls([]);
  }, [channelSlugValue]);

  // Pull the waiting bench, either because the pipeline already told us this
  // channel is thin (source_confidence — immediate, before any probe) or
  // because the probe settled short of the threshold (reactive, the old path).
  //
  // The reactive path is gated on `settled`, not `loading`: badges reveal early
  // now, and expanding off a half-finished pass would re-probe everything on
  // evidence that was about to arrive anyway.
  const confidence = channel?.source_confidence ?? 0;
  const weakUpFront = confidence > 0 && confidence < WEAK_CONFIDENCE;
  useEffect(() => {
    if (!weakUpFront && !settled) return;
    if (!weakUpFront && workingCount >= EXPANSION_THRESHOLD) return;
    if (expansionFired.current) return;
    if (probedUrls.length === 0) return;

    expansionFired.current = true;
    const slug = channelSlugValue;
    const controller = new AbortController();

    (async () => {
      try {
        // Deadlined: a bare fetch's `signal` is a no-op on the Samsung webview
        // (see lib/fetchDeadline), so a request that never settles would leave
        // the bench permanently un-expanded.
        const res = await fetchWithDeadline("/api/extra-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, exclude: probedUrls }),
          signal: controller.signal,
        }, DEADLINE.normal);
        if (!res.ok) return;
        const data: { urls?: string[] } = await res.json();
        if (Array.isArray(data.urls) && data.urls.length > 0) setExtraUrls(data.urls);
      } catch {
        // Aborted (channel changed), timed out, or network error — ignore.
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, workingCount, channelSlugValue, weakUpFront]);

  // A user-chosen source pins playback. Tracked by URL (not index) so reordering
  // the list as verdicts arrive never changes what the user selected.
  //
  // Seeded from the guide preview: whatever the preview had ON SCREEN counts as
  // a choice, because on channels that pool two different feeds under one name
  // (24/7 Pokemon carries the modern series on one source and the 1997 series on
  // the other) the player's own probe could otherwise open a different show than
  // the one you just previewed. Pinned, not forced — isDead() still drops it.
  const [pickedUrl, setPickedUrl] = useState<string | null>(() =>
    previewSourceFor(channelName),
  );
  // Sources that dropped DURING playback, mapped to WHEN. The relay has ~30-40s
  // GLOBAL outage windows where every source 403s at once and then recovers, so
  // a drop is a COOLDOWN rather than a session ban — see lib/sourceFailover.
  const [failedAt, setFailedAt] = useState<FailureMap>({});

  // What these sources DID last time we played them. Snapshotted once per set —
  // a localStorage read inside a sort comparator would be O(n log n) reads.
  const repTable = useMemo(() => reputationTable(), [allUrls]); // eslint-disable-line react-hooks/exhaustive-deps
  // When the source on screen started, so a drop can be scored by how long it
  // actually held.
  const playStartRef = useRef(0);

  // Re-evaluate cooldowns on a tick so a recovered source comes back on its own
  // even when nothing else changed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), COOLDOWN_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Reset selection + failure state when the channel changes (render-time reset
  // pattern — avoids a setState-in-effect and a stale-source flash).
  const [prevName, setPrevName] = useState(channel?.name);
  if (channel?.name !== prevName) {
    setPrevName(channel?.name);
    // Re-seed rather than clear: the lineup often resolves a beat AFTER mount
    // (cached-first useChannels) and this branch fires on that first resolve, so
    // a bare null would discard the preview's handoff on exactly the cold-load
    // path it exists for. previewSourceFor is a pure, TTL-bounded read.
    setPickedUrl(channel ? previewSourceFor(channelSlug(channel.name)) : null);
    setFailedAt({});
    setConfirmedUrl(null);
  }

  // One bag of facts for every ordering decision (lib/sourceSelection). Rebuilt
  // per render on purpose — `now` has to move for cooldowns to expire.
  const ctx: SelectionContext = {
    statusOf,
    failures: failedAt,
    reputation: repTable,
    confirmedUrl,
    now: Date.now(),
  };

  const isDead = useCallback(
    (u: string) => isDeadPure(u, ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusOf, failedAt, confirmedUrl],
  );

  // Trusts playback: never claim "0 online" while a source is on screen.
  const shownWorking =
    workingCount + (confirmedUrl && statusOf(confirmedUrl) !== "working" ? 1 : 0);

  // THE ROW IS FROZEN BETWEEN PASSES. Probing is sharded per panel, so a pass
  // lands a dozen times; re-sorting on each would visibly reshuffle the row
  // under the user's thumb — and on the TV this same array drives Left/Right
  // source cycling, so a row that moves mid-pass makes the remote land on a
  // different source than the one being aimed at. Re-sort only when the set
  // changes or a pass settles (a manual Recheck counts: the viewer asked).
  const orderRef = useRef<string[]>([]);
  const orderKeyRef = useRef<string | null>(null);
  const orderKey = `${allUrls.join("|")}|${!settled || revalidating ? "probing" : "settled"}`;
  if (orderKey !== orderKeyRef.current) {
    orderKeyRef.current = orderKey;
    orderRef.current = orderForDisplay(allUrls, ctx, pickedUrl, MAX_SOURCES);
  }
  const displayUrls = orderRef.current;

  // Playback: honour a manual pick unless it has since dropped; otherwise the
  // best auto source, with the in-flight attempt holding the player.
  const pickValid = pickedUrl != null && allUrls.includes(pickedUrl) && !isDead(pickedUrl);
  const ranked = rankSources(allUrls, ctx);
  const autoRef = useRef<string | null>(null);
  const held = stickHolds(autoRef.current, allUrls, ctx);
  const firstAlive = held ? autoRef.current! : ranked[0];
  useEffect(() => {
    autoRef.current = firstAlive ?? null;
  }, [firstAlive]);
  // If everything is cooling down (a global relay outage), keep trying the
  // least-recently-failed source instead of blanking to "no stream" — it is the
  // most likely to have recovered, and the player reconnects in place.
  const fallback = firstAlive ?? [...allUrls].sort(byOldestFailure(failedAt))[0] ?? "";
  const src = pickValid ? (pickedUrl as string) : fallback;

  // The current source dropped — record it so playback fails over now, but the
  // source can return once the relay recovers.
  const onFailure = useCallback(() => {
    if (!src) return;
    // Score it by how long it actually held: the signal no pre-playback probe
    // can produce (lib/sourceReputation).
    if (playStartRef.current) notePlayback(src, Date.now() - playStartRef.current);
    playStartRef.current = 0;
    setFailedAt((prev) => recordFailure(prev, src, Date.now()));
  }, [src]);

  // Bounded chance to produce a frame. Without this a source that connects and
  // then delivers nothing was only caught by the stall watchdog's SECOND strike,
  // ~20s in. A miss is recorded like any drop, so the blip/cooldown logic still
  // holds position during a relay-wide outage instead of walking the list.
  useFirstFrameDeadline({
    src,
    started: confirmedUrl === src,
    status: statusOf(src),
    onMiss: onFailure,
  });

  const onStarted = useCallback(() => {
    setConfirmedUrl(src);
    if (!playStartRef.current) playStartRef.current = Date.now();
  }, [src]);

  // Recheck gives verification AND playback-failed sources another chance.
  const recheckAll = useCallback(() => {
    setFailedAt({});
    recheck();
  }, [recheck]);

  const condemned = useCallback(
    (u: string) => isCondemned(failedAt, u, Date.now()),
    [failedAt],
  );

  return {
    allUrls,
    src,
    displayUrls,
    badgeOf,
    condemned,
    shownWorking,
    busyCount,
    loading,
    settled,
    revalidating,
    pick: setPickedUrl,
    recheckAll,
    onStarted,
    onFailure,
  };
}
