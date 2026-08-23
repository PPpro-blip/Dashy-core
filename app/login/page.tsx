"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * DashyCore — Authentication
 * Structural / editorial dark design. Google OAuth only.
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-neutral-950 px-6">
      {/* Ambient glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-cyan-500/[0.07] blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 right-[-10%] h-[420px] w-[560px] rounded-full bg-purple-500/[0.07] blur-[120px]"
      />

      {/* Structural grid lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)",
        }}
      />

      {/* Corner technical markers */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-6 hidden sm:block">
        <span className="absolute left-0 top-0 h-4 w-4 border-l border-t border-neutral-800" />
        <span className="absolute right-0 top-0 h-4 w-4 border-r border-t border-neutral-800" />
        <span className="absolute bottom-0 left-0 h-4 w-4 border-b border-l border-neutral-800" />
        <span className="absolute bottom-0 right-0 h-4 w-4 border-b border-r border-neutral-800" />
      </div>

      {/* Central structured card */}
      <section className="relative z-10 w-full max-w-md">
        {/* Technical header line */}
        <div className="animate-fade-in-up mb-10 flex items-center gap-3 font-mono text-[11px] tracking-[0.25em] text-neutral-500 uppercase">
          <span className="text-cyan-400">00</span>
          <span className="h-px flex-1 bg-neutral-800" />
          <span>Authentication</span>
        </div>

        <div className="animate-fade-in-up delay-100 rounded-2xl border border-neutral-800/80 bg-neutral-900/40 p-8 shadow-[0_0_80px_rgba(0,0,0,0.6)] backdrop-blur-sm sm:p-10">
          {/* Brand mark */}
          <div className="mb-8 flex items-center gap-3">
            <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden="true">
              <defs>
                <linearGradient id="brand-grad" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#00f2fe" />
                  <stop offset="1" stopColor="#9b51e0" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="8" fill="url(#brand-grad)" />
              <path
                d="M10 22V14l3.5 0 3.2 7 3.2-7H23v8h-3v-7l-3 6h-3l-3-6v7z"
                fill="#0a0a0b"
              />
            </svg>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight text-neutral-50">
                DashyCore
              </p>
              <p className="font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase">
                v7 · Preview
              </p>
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight text-neutral-50 sm:text-4xl">
            Initialize
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-neutral-100 to-purple-300 bg-clip-text text-transparent">
              your workspace.
            </span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            One identity, every model. Sign in to route through the DASH
            pipeline with your memory intact.
          </p>

          {/* Divider */}
          <div className="my-8 flex items-center gap-4" aria-hidden="true">
            <span className="h-px flex-1 bg-neutral-800" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-neutral-600 uppercase">
              System / Initialize
            </span>
            <span className="h-px flex-1 bg-neutral-800" />
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="group relative flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-700/80 bg-neutral-900 px-5 py-3.5 text-sm font-medium text-neutral-100 transition-all duration-200 hover:border-cyan-400/50 hover:bg-neutral-800/80 hover:shadow-[0_0_24px_rgba(0,242,254,0.12)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-cyan-400"
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
                  className="h-4 w-4 text-neutral-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-cyan-400"
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
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer technical line */}
        <div className="animate-fade-in-up delay-200 mt-8 flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-neutral-600 uppercase">
          <span>Secure · OAuth 2.0</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            System online
          </span>
        </div>
      </section>
    </main>
  );
}