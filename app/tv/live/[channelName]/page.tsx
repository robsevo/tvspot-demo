"use client";

import { useParams } from "next/navigation";
import TvChannelPlayer from "@/components/tv/TvChannelPlayer";

export default function TvChannelPage() {
  const { channelName } = useParams<{ channelName: string }>();
  return <TvChannelPlayer channelName={channelName} />;
}
