import { useCallback } from "react";
import { useChannels } from "@/hooks/useChannels";
import { type SourceStatus } from "@/hooks/useStreamCheck";
import { useLiveSources } from "@/hooks/useLiveSources";
import VideoPlayer from "./VideoPlayer";
import { channelSlug } from "@/lib/sources";
import { SourceTroubleHint } from "@/components/SourceTroubleHint";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X, Loader2, RefreshCw, Info, ExternalLink } from "lucide-react";

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

  // The whole source pipeline — candidate list, probing, auto-pick, failover,
  // reputation — lives in the shared hook so this component and its TV twin
  // cannot drift. Everything below is touch presentation.
  const {
    allUrls, src, displayUrls, badgeOf, condemned, shownWorking, busyCount,
    loading, settled, revalidating, pick, recheckAll, onStarted, onFailure,
  } = useLiveSources(channel, channelName);

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
        onStarted={onStarted}
        onStall={onFailure}
        onError={onFailure}
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
                ? `${shownWorking} online${busyCount > 0 ? ` · ${busyCount} busy` : ""} of ${allUrls.length}${!settled ? " · checking…" : ""}`
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
              // isCondemned, not isDead: a source that dropped ALONE gets the ✗,
              // but one caught in a relay-wide blip keeps its real badge — it is
              // not broken, and painting it ✗ is what turned one relay hiccup
              // into a row of dead-looking sources. badgeOf (not statusOf) holds
              // the chip at "checking" until the whole pass is in, so badges
              // resolve together instead of flickering panel by panel.
              const status = condemned(url) ? "dead" : badgeOf(url);
              const isCurrent = url === src;
              // Number from the source's ORIGINAL position, never the display
              // position: the list re-orders as verdicts land, and a label that
              // renumbers means "Source 3" becomes "Source 1" underneath the user.
              const num = allUrls.indexOf(url) + 1;
              return (
                <button
                  key={url}
                  onClick={() => pick(url)}
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
