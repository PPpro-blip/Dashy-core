"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * DashyCore — Authentication
 * Stark, executive, editorial dark mode. Google OAuth only.
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 px-6 py-16">
      {/* Central card */}
      <section className="w-full max-w-md border border-neutral-800 bg-[#0C0C0E] shadow-2xl shadow-black/80">
        {/* Card top label */}
        <div className="border-b border-neutral-800/70 px-8 py-4 sm:px-10">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-600">
            00 — Workspace Initialization
          </span>
        </div>

        <div className="px-8 py-12 sm:px-10 sm:py-14">
          {/* Brand mark */}
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-400">
            Dashycore
          </p>

          {/* Editorial headline */}
          <h1 className="mt-10 font-serif text-4xl leading-[1.1] tracking-tight text-neutral-100 sm:text-[2.75rem]">
            Make room
            <br />
            for intelligence.
          </h1>

          {/* Subhead */}
          <p className="mt-6 max-w-xs text-sm leading-relaxed text-neutral-500">
            One identity. Every model. RAG memory intact.
          </p>

          {/* Divider */}
          <div className="mt-12 h-px w-full bg-neutral-800" />

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="group mt-8 flex w-full items-center justify-center gap-3 bg-white px-5 py-3.5 text-sm font-medium text-neutral-900 transition-all hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
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
              </>
            )}
          </button>

          {error && (
            <p
              role="alert"
              className="mt-6 border-l-2 border-red-500/60 pl-3 font-mono text-xs leading-relaxed text-red-400"
            >
              {error}
            </p>
          )}
        </div>

        {/* Card bottom rule */}
        <div className="border-t border-neutral-800/70 px-8 py-4 sm:px-10">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-600">
            Secure · OAuth 2.0
          </span>
        </div>
      </section>

      {/* Footer line */}
      <footer className="mt-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-700">
          DashyCore v7
        </span>
      </footer>
    </main>
  );
}
