import type { Viewport } from "next";
import { cookies, headers } from "next/headers";
import { readFileSync } from "fs";
import { join } from "path";
import { verifyToken } from "@/lib/auth";
import { TV_UA_RE } from "@/lib/tv";

/**
 * TVs get a FIXED 1920px layout viewport instead of width=device-width.
 *
 * The /tv UI is authored against 1920 CSS px (the pane heights, the px-16
 * gutters, the poster budget in TvBrowseScreen all assume it), and whether
 * device-width yields 1920 depends on the panel's DENSITY. The Samsung TV is
 * 1920x1080 @160dpi, so device-width IS 1920 and it looks right — but a Fire TV
 * Stick is 1920x1080 @320dpi, so device-width is 960 and every one of those
 * measurements renders at DOUBLE size. Verified on an AFTT stick.
 *
 * Pinning 1920 makes the layout viewport density-independent; the WebView then
 * scales it to the real window — 1:1 on Samsung, 0.5 dip/px on the stick, which
 * is one CSS px per PHYSICAL px, so it gets sharper rather than blurrier.
 * Phones are untouched.
 *
 * This MUST be generateViewport() rather than a hand-written <meta> in <head>:
 * Next emits its own viewport tag regardless, and since it lands AFTER ours in
 * the document the browser takes Next's and silently discards the override.
 * (Seen in the deployed HTML: two viewport metas, ours first, so the TV kept
 * laying out at 960 even though the served markup "looked" correct.)
 */
export async function generateViewport(): Promise<Viewport> {
  const ua = (await headers()).get("user-agent") ?? "";
  const isTv = TV_UA_RE.test(ua);
  return {
    width: isTv ? 1920 : "device-width",
    ...(isTv ? {} : { initialScale: 1 }),
    viewportFit: "cover",
    themeColor: "#0a0a0a",
  };
}
import Providers from "@/components/Providers";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import DeployRefresh from "@/components/DeployRefresh";
import "./globals.css";

// Read once per server process. INLINED (not <script src>) on purpose: React 19
// hoists src-scripts into <head> as ASYNC resources, so the polyfill raced
// Next's chunks and lost on chunk-heavy full loads — on the 2019 TV that meant
// "globalThis is not defined" at chunk line 1 and dead VOD pages/EPG. Inline
// scripts are never deferred, so this is guaranteed to run first.
const tvPolyfills = readFileSync(
  join(process.cwd(), "public", "tv-polyfills.js"),
  "utf8",
);

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the user on the SERVER from the already-verified auth cookie, so the
  // HTML ships with the app chrome + username instead of a blank shell that waits
  // on a client /api/auth/me round-trip. Middleware has already redirected
  // invalid/absent tokens on protected routes; here it just seeds the client.
  const token = (await cookies()).get("tvspot_session")?.value;
  const initialUsername = token ? (await verifyToken(token))?.username ?? null : null;


  return (
    <html lang="en">
      <head>
        {/* viewport + theme-color come from generateViewport() above — Next
            emits those tags itself, and a hand-written one is overridden. */}
        {/* MUST precede the app bundles: shims runtime APIs the 2019 Samsung
            TV webview (Chromium 63) lacks. Feature-detected — a no-op on
            phones. Inlined because React hoists src-scripts as async and they
            can lose the race against Next's chunks (see tvPolyfills above). */}
        <script dangerouslySetInnerHTML={{ __html: tvPolyfills }} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48" />
        <link rel="shortcut icon" href="/favicon-48.png" type="image/png" />
        {/* PNG apple-touch-icon (180x180, opaque) — iOS requires PNG, not SVG,
            for the add-to-home-screen icon. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="TVSpot" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="bg-surface text-white antialiased">
        <ServiceWorkerRegister />
        <DeployRefresh />
        <Providers initialUsername={initialUsername}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
