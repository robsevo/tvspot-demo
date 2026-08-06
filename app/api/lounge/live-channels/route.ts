import { NextRequest, NextResponse } from "next/server";
import { getChannelSourcesMap } from "@/lib/channelSources";

/**
 * live-channels, with the nightly-verified links attached server-side.
 *
 * This shadows the generic proxy at app/api/lounge/[...path]/route.ts for this
 * one path (a static segment wins over a catch-all). Everything else about the
 * proxy behaviour is preserved deliberately — cookie forwarding, status/CT
 * pass-through, `no-store` (the payload carries rotating tokenized stream URLs),
 * and the permissive CORS header the TV wrapper relies on.
 *
 * The enrichment is the point: `channel.verified_sources` is how the players get
 * the freshness pipeline's links now that they are no longer compiled into a
 * client chunk (see lib/linkData.ts for why). Attaching them here costs no extra
 * round-trip — the players already fetch this route through useChannels().
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${BACKEND}/lounge/live-channels${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { Cookie: request.headers.get("cookie") || "" },
  });

  const body = await res.text();
  const ct = res.headers.get("content-type");

  const respond = (payload: string) => {
    const response = new NextResponse(payload, {
      status: res.status,
      statusText: res.statusText,
    });
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Cache-Control", "no-store");
    if (ct) response.headers.set("Content-Type", ct);
    return response;
  };

  // Anything that isn't a healthy JSON channel list goes back untouched — the
  // 503 `channels_warming` body in particular, which useChannels() retries on.
  if (!res.ok || !ct?.includes("application/json")) return respond(body);

  try {
    const data = JSON.parse(body);
    const channels = data?.channels;
    if (!Array.isArray(channels)) return respond(body);

    const { urls, confidence } = await getChannelSourcesMap(
      channels.map((c: { name?: string }) => c?.name).filter((n: unknown): n is string => typeof n === "string"),
    );

    return respond(
      JSON.stringify({
        ...data,
        channels: channels.map((c: { name?: string }) =>
          c?.name && urls[c.name]
            ? {
                ...c,
                verified_sources: urls[c.name],
                // The pipeline's own confidence in those links. Lets the player
                // pull the waiting bench IMMEDIATELY on a thin channel instead of
                // discovering it the slow way — see useLiveSources.
                source_confidence: confidence[c.name],
              }
            : c,
        ),
      }),
    );
  } catch {
    // Malformed JSON from the backend — pass it through rather than inventing a
    // shape the client doesn't expect.
    return respond(body);
  }
}
