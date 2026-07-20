"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, AuthUnreachableError } from "@/hooks/useAuth";
import { saveTvCreds, loadTvCreds, clearTvCreds } from "@/lib/tvCreds";
import { Check } from "lucide-react";

/**
 * TV login. Two jobs:
 *  1. Silent re-login: if "Remember on this TV" credentials exist, replay them
 *     before showing anything — the nightly 4 AM logout becomes invisible on
 *     the TV. Only a FAILED replay (credentials rotated) shows the form.
 *  2. The form itself, remote-friendly: big fields, D-pad focus, Samsung's
 *     on-screen keyboard appears for a focused input on its own.
 */
export default function TvLoginPage() {
  const { login, username: authed } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Until the silent replay settles, show only the splash — no form flash.
  const [autoTrying, setAutoTrying] = useState(true);
  const autoFired = useRef(false);

  // Already signed in (e.g. navigated here by hand) → straight to the shell.
  useEffect(() => {
    if (authed) router.replace("/tv");
  }, [authed, router]);

  useEffect(() => {
    if (autoFired.current) return;
    autoFired.current = true;
    const creds = loadTvCreds();
    if (!creds) {
      setAutoTrying(false);
      return;
    }
    login(creds.username, creds.password, creds.secretWord)
      .then(() => router.replace("/tv"))
      .catch((err: unknown) => {
        // Only a REJECTED replay means the credentials rotated. An unreachable
        // backend — routine on this TV, whose network stack often isn't up at
        // cold launch — says nothing about them, so keep them and let the user
        // retry rather than making them retype a password on a remote.
        if (err instanceof AuthUnreachableError) {
          setError("Couldn't reach TVSpot. Check the TV's network, then sign in.");
        } else {
          clearTvCreds();
        }
        setAutoTrying(false);
      });
  }, [login, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password, secretWord);
      if (remember) saveTvCreds({ username, password, secretWord });
      router.replace("/tv");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  if (autoTrying) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-surface">
        <img src="/tvspot-logo.svg" alt="TVSpot" className="w-24 h-24 animate-pulse" />
        <p className="text-text-secondary text-2xl">Signing you in…</p>
      </div>
    );
  }

  const fieldClass =
    "w-full bg-card border border-white/10 rounded-xl px-6 py-4 text-white text-2xl placeholder:text-text-muted focus:border-accent focus:outline-none transition-colors";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 bg-surface">
      <div className="flex flex-col items-center mb-10">
        <img src="/tvspot-logo.svg" alt="TVSpot" className="w-20 h-20 mb-4 drop-shadow-lg" />
        <h1 className="text-4xl font-bold text-white">TVSpot</h1>
        <p className="text-text-muted text-xl mt-2">Sign in on this TV</p>
      </div>

      {/* flex+gap, not space-y: Tailwind v4 compiles space-* with :where(),
          which the TV's Chromium 63 drops — gap has a legacy fallback. */}
      <form onSubmit={handleSubmit} className="w-full max-w-xl flex flex-col gap-6">
        <div>
          <label className="text-lg text-text-muted font-medium mb-2 block">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={fieldClass}
            placeholder="Username"
            autoComplete="username"
            data-tv
            data-tv-autofocus
            required
          />
        </div>

        <div>
          <label className="text-lg text-text-muted font-medium mb-2 block">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
            placeholder="Password"
            autoComplete="current-password"
            data-tv
            required
          />
        </div>

        <div>
          <label className="text-lg text-text-muted font-medium mb-2 block">Secret Word</label>
          <input
            type="password"
            value={secretWord}
            onChange={(e) => setSecretWord(e.target.value)}
            className={fieldClass}
            placeholder="Secret word"
            data-tv
            required
          />
        </div>

        <button
          type="button"
          data-tv
          onClick={() => setRemember((v) => !v)}
          className="flex items-center gap-3 text-xl text-text-secondary py-2 px-1"
        >
          <span
            className={`w-7 h-7 rounded-md border-2 flex items-center justify-center ${
              remember ? "bg-brand border-brand" : "border-white/30"
            }`}
          >
            {remember && <Check className="w-5 h-5 text-white" />}
          </span>
          Remember on this TV (signs back in automatically)
        </button>

        {error && <p className="text-red-400 text-xl text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          data-tv
          className="w-full bg-brand text-white font-semibold py-5 rounded-xl text-2xl disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
