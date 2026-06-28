import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${BACKEND}/stream-resolve${qs ? `?${qs}` : ""}`;

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
  response.headers.set("Cache-Control", "no-store");
  const ct = res.headers.get("content-type");
  if (ct) response.headers.set("Content-Type", ct);
  return response;
}