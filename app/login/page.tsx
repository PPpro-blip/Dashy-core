"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * DashyCore — Authentication
 * Executive dark mode sign-in screen. Google OAuth only.
 */

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // On success the browser is redirected to Google — no further action.
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#09090b] px-6 py-16">
      {/* Subtle background grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse 75% 65% at 50% 45%, black 25%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 65% at 50% 45%, black 25%, transparent 78%)",
        }}
      />

      {/* Ambient radial glow behind the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-indigo-500/10 via-sky-500/5 to-transparent blur-3xl"
      />

      {/* Content column */}
      <div className="relative z-10 w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 flex items-center justify-center gap-3">
          {/* Geometric logo mark — glowing core diamond */}
          <svg viewBox="0 0 36 36" className="h-9 w-9" aria-hidden="true">
            <defs>
              <linearGradient id="dc-edge" x1="0" y1="0" x2="36" y2="36">
                <stop stopColor="#818cf8" />
                <stop offset="1" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
            <path
              d="M18 2 34 18 18 34 2 18Z"
              fill="none"
              stroke="url(#dc-edge)"
              strokeWidth="1.5"
            />
            <path d="M18 9 27 18 18 27 9 18Z" fill="#18181b" />
            <circle cx="18" cy="18" r="3.5" fill="#a5b4fc" />
            <circle cx="18" cy="18" r="6" fill="#818cf8" opacity="0.35" />
          </svg>
          <span className="text-lg font-semibold tracking-tight text-neutral-100">
            DashyCore
          </span>
        </div>

        {/* Centerpiece glass card */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-2xl shadow-black/80 backdrop-blur-xl transition-colors hover:border-neutral-700/80 md:p-10">
          {/* Headline */}
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Where intelligence comes together.
          </h1>

          {/* Subtitle */}
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            Unified AI workspace with persistent memory and model routing.
          </p>

          {/* Divider */}
          <div className="my-8 h-px w-full bg-gradient-to-r from-transparent via-neutral-800 to-transparent" />

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-medium text-neutral-950 shadow-md shadow-white/5 transition-all hover:bg-neutral-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
                />
                <span>Redirecting to Google…</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
                  />
                </svg>
                <span>Continue with Google</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 text-neutral-500"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs leading-relaxed text-red-300"
            >
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
