"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useLastRoute } from "@/hooks/useLastRoute";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import FloatingPlayer from "@/components/FloatingPlayer";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { username, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Make a full reload (mobile tab eviction) feel seamless: come back to the same
  // route, and the same scroll position, instead of a cold start on Home.
  useLastRoute();
  useScrollRestoration();

  useEffect(() => {
    if (!loading && !username) {
      router.replace("/login");
    }
  }, [username, loading, router]);

  if (loading) return null;
  if (!username) return null;

  const isVideoPage = pathname.startsWith("/live/") && pathname !== "/live";
  const showNav = !isVideoPage;

  return (
    <div className="min-h-screen bg-surface text-white">
      {showNav && <TopBar />}
      <main>
        {children}
      </main>
      {showNav && <BottomNav />}
      <FloatingPlayer />
    </div>
  );
}