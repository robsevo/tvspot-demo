import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  // Only allow TMDB and example.com image URLs
  if (!url.startsWith("https://image.tmdb.org/") && !url.startsWith("https://example.com/")) {
    return new NextResponse("Invalid source", { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TVSpot/1.0",
        Cookie: request.headers.get("cookie") || "",
      },
    });

    if (!res.ok) return new NextResponse("Not found", { status: 404 });

    const blob = await res.blob();
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new NextResponse("Error", { status: 500 });
  }
}