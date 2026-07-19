import { cookies } from "next/headers";
import { readFileSync } from "fs";
import { join } from "path";
import { verifyToken } from "@/lib/auth";
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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0a0a0a" />
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
