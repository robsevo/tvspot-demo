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
    <div className="flex gap-2 overflow-hidden px-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex-shrink-0 w-[120px]">
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
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] bg-card rounded" />
        ))}
      </div>
    </div>
  );
}