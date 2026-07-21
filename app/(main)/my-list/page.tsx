"use client";

import { useMyList } from "@/hooks/useMyList";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import PosterCard from "@/components/PosterCard";
import { Library, X } from "lucide-react";

export default function MyListPage() {
  const { items: myListItems, remove: removeFromList } = useMyList();
  const { items: continueWatching, remove: removeFromContinue } = useContinueWatching();

  return (
    <div className="pt-14 min-h-screen pb-20 animate-fade-in">
      <div className="px-4 mb-3 flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-cyan-400 flex items-center justify-center">
          <Library className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-white text-lg font-bold">My List</h1>
          <p className="text-text-muted text-[11px]">
            {myListItems.length} saved · {continueWatching.length} in progress
          </p>
        </div>
      </div>

      {continueWatching.length > 0 && (
        <section className="mb-6">
          <h2 className="text-white text-base font-semibold px-4 mb-2">Continue Watching</h2>
          <div className="flex gap-2 overflow-x-auto px-4 poster-rail">
            {continueWatching.map((item) => (
              <div
                key={`${item.tmdbId}-${item.season ?? ""}-${item.episode ?? ""}`}
                className="relative flex-shrink-0 w-[40vw] sm:w-[180px] md:w-[200px] lg:w-[220px] group"
              >
                <PosterCard
                  tmdbId={item.tmdbId}
                  title={item.title}
                  poster={item.poster}
                  kind={item.kind}
                  service=""
                  season={item.season}
                  episode={item.episode}
                />
                <button
                  onClick={() => removeFromContinue(item.tmdbId, item.kind)}
                  aria-label={`Remove ${item.title} from Continue Watching`}
                  className="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-brand hover:text-white ring-1 ring-white/15 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {myListItems.length > 0 && (
        <section className="mb-6">
          <h2 className="text-white text-base font-semibold px-4 mb-2">Saved</h2>
          <div className="flex gap-2 overflow-x-auto px-4 poster-rail">
            {myListItems.map((item) => (
              <div key={item.tmdbId} className="relative flex-shrink-0 w-[40vw] sm:w-[180px] md:w-[200px] lg:w-[220px] group">
                <PosterCard
                  tmdbId={item.tmdbId}
                  title={item.title}
                  poster={item.poster}
                  kind={item.kind}
                  service={item.service}
                />
                <button
                  onClick={() => removeFromList(item.tmdbId, item.kind)}
                  aria-label={`Remove ${item.title} from My List`}
                  className="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full bg-black/70 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-brand hover:text-white ring-1 ring-white/15 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {myListItems.length === 0 && continueWatching.length === 0 && (
        <div className="px-4 pt-12 text-center">
          <div className="w-16 h-16 rounded-full bg-card mx-auto mb-4 flex items-center justify-center">
            <Library className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-secondary text-sm">Your list is empty</p>
          <p className="text-text-muted text-xs mt-1">
            Save movies and series to watch later
          </p>
        </div>
      )}
    </div>
  );
}