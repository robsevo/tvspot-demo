"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCatalog, prewarmService } from "@/hooks/useCatalog";
import { useTvBack } from "@/components/tv/TvNav";
import TvProviderBrowse from "@/components/tv/TvProviderBrowse";

/** Service-first VOD: a Prime-style provider picker, then the hero+rails browse
 *  chassis once a provider is chosen. The chosen provider lives in the URL
 *  (?service=) so the header's quick links deep-link straight in and Back
 *  returns to the picker. */
function TvVodInner() {
  const router = useRouter();
  const params = useSearchParams();
  const service = params.get("service");
  const { services, summary, loading, error, refetch } = useCatalog();

  // Inside a provider, Back returns to the picker (drop the query); at the
  // picker the default (router.back → home) applies.
  useTvBack(service ? () => router.push("/tv/vod") : null);

  if (service) return <TvProviderBrowse service={service} />;

  return (
    <div className="px-16 pb-16">
      <h1 className="text-4xl font-bold text-white pt-2 mb-8">Movies &amp; Shows</h1>

      {loading && services.length === 0 ? (
        <p className="py-10 text-xl text-[#8197a4]">
          Loading providers… the first load after a quiet day can take a minute.
        </p>
      ) : services.length === 0 ? (
        <div className="py-10">
          <p className="text-xl text-[#aebbc5] mb-6">
            {error ? "Couldn't load the providers." : "No providers available."}
          </p>
          <button
            data-tv
            data-tv-autofocus
            onClick={() => refetch()}
            className="px-8 py-3 rounded-full bg-white text-black text-lg font-semibold focus:outline-none"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {services.map((svc, i) => {
            const s = summary[svc];
            const counts = [
              s?.movies_count ? `${s.movies_count} movies` : null,
              s?.series_count ? `${s.series_count} series` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={svc}
                data-tv
                {...(i === 0 ? { "data-tv-autofocus": true } : {})}
                onClick={() => router.push(`/tv/vod?service=${encodeURIComponent(svc)}`)}
                onFocus={() => prewarmService(svc)}
                className="text-left rounded-xl bg-[#141d28] ring-1 ring-white/10 px-8 py-7 focus:outline-none"
              >
                <p className="text-2xl font-bold text-white">{svc}</p>
                {counts && <p className="text-lg text-[#8197a4] mt-1">{counts}</p>}
                {typeof s?.preview === "string" ? (
                  <p className="text-base text-[#5f7180] mt-3 line-clamp-2">{s.preview}</p>
                ) : s?.preview?.length ? (
                  <div className="flex gap-2 mt-4 overflow-hidden">
                    {s.preview.slice(0, 3).map(
                      (p, j) =>
                        p.poster && (
                          <img
                            key={p.tmdb_id ?? j}
                            src={p.poster}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-16 h-24 rounded object-cover ring-1 ring-white/10"
                          />
                        ),
                    )}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TvVodPage() {
  return (
    <Suspense fallback={<p className="px-16 py-10 text-xl text-[#8197a4]">Loading…</p>}>
      <TvVodInner />
    </Suspense>
  );
}
