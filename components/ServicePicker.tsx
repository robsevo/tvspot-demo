"use client";

import { useCatalog } from "@/hooks/useCatalog";
import { LogoImage } from "./LogoImage";

const serviceColors: Record<string, string> = {
  "Netflix": "from-violet-800 to-violet-950",
  "Disney+": "from-blue-700 to-blue-950",
  "HBO Max": "from-violet-700 to-indigo-950",
  "Paramount+": "from-blue-500 to-violet-900",
  "Prime Video": "from-sky-500 to-blue-800",
  "Apple TV+": "from-zinc-700 to-zinc-950",
  "Hulu": "from-green-500 to-emerald-800",
  "Peacock": "from-teal-500 to-cyan-800",
  "Crave": "from-purple-600 to-pink-900",
  "Other": "from-zinc-600 to-zinc-900",
  "Classics": "from-amber-600 to-yellow-900",
  "Theater": "from-violet-800 to-violet-950",
};

export default function ServicePicker({ onSelectAction }: { onSelectAction: (service: string) => void }) {
  const { services, summary, loading } = useCatalog();
  const handler = onSelectAction;

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 px-4 pt-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-32 hud-skeleton rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 px-4 stagger-children">
      {services.map((service) => {
        const s = summary[service];
        const gradient = serviceColors[service] || "from-brand to-violet-950";
        // Backend summaries carry a few sample items — use the first poster as a
        // backdrop so each provider card previews its content (virtual services
        // use a description string, so guard with Array.isArray).
        const previewPoster = Array.isArray(s?.preview)
          ? s.preview.find((p) => p?.poster)?.poster
          : undefined;
        return (
          <button
            key={service}
            onClick={() => handler(service)}
            className="hud-card hud-corners relative rounded-2xl h-32 flex flex-col justify-between overflow-hidden text-left ring-1 ring-white/5"
          >
            {/* Poster backdrop */}
            {previewPoster && (
              <img
                src={previewPoster}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            {/* Brand gradient wash (over the poster, keeps text legible) */}
            <div className={`absolute inset-0 bg-gradient-to-br ${gradient} ${previewPoster ? "opacity-80" : ""}`} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

            {/* Content */}
            <div className="relative z-10 p-4 flex flex-col justify-between h-full">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-sm overflow-hidden p-1.5">
                <LogoImage name={service} className="w-full h-full object-contain" />
              </div>
              <div>
                <span className="text-white text-sm font-bold block leading-tight drop-shadow">{service}</span>
                <span className="text-white/75 text-[11px]">
                  {s?.movies_count || 0} movies · {s?.series_count || 0} series
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
