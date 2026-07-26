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
    {
      id: process.env.NEXT_PUBLIC_BUILD_ID || process.env.VERCEL_DEPLOYMENT_ID || "dev",
      // Identity of the code in this build with data/ excluded (see next.config.ts).
      // Not used by the client — the nightly workflow reads it to decide whether
      // anything other than the link data changed, and skips the deploy when
      // nothing did. Empty on builds made before this shipped.
      code: process.env.DEPLOY_CODE_ID || "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
