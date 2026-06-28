import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${BACKEND}/stream-success${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Cookie: request.headers.get("cookie") || "",
    },
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const body = await request.text();
  const url = `${BACKEND}/stream-success${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: request.headers.get("cookie") || "",
    },
    body: body || '{}',
  });
  const responseBody = await res.text();
  return new NextResponse(responseBody, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}