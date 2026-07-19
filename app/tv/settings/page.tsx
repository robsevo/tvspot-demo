"use client";

import { useRouter } from "next/navigation";
import { LogOut, Power } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { exitTvApp } from "@/lib/tv";

/** The side menu's Settings: who's signed in, sign out, and exit — the only
 *  account controls a 10-foot app needs. */
export default function TvSettingsPage() {
  const { username, logout } = useAuth();
  const router = useRouter();

  const signOut = async () => {
    await logout();
    router.replace("/tv/login");
  };

  const initial = (username || "?").charAt(0).toUpperCase();

  return (
    <div className="px-16 pb-16 max-w-2xl">
      <h1 className="text-4xl font-bold text-white pt-2 mb-8">Settings</h1>

      <div className="flex items-center gap-5 mb-10">
        <span className="w-16 h-16 rounded-full bg-[#4a5ed4] flex items-center justify-center text-2xl font-bold text-white">
          {initial}
        </span>
        <div>
          <p className="text-2xl font-semibold text-white">{username || "Signed in"}</p>
          <p className="text-lg text-[#8197a4]">TVSpot account</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <button
          data-tv
          data-tv-autofocus
          onClick={signOut}
          className="tv-pill group flex items-center gap-4 bg-[#141d28] ring-1 ring-white/10 rounded-lg px-6 py-5 text-left focus:outline-none focus:bg-white"
        >
          <LogOut className="w-6 h-6 text-white group-focus:text-black" />
          <span className="text-xl text-white group-focus:text-black">Sign out</span>
        </button>

        <button
          data-tv
          onClick={() => exitTvApp()}
          className="tv-pill group flex items-center gap-4 bg-[#141d28] ring-1 ring-white/10 rounded-lg px-6 py-5 text-left focus:outline-none focus:bg-white"
        >
          <Power className="w-6 h-6 text-white group-focus:text-black" />
          <span className="text-xl text-white group-focus:text-black">Exit app</span>
        </button>
      </div>
    </div>
  );
}
