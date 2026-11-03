"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { GithubIcon } from "@/components/icons";
import { requestOtp, signInWithPasswordCompat, startOAuth } from "@/lib/auth/actions";
import {
  isValidEmail,
  normalizeEmail,
  safeRedirectPath,
  DEFAULT_POST_AUTH_PATH,
  type AuthMode,
} from "@/lib/auth/otp";

/**
 * DashyCore — Authentication (AUTH-01).
 *
 * Email OTP is the primary flow (Supabase Auth + Resend SMTP delivery):
 *   Sign In  → email → OTP code → /login/verify → session → app
 *   Sign Up  → email → OTP code → /login/verify → session → app
 *
 * Password sign-in remains available on the Sign In tab ONLY as a
 * compatibility path for pre-existing password accounts, clearly separated
 * from the OTP path. Google/GitHub OAuth buttons are preserved for existing
 * accounts. There is exactly ONE submit path per mode.
 */

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialMode: AuthMode =
    searchParams.get("mode") === "signup" ? "signup" : "signin";
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = safeRedirectPath(
    searchParams.get("next"),
    DEFAULT_POST_AUTH_PATH
  );

  /** Step 1 (OTP flows): validate, ask Supabase to email the code, then move
   *  to the verification screen. Never claims success on mere send. */
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: reqError } = await requestOtp(normalized, authMode, next);
      if (reqError) {
        setError(reqError);
      } else {
        const params = new URLSearchParams({
          mode: authMode,
          email: normalized,
          next,
        });
        router.push(`/login/verify?${params.toString()}`);
      }
    } finally {
      // Always reset — the user must never stare at a frozen button.
      setBusy(false);
    }
  };

  /** Compatibility path (Sign In only): real Supabase password sign-in. */
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await signInWithPasswordCompat(
        normalized,
        password
      );
      if (signInError) {
        setError(signInError);
      } else {
        router.push(next);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: oauthError } = await startOAuth(provider, next);
      if (oauthError) setError(oauthError);
      // On success the browser is already redirecting to the provider.
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (mode: AuthMode) => {
    if (busy) return;
    setAuthMode(mode);
    setUsePassword(false);
    setPassword("");
    setError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", mode);
    router.replace(`/login?${params.toString()}`);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-6 py-16">
      {/* Subtle background grid */}
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 opacity-40"
        style={{
          maskImage:
            "radial-gradient(ellipse 75% 65% at 50% 45%, black 25%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 65% at 50% 45%, black 25%, transparent 78%)",
        }}
      />

      {/* Ambient radial glow behind the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-cyan-500/10 via-violet-500/5 to-transparent blur-3xl"
      />

      {/* Content column */}
      <div className="relative z-10 w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Image
            src="/icon-512.png"
            alt="DashyCore Logo"
            width={36}
            height={36}
            className="h-9 w-9"
            priority
          />
          <span className="text-lg font-semibold tracking-tight text-neutral-100">
            DashyCore
          </span>
        </div>

        {/* Centerpiece glass card */}
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/80 backdrop-blur-xl transition-colors hover:border-white/[0.14] md:p-10">
          {/* Headline */}
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Welcome to <span className="text-gradient">DashyCore</span>
          </h1>

          {/* Subtitle */}
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            {authMode === "signin"
              ? "Sign in with a one-time code sent to your email."
              : "Create your account with a one-time code sent to your email."}
          </p>

          {/* Divider */}
          <div className="my-8 h-px w-full bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

          {/* Auth Mode Tabs */}
          <div className="mb-6 flex gap-2" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signin"}
              onClick={() => switchMode("signin")}
              disabled={busy}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                authMode === "signin"
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signup"}
              onClick={() => switchMode("signup")}
              disabled={busy}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                authMode === "signup"
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Email OTP form (single submit path per mode) */}
          <form
            onSubmit={usePassword && authMode === "signin" ? handlePasswordSignIn : handleSendCode}
            className="space-y-4"
          >
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-neutral-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={busy}
                className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="you@example.com"
              />
            </div>

            {usePassword && authMode === "signin" && (
              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-neutral-300">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={busy}
                  minLength={6}
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="••••••••"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  {usePassword && authMode === "signin"
                    ? "Signing in..."
                    : "Sending code..."}
                </span>
              ) : usePassword && authMode === "signin" ? (
                "Sign In with Password"
              ) : authMode === "signin" ? (
                "Send Sign-In Code"
              ) : (
                "Create Account & Send Code"
              )}
            </button>
          </form>

          {/* Password compatibility toggle — Sign In only, clearly separated */}
          {authMode === "signin" && (
            <button
              type="button"
              onClick={() => {
                setUsePassword((v) => !v);
                setError(null);
              }}
              disabled={busy}
              className="mt-3 w-full text-center text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {usePassword
                ? "Use a sign-in code instead"
                : "Have a password? Sign in with password"}
            </button>
          )}

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            <span className="text-xs text-neutral-500">or</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={() => void handleOAuth("google")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-medium text-neutral-950 shadow-md shadow-white/5 transition-all hover:bg-neutral-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
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
          </button>

          {/* GitHub OAuth */}
          <button
            type="button"
            onClick={() => void handleOAuth("github")}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.12] bg-[#24292f] px-5 py-3.5 text-sm font-medium text-white shadow-md shadow-black/30 transition-all hover:bg-[#2f353d] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GithubIcon className="h-5 w-5 text-white" />
            <span>Continue with GitHub</span>
          </button>

          {error && (
            <p
              role="alert"
              aria-live="assertive"
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

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-navy">
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400"
          />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
