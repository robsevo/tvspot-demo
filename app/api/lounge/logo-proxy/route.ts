import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  // Extract the filename from the example.com URL and hit static via relay
  const filename = url.split("/").pop();
  const staticUrl = `${BACKEND}/static/channel-logos/${filename}`;

  const res = await fetch(staticUrl, {
    headers: {
      Cookie: request.headers.get("cookie") || "",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    // Fallback: try direct to example.com with auth
    const fallback = await fetch(url, {
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
      redirect: "follow",
    });
    if (!fallback.ok) {
      return new NextResponse("Not found", { status: 404 });
    }
    const blob = await fallback.blob();
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": fallback.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const blob = await res.blob();
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}