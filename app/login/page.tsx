"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isAuthenticated, signIn } from "@/lib/ui/auth";

// Client-only page; metadata is exported from the layout template.
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/");
    }
  }, [router]);

  const validate = (): string | null => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return "Please enter a valid email address.";
    }
    if (password.length < 6) {
      return "Password must be at least 6 characters.";
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);

    // UI-ONLY fake auth — no backend hookup yet.
    // Simulate a short network round-trip for premium feel.
    window.setTimeout(() => {
      signIn(email.trim());
      router.replace("/");
    }, 600);
  };

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />

      <main className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="url(#auth-grad)" />
              <path d="M10 22V14l3.5 0 3.2 7 3.2-7H23v8h-3v-7l-3 6h-3l-3-6v7z" fill="#0b0c10" />
              <defs>
                <linearGradient id="auth-grad" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#00f2fe" />
                  <stop offset="1" stopColor="#9b51e0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        <h1 className="auth-title">DashyCore</h1>
        <p className="auth-subtitle">
          {mode === "signin"
            ? "Sign in to your intelligent workspace."
            : "Create your account and start building."}
        </p>

        <div className="auth-mode-toggle" role="tablist" aria-label="Auth mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={`auth-mode-button${mode === "signin" ? " active" : ""}`}
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={`auth-mode-button${mode === "signup" ? " active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              className="auth-input"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              className="auth-input"
              placeholder="••••••••"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="thinking-spinner" style={{ width: 14, height: 14 }} aria-hidden="true" />
                <span>{mode === "signin" ? "Signing in…" : "Creating account…"}</span>
              </>
            ) : mode === "signin" ? (
              "Sign In →"
            ) : (
              "Create Account →"
            )}
          </button>
        </form>

        <div className="auth-divider">or</div>

        {/* Placeholder — non-functional Google OAuth button. */}
        <button
          type="button"
          className="auth-google"
          onClick={() =>
            setError("Google sign-in is coming soon. Use email for now.")
          }
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z" />
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
          </svg>
          Continue with Google
        </button>

        <p className="auth-footer-note">
          Protected by DashyCore · v7 preview build
        </p>
      </main>
    </div>
  );
}