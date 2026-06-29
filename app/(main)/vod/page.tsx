"use client";

import { useState, useMemo } from "react";
import { useCatalog, useServiceCatalog } from "@/hooks/useCatalog";
import ServicePicker from "@/components/ServicePicker";
import PosterRail from "@/components/PosterRail";
import CatalogBrowser from "@/components/CatalogBrowser";
import { PageSkeleton } from "@/components/LoadingSkeleton";
import { Film, Sparkles, ChevronLeft } from "lucide-react";
import { GENRE_MAP, detectGenre } from "@/lib/types";
import { curate } from "@/lib/discovery";
import type { CatalogItem } from "@/lib/types";

function getItemGenres(item: CatalogItem): string[] {
  const genres: string[] = [];
  if (item.genres && item.genres.length > 0) {
    genres.push(...item.genres);
  } else if (item.genre_ids && item.genre_ids.length > 0) {
    for (const id of item.genre_ids) {
      const name = GENRE_MAP[id];
      if (name) genres.push(name);
    }
  }
  // Backend catalog items carry no genre metadata; fall back to a keyword
  // heuristic over title/overview so genre filter pills still work.
  if (genres.length === 0) {
    return detectGenre(item.title || "", item.overview || "");
  }
  return genres;
}

export default function VodPage() {
  const { services } = useCatalog();
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState("All");
  // "See all" full-catalog view for one kind within the selected provider.
  const [seeAll, setSeeAll] = useState<"movie" | "series" | null>(null);
  const { movies, series, loading, label } = useServiceCatalog(selectedService);

  // Sort by current US/CA popularity (curate writes-back), English + no-holiday,
  // instead of raw vote_average which floats decades-old classics to the top.
  const sortedMovies = useMemo(() => curate(movies), [movies]);
  const sortedSeries = useMemo(() => curate(series), [series]);
  const isEmpty = sortedMovies.length === 0 && sortedSeries.length === 0;

  // Collect unique genres from all items
  const allGenres = useMemo(() => {
    const genreSet = new Set<string>();
    for (const item of movies) {
      for (const g of getItemGenres(item)) genreSet.add(g);
    }
    for (const item of series) {
      for (const g of getItemGenres(item)) genreSet.add(g);
    }
    return ["All", ...Array.from(genreSet).sort()];
  }, [movies, series]);

  // Count items per genre for pill display
  const genreCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const genre of allGenres) {
      if (genre === "All") {
        counts[genre] = movies.length + series.length;
      } else {
        counts[genre] = 0;
        for (const item of movies) {
          if (getItemGenres(item).includes(genre)) counts[genre]++;
        }
        for (const item of series) {
          if (getItemGenres(item).includes(genre)) counts[genre]++;
        }
      }
    }
    return counts;
  }, [allGenres, movies, series]);

  const handleServiceSelect = (service: string) => {
    setSelectedGenre("All");
    setSeeAll(null);
    setSelectedService(service);
  };

  const handleBack = () => {
    setSelectedGenre("All");
    setSeeAll(null);
    setSelectedService(null);
  };

  const filterByGenre = (items: CatalogItem[]) => {
    if (selectedGenre === "All") return items;
    return items.filter((item) => getItemGenres(item).includes(selectedGenre));
  };

  const filteredMovies = filterByGenre(sortedMovies);
  const filteredSeries = filterByGenre(sortedSeries);

  // "See all" — full provider catalog for one kind, with search + sort. Shown in
  // place of the rails view; back returns to the rails for the same provider.
  if (selectedService && seeAll && !loading && !isEmpty) {
    return (
      <div className="hud-grid-bg pt-12 min-h-screen pb-20 animate-page-rise">
        <CatalogBrowser
          items={seeAll === "movie" ? sortedMovies : sortedSeries}
          kind={seeAll}
          serviceLabel={label || selectedService}
          onBack={() => setSeeAll(null)}
        />
      </div>
    );
  }

  return (
    <div className="hud-grid-bg pt-12 min-h-screen pb-20 animate-page-rise">
      {/* Header */}
      <div className="px-4 mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectedService ? (
            <button
              onClick={handleBack}
              className="w-9 h-9 rounded-xl glass-card flex items-center justify-center transition-colors"
              aria-label="Back to services"
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-cyan-400 flex items-center justify-center hud-glow">
              <Film className="w-4 h-4 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-white text-lg font-bold">
              {selectedService || "VOD"}
            </h1>
            <p className="text-text-muted text-[11px]">
              {selectedService
                ? `${movies.length + series.length} titles`
                : `${services.length} providers`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-brand text-xs font-medium bg-brand/10 px-2.5 py-1 rounded-full hud-glow">
          <Sparkles className="w-3 h-3" />
          <span>On Demand</span>
        </div>
      </div>

      {!selectedService && (
        <ServicePicker onSelectAction={handleServiceSelect} />
      )}

      {selectedService && loading && <PageSkeleton />}

      {selectedService && !loading && isEmpty && (
        <div className="px-4 pt-8 text-center">
          <div className="w-16 h-16 rounded-full bg-card mx-auto mb-4 flex items-center justify-center">
            <Film className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-secondary text-sm">No titles available for {selectedService}</p>
        </div>
      )}

      {selectedService && !loading && !isEmpty && (
        <div>
          {/* Genre filter pills */}
          {allGenres.length > 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 mb-3 poster-rail">
              {allGenres.map((genre) => {
                const count = genreCounts[genre] || 0;
                if (count === 0 && genre !== "All") return null;
                return (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(genre)}
                    className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                      selectedGenre === genre
                        ? "bg-brand text-white hud-glow"
                        : "glass-card text-text-secondary hover:text-white"
                    }`}
                  >
                    {genre}
                  </button>
                );
              })}
            </div>
          )}

          {filteredMovies.length > 0 && (
            <PosterRail
              title={`${label || selectedService} Movies`}
              items={filteredMovies}
              kind="movie"
              onSeeAll={() => setSeeAll("movie")}
            />
          )}
          {filteredSeries.length > 0 && (
            <PosterRail
              title={`${label || selectedService} Series`}
              items={filteredSeries}
              kind="series"
              onSeeAll={() => setSeeAll("series")}
            />
          )}
        </div>
      )}
    </div>
  );
}