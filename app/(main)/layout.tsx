"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import FloatingPlayer from "@/components/FloatingPlayer";
import ScrollToTop from "@/components/ScrollToTop";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { username, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Restore scroll position on a reload. Note: we deliberately do NOT restore the
  // last route on cold launch — reopening the app should land on Home (the PWA
  // start_url), not wherever you were.
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
      {showNav && <ScrollToTop />}
      <FloatingPlayer />
    </div>
  );
}