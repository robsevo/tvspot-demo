"use client";

import { useState } from "react";
import { Play, ChevronDown, ChevronUp } from "lucide-react";
import type { Season, Episode } from "@/lib/types";

interface Props {
  seasons: Season[];
  onPlayEpisode: (episode: Episode, seasonNumber: number) => void;
}

export default function SeasonAccordion({ seasons, onPlayEpisode }: Props) {
  const [expandedSeason, setExpandedSeason] = useState<number>(seasons[0]?.season_number || 1);

  if (!seasons.length) return null;

  const toggleSeason = (num: number) => {
    setExpandedSeason((prev) => (prev === num ? -1 : num));
  };

  return (
    <div className="space-y-2 px-4">
      {seasons.map((season) => {
        const isExpanded = expandedSeason === season.season_number;
        return (
          <div key={season.season_number} className="rounded-xl bg-card overflow-hidden">
            <button
              onClick={() => toggleSeason(season.season_number)}
              className="w-full flex items-center justify-between p-3 min-h-[44px]"
            >
              <span className="text-white text-sm font-medium">
                Season {season.season_number}
              </span>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-text-muted" />
              )}
            </button>
            {isExpanded && (
              <div className="border-t border-white/5">
                {season.episodes.map((ep) => (
                  <button
                    key={ep.episode_number}
                    onClick={() => onPlayEpisode(ep, season.season_number)}
                    className="w-full flex items-start gap-3 p-3 hover:bg-white/5 transition-colors min-h-[44px]"
                  >
                    <div className="w-16 h-10 rounded bg-surface flex-shrink-0 overflow-hidden">
                      {ep.still_url ? (
                        <img
                          src={ep.still_url}
                          alt={ep.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Play className="w-3 h-3 text-text-muted" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-white text-xs font-medium">
                        E{ep.episode_number} — {ep.title || `Episode ${ep.episode_number}`}
                      </p>
                      {ep.overview && (
                        <p className="text-text-muted text-[10px] line-clamp-1 mt-0.5">{ep.overview}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}