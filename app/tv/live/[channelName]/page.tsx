"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import TvChannelPlayer from "@/components/tv/TvChannelPlayer";
import { recordRecentChannel } from "@/lib/recentChannels";

export default function TvChannelPage() {
  const { channelName } = useParams<{ channelName: string }>();

  // Every open counts as "recently watched" for the Live TV guide.
  useEffect(() => {
    if (channelName) recordRecentChannel(channelName);
  }, [channelName]);

  return <TvChannelPlayer channelName={channelName} />;
}
