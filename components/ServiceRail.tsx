"use client";

import { useSearchParams } from "next/navigation";
import { useServiceCatalog } from "@/hooks/useCatalog";
import PosterRail from "./PosterRail";
import { PageSkeleton } from "./LoadingSkeleton";

export default function ServiceRail() {
  const searchParams = useSearchParams();
  const service = searchParams.get("service");
  const { movies, series, loading } = useServiceCatalog(service);

  if (!service) return null;
  if (loading) return <PageSkeleton />;

  const sortedMovies = [...movies].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  const sortedSeries = [...series].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));

  return (
    <div className="pt-4">
      {sortedMovies.length > 0 && (
        <PosterRail title={`${service} Movies`} items={sortedMovies} kind="movie" />
      )}
      {sortedSeries.length > 0 && (
        <PosterRail title={`${service} Series`} items={sortedSeries} kind="series" />
      )}
    </div>
  );
}