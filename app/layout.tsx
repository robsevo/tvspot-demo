"use client";

import { AuthProvider } from "@/hooks/useAuth";
import { PlayerProvider } from "@/hooks/usePlayer";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48" />
        <link rel="shortcut icon" href="/favicon-48.png" type="image/png" />
        {/* PNG apple-touch-icon (180x180, opaque) — iOS requires PNG, not SVG,
            for the add-to-home-screen icon. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="TVSpot" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="bg-surface text-white antialiased">
        <ServiceWorkerRegister />
        <AuthProvider>
          <PlayerProvider>
            {children}
          </PlayerProvider>
        </AuthProvider>
      </body>
    </html>
  );
}