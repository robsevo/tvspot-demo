"use client";

import { useChannels } from "@/hooks/useChannels";

export default function EpgView({ channelName }: { channelName?: string }) {
  const { channels } = useChannels();

  const filtered = channelName
    ? channels.filter((c) => c.name.toLowerCase().includes(channelName.toLowerCase()))
    : channels.slice(0, 10);

  if (channels.length === 0) return null;

  return (
    <div className="space-y-1">
      <h3 className="text-white text-xs font-semibold px-4 mb-2">Now Playing</h3>
      {filtered.slice(0, 5).map((ch) => {
        const prog = (ch as any).programs?.[0];
        return (
          <div
            key={ch.name}
            className="flex items-center gap-3 px-4 py-2"
          >
            <span className="text-text-muted text-[10px] w-14 flex-shrink-0">{ch.name}</span>
            <div className="flex-1 min-w-0">
              {prog ? (
                <>
                  <p className="text-text-primary text-xs truncate">{prog.title}</p>
                  <p className="text-text-muted text-[10px]">
                    {new Date(prog.start_utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" - "}
                    {new Date(prog.stop_utc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </>
              ) : (
                <p className="text-text-muted text-xs">No program info</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}