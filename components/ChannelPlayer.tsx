import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChannels } from "@/hooks/useChannels";
import { getChannelSources } from "@/lib/sources";
import { useStreamCheck, type SourceStatus } from "@/hooks/useStreamCheck";
import VideoPlayer from "./VideoPlayer";
import { channelSlug } from "@/lib/sources";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X, Loader2, RefreshCw, Info, ExternalLink } from "lucide-react";

/** How many sources to probe / show at most. */
const MAX_SOURCES = 6;

/** Small status indicator for a source button. */
function StatusDot({ status }: { status: SourceStatus }) {
  if (status === "checking") return <Loader2 className="w-3 h-3 animate-spin text-text-muted" />;
  if (status === "working") return <Check className="w-3 h-3 text-green-400" />;
  if (status === "dead") return <X className="w-3 h-3 text-red-400" />;
  // Busy = connection-limited (shared account full right now), not dead — amber.
  if (status === "busy") return <span className="w-2 h-2 rounded-full bg-amber-400" title="Busy — connection limit" />;
  return null;
}

export default function ChannelPlayer({ channelName }: { channelName: string }) {
  const { channels } = useChannels();
  const router = useRouter();

  const channel = channels.find(
    (c) => channelSlug(c.name) === channelName
  );

  // Sources, best-first: nightly-verified links (lib/sources) first, then the
  // backend's live links. Deduped, and capped so we never probe an unbounded set.
  const probedUrls = useMemo(() => {
    if (!channel) return [];
    const merged = [
      ...getChannelSources(channel.name),
      channel.primary_url,
      ...(channel.backup_urls || []),
    ].filter((u): u is string => Boolean(u));
    return Array.from(new Set(merged)).slice(0, 10);
  }, [channel]);

  // Extra sources fetched dynamically when the initial probe comes up mostly dead.
  // Declared before allUrls so the memo can reference it without hoisting issues.
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const expansionFired = useRef(false);

  // Merge extra sources into the probe pool, deduped, capped at 14.
  const allUrls = useMemo(
    () => (extraUrls.length > 0
      ? [...new Set([...probedUrls, ...extraUrls])].slice(0, 14)
      : probedUrls),
    [probedUrls, extraUrls],
  );

  const { statusOf, workingCount, busyCount, loading, recheck } = useStreamCheck(allUrls);

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

  // The source ACTUALLY playing — playback is ground truth, so the verifier can
  // never mark it dead or claim "no sources online" while it's on screen.
  const [confirmedUrl, setConfirmedUrl] = useState<string | null>(null);

  // A user-chosen source pins playback. Tracked by URL (not index) so reordering
  // the list as verdicts arrive never changes what the user selected.
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
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
    setPickedUrl(null);
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

  // Buttons: keep usable + still-checking sources (order preserved), hide dead/
  // failed ones, cap the list. If everything is gone, show them anyway so the user
  // can still try. A manual pick stays visible even if it died.
  const displayUrls = useMemo(() => {
    const alive = allUrls.filter((u) => !isDead(u));
    const base = (alive.length > 0 ? alive : allUrls).slice(0, MAX_SOURCES);
    if (pickedUrl && allUrls.includes(pickedUrl) && !base.includes(pickedUrl)) {
      return [pickedUrl, ...base].slice(0, MAX_SOURCES);
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUrls, statusOf, pickedUrl, failedAt]);

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
  const firstAlive = allUrls
    .filter((u) => !isDead(u))
    .sort((a, b) => pickRank(a) - pickRank(b))[0];
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
            <span>
              {loading
                ? "Checking sources…"
                : shownWorking > 0
                  ? `${shownWorking} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${allUrls.length}`
                  : busyCount > 0
                    ? `${busyCount} source${busyCount > 1 ? "s" : ""} busy — will connect when free`
                    : `0 of ${allUrls.length} sources online`}
            </span>
            <button
              onClick={recheckAll}
              disabled={loading}
              className="flex items-center gap-1 text-text-secondary hover:text-white transition-colors disabled:opacity-50 min-h-[32px]"
              aria-label="Re-check sources"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              <span>Recheck</span>
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto px-1">
            {displayUrls.map((url, i) => {
              // Show a failed/cooling source as dead (✗).
              const status = isDead(url) ? "dead" : statusOf(url);
              const isCurrent = url === src;
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
                  Source {i + 1}
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
