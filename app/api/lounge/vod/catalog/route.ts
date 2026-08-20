import { NextRequest, NextResponse } from "next/server";
import { loadDemoVodCatalog, usingDemoCatalog } from "@/lib/demoCatalog";

/**
 * On-demand service summary: which catalogues exist and roughly what is in each.
 * Shadows the generic proxy so a deployment with no upstream still has a VOD tab
 * with something in it. With BACKEND_API_URL set this forwards unchanged.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(request: NextRequest) {
  if (usingDemoCatalog()) {
    const { services, summary } = await loadDemoVodCatalog();
    // "Classics" and "Theater" are assembled from TMDB, not from the catalogue.
    // Without a token they open empty, so say so here rather than letting the
    // client advertise two sections that lead nowhere. The client falls back to
    // its own list when this field is absent, so a real backend is unaffected.
    const virtual_services = process.env.TMDB_ACCESS_TOKEN ? ["Classics", "Theater"] : [];
    return NextResponse.json(
      { services, summary, virtual_services },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const qs = request.nextUrl.searchParams.toString();
  const res = await fetch(`${BACKEND}/lounge/vod/catalog${qs ? `?${qs}` : ""}`, {
    headers: { Cookie: request.headers.get("cookie") || "" },
  });
  const body = await res.text();
  const response = new NextResponse(body, { status: res.status, statusText: res.statusText });
  const ct = res.headers.get("content-type");
  if (ct) response.headers.set("Content-Type", ct);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
