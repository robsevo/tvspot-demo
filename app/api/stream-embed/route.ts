import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${BACKEND}/stream-embed${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "text/html" },
  });
}