"use client";

import { channelSlug } from "@/lib/sources";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { proxyFetch } from "@/lib/api";
import Link from "next/link";
import ChannelPlayer from "@/components/ChannelPlayer";
import type { ChannelsResponse } from "@/lib/types";

export default function ChannelPage() {
  const { channelName } = useParams<{ channelName: string }>();
  const [channel, setChannel] = useState<ChannelsResponse["channels"][number] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!channelName) return;
    setLoading(true);
    proxyFetch<ChannelsResponse>("/api/lounge/live-channels")
      .then((data) => {
        const found = data.channels.find(
          (ch) => channelSlug(ch.name) === channelName
        );
        setChannel(found || null);
      })
      .catch((err) => console.error("Channel fetch failed:", err))
      .finally(() => setLoading(false));
  }, [channelName]);

  if (loading) {
    return (
      <div className="pt-3 min-h-screen pb-20 animate-pulse px-4">
        <div className="h-6 bg-card rounded w-1/2 mb-4" />
        <div className="h-32 bg-card rounded" />
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
  );
}