"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff, Smartphone, ChevronDown, Share, MoreVertical } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password, secretWord);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-surface">
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4">
          <img src="/tvspot-logo.svg" alt="TVSpot" className="w-14 h-14 drop-shadow-lg" />
        </div>
        <h1 className="text-2xl font-bold text-white">TVSpot</h1>
        <p className="text-text-muted text-sm mt-1">Sign in to continue</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <label className="text-xs text-text-muted font-medium mb-1.5 block">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-base placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors"
            placeholder="Enter username"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="text-xs text-text-muted font-medium mb-1.5 block">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-base placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors pr-10"
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-text-muted font-medium mb-1.5 block">Secret Word</label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={secretWord}
              onChange={(e) => setSecretWord(e.target.value)}
              className="w-full bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-base placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors pr-10"
              placeholder="Enter secret word"
              required
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
              tabIndex={-1}
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-brand text-xs text-center animate-fade-in">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed btn-depth"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      {/* How to install to home screen — collapsed by default */}
      <div className="w-full max-w-sm mt-6">
        <button
          type="button"
          onClick={() => setShowInstall((v) => !v)}
          className="w-full flex items-center justify-between text-text-muted text-xs font-medium px-1 py-2 hover:text-text-secondary transition-colors"
          aria-expanded={showInstall}
        >
          <span className="flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5" /> How to get the app
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showInstall ? "rotate-180" : ""}`} />
        </button>

        {showInstall && (
          <div className="mt-1 rounded-xl bg-card border border-white/10 p-4 space-y-3 text-xs animate-fade-in">
            <p className="text-text-secondary">
              Install TVSpot to your home screen for a full-screen, app-like experience.
            </p>

            <div>
              <p className="text-white font-semibold mb-1 flex items-center gap-1.5">
                <Share className="w-3.5 h-3.5" /> iPhone / iPad (Safari)
              </p>
              <ol className="text-text-muted space-y-0.5 list-decimal list-inside">
                <li>Tap the <span className="text-text-secondary">Share</span> button in the toolbar.</li>
                <li>Scroll down and tap <span className="text-text-secondary">Add to Home Screen</span>.</li>
                <li>Tap <span className="text-text-secondary">Add</span> in the top-right.</li>
              </ol>
            </div>

            <div>
              <p className="text-white font-semibold mb-1 flex items-center gap-1.5">
                <MoreVertical className="w-3.5 h-3.5" /> Android (Chrome)
              </p>
              <ol className="text-text-muted space-y-0.5 list-decimal list-inside">
                <li>Tap the <span className="text-text-secondary">⋮</span> menu in the top-right.</li>
                <li>Tap <span className="text-text-secondary">Add to Home screen</span> or <span className="text-text-secondary">Install app</span>.</li>
                <li>Tap <span className="text-text-secondary">Add</span> / <span className="text-text-secondary">Install</span> to confirm.</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}