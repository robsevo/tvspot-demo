import { NextResponse } from "next/server";

// Identifies the running deployment so the client can detect a new deploy and
// reload at a HARMLESS moment (backgrounded / re-opened / idle) instead of
// Next's default: a hard mid-navigation reload the first time an open app
// touches a route after a deploy ("the site broke and rebuilt").
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { id: process.env.VERCEL_DEPLOYMENT_ID || "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
