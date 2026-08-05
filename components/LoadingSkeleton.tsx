"use client";

interface Props {
  aspectRatio?: "video" | "poster";
}

export default function LoadingSkeleton({ aspectRatio = "poster" }: Props) {
  const ratio = aspectRatio === "poster" ? "aspect-[2/3]" : "aspect-video";
  return (
    <div className={`${ratio} bg-card rounded-lg animate-pulse`}>
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    </div>
  );
}

export function PosterRailSkeleton() {
  return (
    // Widths track PosterRail exactly — a skeleton card narrower than the real
    // one reflows the whole rail the moment content lands.
    <div className="flex gap-2.5 overflow-hidden px-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex-shrink-0 w-[48vw] sm:w-[210px] md:w-[236px] lg:w-[258px]">
          <LoadingSkeleton aspectRatio="poster" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-4">
      <div className="h-8 bg-card rounded w-1/3" />
      <div className="h-4 bg-card rounded w-2/3" />
      <div className="h-48 bg-card rounded" />
      {/* Matches CatalogBrowser's column count so the grid doesn't re-flow
          under the user when the real posters arrive. */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] bg-card rounded" />
        ))}
      </div>
    </div>
  );
}