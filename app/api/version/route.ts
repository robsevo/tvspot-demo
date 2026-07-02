import { NextResponse } from "next/server";

// Identifies the running deployment so the client can detect a new deploy and
// reload at a HARMLESS moment (backgrounded / re-opened / idle) instead of
// Next's default: a hard mid-navigation reload the first time an open app
// touches a route after a deploy ("the site broke and rebuilt").
//
// The id is the BUILD-baked commit sha (see next.config.ts), not a runtime
// env: the client compares it against its own baked copy, so a stale page —
// including one resurrected from the service worker's shell cache — always
// sees the mismatch, no matter how it got loaded.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { id: process.env.NEXT_PUBLIC_BUILD_ID || process.env.VERCEL_DEPLOYMENT_ID || "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
