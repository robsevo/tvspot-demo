"use client";

import { channelSlug } from "@/lib/sources";
import { useParams } from "next/navigation";
import { useChannels } from "@/hooks/useChannels";
import Link from "next/link";
import ChannelPlayer from "@/components/ChannelPlayer";
import { RefreshCw } from "lucide-react";

export default function ChannelPage() {
  const { channelName } = useParams<{ channelName: string }>();
  // Cached-first channel lineup (the same hook the player itself uses): a
  // backend blip or restart no longer blocks tuning — the last-good list from
  // localStorage resolves the channel, and the player's baked-in verified
  // sources still play. The old version did its own uncached live-channels
  // fetch here and rendered "Channel not found" whenever that one request
  // failed — which is exactly what happened during nightly API bounces.
  const { channels, loading, refetch } = useChannels();

  const channel = channels.find((ch) => channelSlug(ch.name) === channelName) || null;

  if (!channel && loading) {
    return (
      <div className="pt-3 min-h-screen pb-20 animate-pulse px-4">
        <div className="h-6 bg-card rounded w-1/2 mb-4" />
        <div className="h-32 bg-card rounded" />
      </div>
    );
  }

  if (!channel && channels.length === 0) {
    // No lineup at all (nothing cached AND the fetch failed) — a transient
    // backend window, not a bad channel link. Offer a retry instead of the
    // dead-end "Channel not found".
    return (
      <div className="pt-3 min-h-screen pb-20 px-4 text-center">
        <p className="text-text-secondary">
          Can&apos;t reach the TV service right now — it may be restarting.
        </p>
        <button
          onClick={refetch}
          className="mt-4 inline-flex items-center gap-1.5 bg-brand text-white text-sm font-medium px-4 py-2.5 rounded-xl min-h-[44px]"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
        <div>
          <Link href="/live" className="text-brand text-sm mt-4 inline-block">Back to Live TV</Link>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="pt-3 min-h-screen pb-20 px-4 text-center">
        <p className="text-text-secondary">Channel not found</p>
        <Link href="/live" className="text-brand text-sm mt-2 inline-block">Back to Live TV</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 animate-fade-in">
      {/* Centered, width-capped column so the player is a tidy panel on desktop
          instead of a stretched-edge-to-edge video. Full-width on mobile. */}
      <div className="mx-auto w-full max-w-5xl">
        <ChannelPlayer channelName={channelName} />

      {channel.programs && channel.programs.length > 0 && (
        <div className="px-4 mt-4">
          <h2 className="text-white text-sm font-semibold mb-2">Schedule</h2>
          <div className="space-y-1">
            {channel.programs.map((prog, i) => {
              const start = new Date(prog.start_utc);
              const end = new Date(prog.stop_utc);
              const now = new Date();
              const isNow = start <= now && end > now;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                    isNow ? "bg-brand/15 ring-1 ring-brand/40" : "bg-card/50"
                  }`}
                >
                  <div className="flex-shrink-0 w-14 text-right">
                    <span className={`text-[10px] font-medium ${isNow ? "text-brand" : "text-text-muted"}`}>
                      {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <span className={`text-xs ${isNow ? "text-white font-medium" : "text-text-secondary"}`}>
                    {prog.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
