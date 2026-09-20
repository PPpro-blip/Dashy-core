"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import {
  BrainIcon,
  CodeIcon,
  GithubIcon,
  ImageIcon,
  SparklesIcon,
} from "@/components/icons";

/**
 * DashyCore — Authentication (Double-Panel).
 *
 * Left-Hero (60%) / Right-Login (40%) split.
 * Auth methods: Email OTP (magic link + 6-digit code) and Social
 * (Google, GitHub) ONLY — deliberately NO password field and NO
 * "Sign Up" button. signInWithOtp creates the account on first use.
 */

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  const handleGitHubSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  };

  /** Sends a one-time code / magic link. Creates the user if new. */
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setError(error.message);
      } else {
        setOtpSent(true);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  /** Verifies the 6-digit code typed from the email. */
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "email",
      });
      if (error) {
        setError(error.message);
        setVerifying(false);
      } else {
        // Hard navigation so the middleware sees the fresh session cookie.
        window.location.assign("/chat");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
      setVerifying(false);
    }
  };

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-navy">
      {/* ==================== LEFT HERO — 60% ==================== */}
      <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden p-12 lg:flex lg:w-[60%]">
        {/* Backdrop */}
        <div
          aria-hidden="true"
          className="bg-grid pointer-events-none absolute inset-0 opacity-40"
          style={{
            maskImage:
              "radial-gradient(ellipse 80% 70% at 45% 45%, black 25%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 70% at 45% 45%, black 25%, transparent 80%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 top-1/3 h-[480px] w-[720px] rounded-full bg-gradient-to-tr from-cyan-500/15 via-blue-500/10 to-violet-500/10 blur-3xl"
        />

        {/* Brand */}
        <div className="relative z-10 flex items-center gap-3">
          <Image
            src="/icon-512.png"
            alt="DashyCore Logo"
            width={36}
            height={36}
            className="h-9 w-9 rounded-lg"
            priority
          />
          <span className="text-lg font-semibold tracking-tight text-neutral-100">
            DashyCore
          </span>
        </div>

        {/* Headline */}
        <div className="relative z-10 max-w-xl">
          <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight text-white">
            Your <span className="text-gradient">AI Operating System</span>
            <br />
            for everything.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-400">
            Chat, code, generate images, and orchestrate agents — one
            workspace, one memory, zero friction.
          </p>

          {/* Feature chips */}
          <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
            {[
              { Icon: SparklesIcon, label: "Multi-model chat" },
              { Icon: CodeIcon, label: "D-Code workspace" },
              { Icon: ImageIcon, label: "Studio image engine" },
              { Icon: BrainIcon, label: "Persistent memory" },
            ].map(({ Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-cyan-400" />
                <span className="text-[13px] font-medium text-zinc-300">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <p className="relative z-10 text-xs text-zinc-600">
          Trusted by builders — private by default, yours forever.
        </p>
      </section>

      {/* ==================== RIGHT LOGIN — 40% ==================== */}
      <section className="relative flex min-h-screen w-full flex-col items-center justify-center border-l border-white/[0.06] bg-navy-deep/50 px-6 py-16 lg:w-[40%]">
        <div className="w-full max-w-sm">
          {/* Mobile brand (hero hidden below lg) */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <Image
              src="/icon-512.png"
              alt="DashyCore Logo"
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg"
              priority
            />
            <span className="text-lg font-semibold tracking-tight text-neutral-100">
              DashyCore
            </span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Welcome back
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Sign in with a one-time email code or a social account.
          </p>

          {/* Email OTP */}
          {otpSent ? (
            <form onSubmit={handleVerifyOtp} className="mt-8 space-y-4">
              <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-3 text-xs leading-relaxed text-cyan-200">
                We sent a sign-in code (and a magic link) to{" "}
                <span className="font-semibold">{email}</span>. Enter the
                code below or tap the link in the email.
              </div>
              <div>
                <label
                  htmlFor="otp"
                  className="mb-2 block text-sm font-medium text-neutral-300"
                >
                  One-time code
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                  disabled={verifying}
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-white placeholder-zinc-600 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="••••••"
                />
              </div>
              <button
                type="submit"
                disabled={verifying || !otpCode.trim()}
                className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying ? (
                  <span className="flex items-center justify-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />
                    Verifying…
                  </span>
                ) : (
                  "Verify & Continue"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode("");
                  setError(null);
                }}
                className="w-full text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Use a different email
              </button>
            </form>
          ) : (
            <form onSubmit={handleSendOtp} className="mt-8 space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-neutral-300"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="you@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />
                    Sending code…
                  </span>
                ) : (
                  "Continue with Email"
                )}
              </button>
              <p className="text-center text-[11px] leading-relaxed text-zinc-600">
                No password needed — we email you a one-time code. New here?
                The same flow creates your account automatically.
              </p>
            </form>
          )}

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            <span className="text-xs text-neutral-500">or</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
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
            onClick={handleGitHubSignIn}
            disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.12] bg-[#24292f] px-5 py-3.5 text-sm font-medium text-white shadow-md shadow-black/30 transition-all hover:bg-[#2f353d] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GithubIcon className="h-5 w-5 text-white" />
            <span>Continue with GitHub</span>
          </button>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs leading-relaxed text-red-300"
            >
              {error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
