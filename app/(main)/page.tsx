import { Suspense } from "react";
import { headers } from "next/headers";
import HomeClient from "./HomeClient";
import { PageSkeleton } from "@/components/LoadingSkeleton";
import type { CatalogItem } from "@/lib/types";

/**
 * Server-fetch the trending catalog and hand it to the client already resolved.
 * This runs inside a <Suspense> boundary so the chrome + skeleton stream instantly
 * (TTFB unaffected) while this heavier fetch completes; the rails then stream into
 * the SAME response as real HTML — no separate browser→proxy round-trip, and the
 * fetch is server-to-server (Vercel→backend) instead of browser→Vercel→backend.
 */
async function HomeData() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("host");
  let movies: CatalogItem[] = [];
  let series: CatalogItem[] = [];
  try {
    const res = await fetch(`${proto}://${host}/api/lounge/catalog?trending=true`, {
      headers: { cookie: h.get("cookie") || "" },
      cache: "no-store",
      // Warm catalog cache returns in ~200ms → rails render server-side. A COLD
      // cache can take 20s+ (dozens of TMDB calls); don't hold the SSR (or risk a
      // function timeout) for that — bail and let HomeClient fetch it client-side.
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      movies = data.movies || [];
      series = data.series || [];
    }
  } catch {
    // Backend/enrichment hiccup — render with empty rails (same as the old client
    // fetch's catch path) rather than failing the page.
  }
  return <HomeClient initialMovies={movies} initialSeries={series} />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomeData />
    </Suspense>
  );
}
