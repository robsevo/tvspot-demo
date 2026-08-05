import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChannels } from "@/hooks/useChannels";
import { useStreamCheck, type SourceStatus } from "@/hooks/useStreamCheck";
import VideoPlayer from "./VideoPlayer";
import { channelSlug } from "@/lib/sources";
import { appendSources, channelSourceList } from "@/lib/liveSources";
import { previewSourceFor } from "@/lib/previewHandoff";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X, Loader2, RefreshCw, Info, ExternalLink } from "lucide-react";

/** How many sources to probe / show at most. */
const MAX_SOURCES = 10; // raised from 6 — more failover depth + manual picks; only the chosen source streams

/** Small status indicator for a source button. */
function StatusDot({ status }: { status: SourceStatus }) {
  if (status === "checking") return <Loader2 className="w-3 h-3 animate-spin text-text-muted" />;
  if (status === "working") return <Check className="w-3 h-3 text-green-400" />;
  if (status === "dead") return <X className="w-3 h-3 text-red-400" />;
  // Amber = "not now, but not dead": a connection-limited panel (shared account
  // full this second) or a source that outran the probe's time budget. Both are
  // re-checked rather than written off — see useStreamCheck's DEAD_STREAK.
  if (status === "busy") return <span className="w-2 h-2 rounded-full bg-amber-400" title="Not available right now — still retrying" />;
  return null;
}

export default function ChannelPlayer({ channelName }: { channelName: string }) {
  const { channels } = useChannels();
  const router = useRouter();

  const channel = channels.find(
    (c) => channelSlug(c.name) === channelName
  );

  // Sources, best-first: nightly-verified links first, then the backend's live
  // links — deduped by STREAM identity (the same feed arrives in two encodings;
  // see lib/liveSources) and capped so we never probe an unbounded set. Shared
  // with the guide preview so both start on the same source.
  const probedUrls = useMemo(() => channelSourceList(channel, 20), [channel]);

  // Extra sources fetched dynamically when the initial probe comes up mostly dead.
  // Declared before allUrls so the memo can reference it without hoisting issues.
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const expansionFired = useRef(false);

  // Merge extra sources into the probe pool, deduped, capped at 24.
  const allUrls = useMemo(
    () => (extraUrls.length > 0 ? appendSources(probedUrls, extraUrls, 24) : probedUrls),
    [probedUrls, extraUrls],
  );

  // The source ACTUALLY playing — playback is ground truth, so the verifier can
  // never mark it dead or claim "no sources online" while it's on screen.
  // Declared before the probe so it can be excluded from background re-probes:
  // asking a max_connections=1 panel for a second slot on the stream you are
  // watching is how the watchdog used to cause the stalls it looks for.
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);

  const { statusOf, badgeOf, workingCount, busyCount, loading, recheck, revalidating } =
    useStreamCheck(allUrls, { skip: confirmedUrl });

  // Reset expansion when the channel changes.
  const channelSlugValue = channel ? channelSlug(channel.name) : "";
  const prevChannelSlug = useRef(channelSlugValue);
  useEffect(() => {
    if (channelSlugValue === prevChannelSlug.current) return;
    prevChannelSlug.current = channelSlugValue;
    expansionFired.current = false;
    setExtraUrls([]);
  }, [channelSlugValue]);

  // After the initial probe settles with < 2 working sources, fetch the
  // waiting-bench URLs for this channel and re-probe the grown set.
  useEffect(() => {
    if (loading) return;
    if (workingCount >= 2) return;
    if (expansionFired.current) return;
    if (probedUrls.length === 0) return;

    expansionFired.current = true;
    const slug = channelSlugValue;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/extra-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, exclude: probedUrls }),
          signal: controller.signal,
        });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, workingCount, channelSlugValue]);

  // A user-chosen source pins playback. Tracked by URL (not index) so reordering
  // the list as verdicts arrive never changes what the user selected.
  //
  // Seeded from the guide preview: whatever the preview had ON SCREEN counts as
  // a choice, because on channels that pool two different feeds under one name
  // (24/7 Pokemon carries the modern series on one source and the 1997 series on
  // the other) the player's own probe could otherwise open a different show than
  // the one you just previewed. Pinned, not forced — isDead() still drops it and
  // fails over. See lib/previewHandoff.
  const [pickedUrl, setPickedUrl] = useState<string | null>(() =>
    previewSourceFor(channelName),
  );
  // Sources that dropped DURING playback (stall watchdog / fatal error), mapped
  // to WHEN they dropped. The relay has ~30-40s GLOBAL outage windows where every
  // (shared-relay) source 403s at once, then recovers — so a drop is a COOLDOWN,
  // not a permanent session ban: after FAIL_COOLDOWN_MS the source is eligible
  // again. This is what turns "held for a while then stopped" into auto-recovery.
  const [failedAt, setFailedAt] = useState<Record<string, number>>({});
  const FAIL_COOLDOWN_MS = 60000;

  // Re-evaluate cooldowns on a tick so a recovered source comes back on its own,
  // even when no other state changed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // Reset selection + playback-failure state when the channel changes (render-time
  // reset pattern — avoids a setState-in-effect and a stale-source flash).
  const [prevName, setPrevName] = useState(channel?.name);
  if (channel?.name !== prevName) {
    setPrevName(channel?.name);
    // Re-seed rather than clear: the lineup often resolves a beat AFTER mount
    // (cached-first useChannels), and this branch fires on that first resolve —
    // a bare null here would throw away the preview's handoff on exactly the
    // cold-load path it's needed for. previewSourceFor is a pure, TTL-bounded
    // read, so it returns null for any channel the preview didn't just play.
    setPickedUrl(channel ? previewSourceFor(channelSlug(channel.name)) : null);
    setFailedAt({});
    setConfirmedUrl(null);
  }

  // A source is unusable if verification marked it dead OR it dropped within the
  // cooldown window (after which the relay has likely recovered).
  const isDead = (u: string) => {
    // An actual mid-watch drop (cooldown) wins even over a confirmed source.
    if (failedAt[u] !== undefined && Date.now() - failedAt[u] < FAIL_COOLDOWN_MS) return true;
    // The source on screen is playing — a verify probe (which may hit a transient
    // 456/timeout) can't override reality. Busy sources are "unknown", not dead.
    if (u === confirmedUrl) return false;
    return statusOf(u) === "dead";
  };

  // Working count that trusts playback: if the on-screen source plays but the probe
  // didn't verify it, still count it — so we never say "0 online" while it's playing.
  const shownWorking = workingCount + (confirmedUrl && statusOf(confirmedUrl) !== "working" ? 1 : 0);

  // Buttons: EVERY source stays listed — hiding a source because one probe round
  // said "dead" is what made sources vanish and reappear on their own, on panels
  // that demonstrably flap probe-to-probe. Verdicts drive the badge and the ORDER
  // (Online → Busy → unprobed → dead), never the membership, and the sort is
  // stable within a tier so nothing jitters. What's playing is pinned first.
  //
  // THE ORDER IS FROZEN BETWEEN PASSES. It used to re-sort on every verdict,
  // which was survivable when a pass produced ONE update — but probing is now
  // sharded per panel, so a pass lands a dozen times and the row visibly
  // reshuffled under the user's thumb each time. Re-sorting is allowed only when
  // the source set changes or a pass settles, so the list moves at most once per
  // probe instead of once per panel.
  const orderRef = useRef<string[]>([]);
  const orderKeyRef = useRef<string | null>(null);
  // `revalidating` is in the key so a manual Recheck DOES re-sort when it lands —
  // the user asked for a fresh verdict, so acting on it is the expected result.
  const orderKey = `${allUrls.join("|")}|${loading || revalidating ? "probing" : "settled"}`;
  if (orderKey !== orderKeyRef.current) {
    orderKeyRef.current = orderKey;
    const tier = (u: string) => {
      if (u === confirmedUrl) return 0;   // on screen → reality outranks any probe
      if (u === pickedUrl) return 0;      // the user's explicit choice stays put
      if (isDead(u)) return 4;
      switch (statusOf(u)) {
        case "working": return 1;
        case "busy": return 2;
        case "dead": return 4;
        default: return 3;                // unknown / still checking
      }
    };
    orderRef.current = allUrls
      .map((u, i) => ({ u, i, t: tier(u) }))
      .sort((a, b) => a.t - b.t || a.i - b.i)
      .map((x) => x.u)
      .slice(0, MAX_SOURCES);
  }
  const displayUrls = orderRef.current;

  // Playback: honor a manual pick (unless it has since dropped); otherwise the
  // BEST auto source. Preference cycles past busy (connection-limited) accounts to
  // a free one: confirmed-working non-busy first, then still-checking/unknown, then
  // busy last (only if nothing better). During probing nothing is verified yet, so
  // source 1 plays instantly; verdicts then promote a non-busy working source.
  const pickValid = pickedUrl != null && allUrls.includes(pickedUrl) && !isDead(pickedUrl);
  const pickRank = (u: string): number => {
    if (u === confirmedUrl) return -1;         // already playing → never displace it
    const s = statusOf(u);
    if (s === "working") return 0;             // verified free + playable
    if (s === "checking" || s === "unknown") return 1; // not yet judged — worth trying
    if (s === "busy") return 2;                // connection-limited → last resort
    return 3;                                   // dead
  };
  // STICKY auto-pick, but only while sticking is still defensible.
  //
  // Re-sorting on every verdict yanked a channel that was connecting fine on
  // Source 1 over to Source 2 the instant that one verified — a needless reload
  // (black frame, audio restart) mid-tune. So the pick sticks.
  //
  // It used to stick until the source was judged DEAD, and that is the bug that
  // made the ranking look broken: "busy" is not "dead". A source at its panel's
  // connection limit is a source that will not start, yet it held the pick
  // forever while verified-working sources sat below it. Measured on 24/7 Rick
  // and Morty: 8 busy, 0 ok, and the player sat on a busy source until the stall
  // watchdog eventually gave up — while other channels had working sources one
  // rank down the whole time.
  //
  // Now the stick holds only while nothing is STRICTLY better. Once playback is
  // confirmed, pickRank returns -1 for that source, so a healthy connect can
  // never be displaced — which is the property the stickiness existed for.
  const ranked = allUrls
    .filter((u) => !isDead(u))
    .sort((a, b) => pickRank(a) - pickRank(b));
  const autoRef = useRef<string | null>(null);
  const stick = autoRef.current;
  const best = ranked[0];
  const stickHolds =
    stick != null &&
    allUrls.includes(stick) &&
    !isDead(stick) &&
    (best === undefined || pickRank(stick) <= pickRank(best));
  const firstAlive = stickHolds ? stick : best;
  useEffect(() => {
    autoRef.current = firstAlive ?? null;
  }, [firstAlive]);
  // If every source is cooling down (a global relay outage), keep trying the
  // least-recently-failed one instead of blanking to "no stream" — it's the most
  // likely to have recovered, and the player's own recovery reconnects in place.
  const fallback =
    firstAlive ??
    [...allUrls].sort((a, b) => (failedAt[a] ?? 0) - (failedAt[b] ?? 0))[0] ??
    "";
  const src = pickValid ? (pickedUrl as string) : fallback;

  // The current source dropped — start its cooldown so playback fails over now
  // but the source can return once the relay recovers.
  const handleSourceFailure = useCallback(() => {
    if (!src) return;
    setFailedAt((prev) => ({ ...prev, [src]: Date.now() }));
  }, [src]);

  // Recheck gives both verification AND playback-failed sources another chance.
  const recheckAll = useCallback(() => {
    setFailedAt({});
    recheck();
  }, [recheck]);

  const channelUp = useCallback(() => {
    if (!channel) return;
    const idx = channels.findIndex((c) => c.name === channel.name);
    if (idx < channels.length - 1) {
      const next = channels[idx + 1];
      router.push(`/live/${channelSlug(next.name)}`);
    }
  }, [channel, channels, router]);

  const channelDown = useCallback(() => {
    if (!channel) return;
    const idx = channels.findIndex((c) => c.name === channel.name);
    if (idx > 0) {
      const prev = channels[idx - 1];
      router.push(`/live/${channelSlug(prev.name)}`);
    }
  }, [channel, channels, router]);

  if (!channel) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <p>Channel not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.push("/live")}
        className="flex items-center gap-2 text-text-secondary hover:text-white transition-colors self-start min-h-[44px]"
      >
        <ArrowLeft className="w-5 h-5" />
        <span className="text-sm">All Channels</span>
      </button>

      <VideoPlayer
        src={src}
        channelName={channel.name}
        title={channel.name}
        poster={channel.logo_url || channel.logo}
        isLive
        channelUp={channelUp}
        channelDown={channelDown}
        onPlay={() => setConfirmedUrl(src)}
        onStall={handleSourceFailure}
        onError={handleSourceFailure}
      />

      {/* Open the current source directly in a new tab — the same escape hatch as
          VOD. When the in-app player loops or stalls, this plays the raw stream
          outside it (iOS Safari plays the .m3u8 natively). Always available, even
          on single-source channels. */}
      {src && (
        <div className="flex items-center justify-end px-1 -mt-1">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] px-2.5 py-1 rounded-full bg-card text-text-muted hover:text-white transition-colors flex items-center gap-1"
            title="If this source won't play here, open it in a new tab"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
        </div>
      )}

      {/* No auto-switch once playing — user picks a source below. Nudge after 30s. */}
      <SourceTroubleHint resetKey={src} message="Trouble with this channel? Try another source below." />

      {allUrls.length > 1 && (
        <div className="flex flex-col gap-2">
          {/* Verification summary */}
          <div className="flex items-center justify-between px-1 text-xs text-text-muted">
            {/* Counts lead, "checking" trails. Verdicts now arrive per panel
                rather than all at the end (~0.5s for the first, vs 3-6s for the
                whole pass), so a flat "Checking sources…" would hide the very
                progress that was just made visible. */}
            <span>
              {shownWorking > 0
                ? `${shownWorking} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${allUrls.length}${loading ? " · checking…" : ""}`
                : loading
                  ? "Checking sources…"
                  : busyCount > 0
                    ? `${busyCount} source${busyCount > 1 ? "s" : ""} busy — will connect when free`
                    : `0 of ${allUrls.length} sources online`}
            </span>
            <button
              onClick={recheckAll}
              disabled={loading || revalidating}
              className="flex items-center gap-1 text-text-secondary hover:text-white transition-colors disabled:opacity-50 min-h-[32px]"
              aria-label="Re-check sources"
            >
              <RefreshCw className={`w-3 h-3 ${loading || revalidating ? "animate-spin" : ""}`} />
              <span>Recheck</span>
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto px-1">
            {displayUrls.map((url) => {
              // Show a failed/cooling source as dead (✗). badgeOf, not statusOf:
              // the chip holds at "checking" until the whole pass is in, so the
              // badges resolve together instead of flickering panel by panel.
              const status = isDead(url) ? "dead" : badgeOf(url);
              const isCurrent = url === src;
              // Number from the source's ORIGINAL position, never the display
              // position: the list re-orders as verdicts land, and a label that
              // renumbers means "Source 3" becomes "Source 1" underneath the user.
              const num = allUrls.indexOf(url) + 1;
              return (
                <button
                  key={url}
                  onClick={() => setPickedUrl(url)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    isCurrent
                      ? "bg-brand text-white"
                      : status === "dead"
                        ? "bg-card text-text-muted opacity-60 hover:opacity-100"
                        : "bg-card text-text-secondary hover:text-white"
                  }`}
                >
                  <StatusDot status={status} />
                  {revalidating && <Loader2 className="w-3 h-3 animate-spin text-text-muted" />}
                  Source {num}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Disclaimer — live sources cycle as providers come and go, so a periodic
          Recheck is the fastest fix for stalls / a source that won't load. */}
      <p className="flex items-start gap-1.5 px-1 text-[11px] text-text-muted">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
        <span>
          Live streams cycle as providers come and go. If a channel stalls, buffers, or
          won&apos;t load, tap <span className="text-text-secondary font-medium">Recheck</span> every
          now and then to refresh the source list, pick another source above, or tap{" "}
          <span className="text-text-secondary font-medium">Open</span> to play the current
          source in a new tab.
        </span>
      </p>
    </div>
  );
}
