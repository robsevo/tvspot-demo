import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join("/");
  const qs = request.nextUrl.searchParams.toString();
  const url = `${BACKEND}/lounge/${pathStr}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: {
      Cookie: request.headers.get("cookie") || "",
    },
  });

  const body = await res.text();
  const response = new NextResponse(body, {
    status: res.status,
    statusText: res.statusText,
  });

  response.headers.set("Access-Control-Allow-Origin", "*");
  // The EPG is identical for every user and slow-moving, so let Vercel's edge
  // cache absorb backend restarts: s-maxage serves it CDN-side for 15 min and
  // stale-while-revalidate keeps serving the last good guide for up to a day
  // while the box is down/warming. max-age=0 keeps browsers revalidating to
  // the edge. Auth still runs per-request in middleware BEFORE the cache, and
  // only 200s get the cacheable header. Everything else stays no-store —
  // live-channels carries rotating tokenized stream URLs.
  if (pathStr === "epg" && res.ok) {
    response.headers.set(
      "Cache-Control",
      "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
    );
  } else {
    response.headers.set("Cache-Control", "no-store");
  }

  const ct = res.headers.get("content-type");
  if (ct) response.headers.set("Content-Type", ct);

  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join("/");
  const qs = request.nextUrl.searchParams.toString();
  const url = `${BACKEND}/lounge/${pathStr}${qs ? `?${qs}` : ""}`;

  const body = await request.text();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: request.headers.get("cookie") || "",
    },
    body,
  });

  const responseBody = await res.text();
  const response = new NextResponse(responseBody, {
    status: res.status,
    statusText: res.statusText,
  });

  response.headers.set("Access-Control-Allow-Origin", "*");

  const ct = res.headers.get("content-type");
  if (ct) response.headers.set("Content-Type", ct);

  return response;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}