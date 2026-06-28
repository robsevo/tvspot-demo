"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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
            className="w-full bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors"
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
              className="w-full bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors pr-10"
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
              className="w-full bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-text-muted focus:outline-none focus:border-brand/50 transition-colors pr-10"
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
          className="w-full bg-brand text-white font-semibold py-3 rounded-xl text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}