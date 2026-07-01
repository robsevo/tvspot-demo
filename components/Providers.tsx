"use client";

import { AuthProvider } from "@/hooks/useAuth";
import { PlayerProvider } from "@/hooks/usePlayer";

/**
 * Client provider tree, split out of the (now server-rendered) root layout so the
 * server can read the auth cookie and hand the resolved username straight to
 * AuthProvider — no client /api/auth/me round-trip, no blank auth-gate flash.
 */
export default function Providers({
  initialUsername,
  children,
}: {
  initialUsername: string | null;
  children: React.ReactNode;
}) {
  return (
    <AuthProvider initialUsername={initialUsername}>
      <PlayerProvider>{children}</PlayerProvider>
    </AuthProvider>
  );
}
