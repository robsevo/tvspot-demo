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
  response.headers.set("Cache-Control", "no-store");

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