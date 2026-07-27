import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

/**
 * Proxies a backend channel logo.
 *
 * MUST NOT relay non-images. The backend's /static/channel-logos/<file> answers
 * with its HTML login page and HTTP **200** — not a 404 — so `res.ok` was true
 * and an 18KB HTML document went back to the browser labelled as a logo.
 * Measured 2026-07-27: that happened for every channel sampled (6/6, a
 * byte-identical 18438-byte body), i.e. this endpoint essentially never
 * returned a real image.
 *
 * An <img> pointed at HTML is the "just a question mark" reported on mobile. It
 * is also the worst possible failure shape for LogoImage's fallback chain: a
 * 200 does not reliably fire onError (Chromium does, older WebKit does not), so
 * the chain never advances to the text-initials fallback and the broken glyph
 * is final. Returning 404 for anything that isn't an image makes the failure
 * honest and lets the chain do its job.
 */
function isImage(contentType: string | null): boolean {
  return Boolean(contentType && contentType.toLowerCase().startsWith("image/"));
}

/** Relay a fetched response only when it really is an image. */
async function imageOr404(res: Response): Promise<NextResponse | null> {
  if (!res.ok) return null;
  const ct = res.headers.get("content-type");
  if (!isImage(ct)) return null;
  const blob = await res.blob();
  // An empty body is not a usable logo either — treat it as a miss.
  if (blob.size === 0) return null;
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": ct as string,
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  const cookie = request.headers.get("cookie") || "";

  // Primary: the filename off the backend's static logo path.
  const filename = url.split("/").pop();
  const staticUrl = `${BACKEND}/static/channel-logos/${filename}`;

  try {
    const primary = await imageOr404(
      await fetch(staticUrl, { headers: { Cookie: cookie }, redirect: "follow" }),
    );
    if (primary) return primary;

    // Fallback: the original URL, in case the static path doesn't carry it.
    const fallback = await imageOr404(
      await fetch(url, { headers: { Cookie: cookie }, redirect: "follow" }),
    );
    if (fallback) return fallback;
  } catch {
    // A network failure is a miss like any other — fall through to 404 so the
    // client's fallback chain advances instead of hanging on a broken image.
  }

  return new NextResponse("Not found", { status: 404 });
}
