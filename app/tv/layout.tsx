"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { TvNavProvider } from "@/components/tv/TvNav";
import TvTopNav from "@/components/tv/TvTopNav";
import { registerTvKeys } from "@/lib/tv";

/**
 * Shell for the 10-foot (Samsung TV / D-pad) experience. Same app, same auth,
 * same data layer as mobile — different input model and information density.
 * The Tizen .wgt wrapper (see tizen/) opens the hosted /tv URL, so everything
 * server-side (middleware auth, /api proxy, stream checks) works unchanged.
 */
export default function TvLayout({ children }: { children: React.ReactNode }) {
  const { username, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLogin = pathname === "/tv/login";

  // Opt into the remote's media/channel keys (no-op outside the Tizen runtime).
  useEffect(() => {
    registerTvKeys();
  }, []);

  useEffect(() => {
    if (!isLogin && !loading && !username) {
      // The TV login silently re-logs-in with remembered credentials before
      // ever showing its form, so this bounce is invisible in the common case.
      router.replace("/tv/login");
    }
  }, [isLogin, username, loading, router]);

  // Full-screen player pages own the whole panel — no nav chrome over video.
  const isPlayerPage = pathname.startsWith("/tv/live/") && pathname !== "/tv/live";
  const showNav = !isLogin && !isPlayerPage;

  if (!isLogin && (loading || !username)) {
    return (
      <div className="tv-root min-h-screen bg-surface flex items-center justify-center">
        <img src="/tvspot-logo.svg" alt="TVSpot" className="w-24 h-24 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="tv-root min-h-screen bg-surface text-white overflow-x-hidden">
      <TvNavProvider>
        {showNav && <TvTopNav />}
        <main>{children}</main>
      </TvNavProvider>
    </div>
  );
}
