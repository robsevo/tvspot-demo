import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("tvspot_session")?.value;
  if (!token) {
    return NextResponse.json({ username: null });
  }
  const payload = await verifyToken(token);
  return NextResponse.json({ username: payload?.username ?? null });
}