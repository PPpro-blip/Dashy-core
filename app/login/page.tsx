"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  GithubIcon,
  GoogleIcon,
  ZapIcon,
  SparklesIcon,
  BrainIcon,
  MailIcon,
  ShieldCheckIcon,
  AlertIcon,
  ArrowRightIcon,
  RefreshIcon,
} from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const oauth = async (provider: "google" | "github") => {
    setLoading(true);
    setError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth sign-in failed.");
      setLoading(false);
    }
  };

  const sendCode = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: authError } = await createClient().auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) {
        setError(authError.message);
      } else {
        setSent(true);
        setResendCooldown(45);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send verification code.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanCode = code.trim().replace(/\D/g, "");
    if (cleanCode.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await createClient().auth.verifyOtp({
        email: email.trim(),
        token: cleanCode,
        type: "email",
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else if (data?.session) {
        router.push("/chat");
        router.refresh();
      } else {
        router.push("/chat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
      setLoading(false);
    }
  };

  const resetEmailFlow = () => {
    setSent(false);
    setCode("");
    setError(null);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070913] px-4 py-8 sm:px-6 md:px-8 lg:px-12">
      {/* Background radial glow & grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]"
      />
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-25"
      />

      {/* Double Panel Main Card */}
      <div className="relative z-10 w-full max-w-5xl">
        <div className="grid grid-cols-1 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#0c1020]/80 shadow-2xl shadow-black/90 backdrop-blur-2xl lg:grid-cols-12">
          
          {/* ============================================================ */}
          {/* LEFT PANEL: Branding / Hero Showcase (Hidden on Mobile)     */}
          {/* ============================================================ */}
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.08] bg-gradient-to-br from-[#0e162a]/95 via-[#0a0f1e]/90 to-[#070a14]/95 p-8 lg:col-span-5 lg:flex xl:p-10">
            {/* Subtle glow accents */}
            <div className="pointer-events-none absolute -top-16 -left-16 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" />

            <div className="relative z-10 space-y-8">
              {/* Brand Top Header */}
              <div>
                <div className="flex items-center gap-3">
                  <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-600 p-[1px] shadow-lg shadow-cyan-500/20">
                    <div className="flex h-full w-full items-center justify-center rounded-[15px] bg-[#090e1a]">
                      <Image
                        src="/icon-512.png"
                        alt="DashyCore Logo"
                        width={28}
                        height={28}
                        priority
                        className="rounded-lg object-contain"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-xl font-bold tracking-tight text-white">
                      Dashy<span className="text-gradient">Core</span>
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm font-medium italic text-cyan-300/90">
                  &ldquo;Your Unified AI Workspace&rdquo;
                </p>
              </div>

              {/* Tagline & Showcase List */}
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  Everything you need to build & create
                </p>

                <ul className="space-y-4">
                  {/* Feature 1: D-Code */}
                  <li className="group rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5 transition-colors hover:border-cyan-400/30 hover:bg-white/[0.04]">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
                        <ZapIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white">D-Code</span>
                          <span className="text-xs text-zinc-400">⚡</span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                          IDE with native VS Code experience, terminal, and AI pair coding.
                        </p>
                      </div>
                    </div>
                  </li>

                  {/* Feature 2: Dashy Studio */}
                  <li className="group rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5 transition-colors hover:border-violet-400/30 hover:bg-white/[0.04]">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
                        <SparklesIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white">Dashy Studio</span>
                          <span className="text-xs text-zinc-400">🎨</span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                          Fast &lt;IMG&gt; generation & resilient media management.
                        </p>
                      </div>
                    </div>
                  </li>

                  {/* Feature 3: Knowledge Digest */}
                  <li className="group rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5 transition-colors hover:border-emerald-400/30 hover:bg-white/[0.04]">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300">
                        <BrainIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-white">Knowledge Digest</span>
                          <span className="text-xs text-zinc-400">🧠</span>
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                          Multi-file context, semantic ingestion & RAG chat intelligence.
                        </p>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            {/* Bottom Security / Status Footer */}
            <div className="relative z-10 pt-6">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
                <span>DashyCore v7.0 · Enterprise-grade encrypted auth</span>
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* RIGHT PANEL: Interactive Auth Form (Single Login Entry)     */}
          {/* ============================================================ */}
          <div className="flex flex-col justify-center p-6 sm:p-10 md:p-12 lg:col-span-7">
            
            {/* Mobile Header (Hidden on Desktop) */}
            <div className="mb-6 flex flex-col items-center text-center lg:hidden">
              <div className="mb-3 flex items-center justify-center gap-2.5">
                <Image
                  src="/icon-512.png"
                  alt="DashyCore Logo"
                  width={34}
                  height={34}
                  priority
                  className="rounded-xl object-contain"
                />
                <span className="text-xl font-bold tracking-tight text-white">
                  Dashy<span className="text-gradient">Core</span>
                </span>
              </div>
              <p className="text-xs italic text-cyan-300/90">
                &ldquo;Your Unified AI Workspace&rdquo;
              </p>
            </div>

            {/* Auth Title & Description */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {sent ? "Check your inbox" : "Sign in to DashyCore"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {sent ? (
                  <>
                    We sent a 6-digit one-time code to{" "}
                    <span className="font-semibold text-cyan-300">{email}</span>. Enter it below to enter your workspace.
                  </>
                ) : (
                  "Welcome back! Sign in seamlessly with passwordless email OTP or your preferred OAuth provider."
                )}
              </p>
            </div>

            {/* OTP Form (Step 1: Email / Step 2: 6-digit OTP) */}
            <form onSubmit={sent ? verifyCode : sendCode} className="space-y-4">
              {!sent ? (
                /* Step 1: Email Address Input */
                <div className="space-y-1.5">
                  <label
                    htmlFor="email-input"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-300"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-500">
                      <MailIcon className="h-4 w-4" />
                    </div>
                    <input
                      id="email-input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      disabled={loading}
                      placeholder="name@company.com"
                      className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.04] py-3.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-zinc-500 transition-all focus:border-cyan-400/70 focus:bg-white/[0.06] focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-60"
                    />
                  </div>
                </div>
              ) : (
                /* Step 2: 6-digit OTP Code Input */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="otp-input"
                      className="block text-xs font-semibold uppercase tracking-wider text-zinc-300"
                    >
                      6-Digit Security Code
                    </label>
                    <button
                      type="button"
                      onClick={resetEmailFlow}
                      className="text-xs text-cyan-300 hover:text-cyan-200 hover:underline"
                    >
                      Change email
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="otp-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      required
                      autoFocus
                      disabled={loading}
                      placeholder="000000"
                      className="w-full rounded-2xl border border-cyan-400/40 bg-white/[0.05] py-3.5 text-center font-mono text-2xl font-bold tracking-[0.5em] text-white outline-none transition-all focus:border-cyan-400 focus:bg-white/[0.08] focus:ring-4 focus:ring-cyan-400/20 disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              {/* Main Submit Button */}
              <button
                type="submit"
                disabled={loading || (!sent && !email.trim()) || (sent && code.length < 6)}
                className="group relative flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-cyan-300 py-3.5 text-sm font-bold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-400/30 hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06202a]/30 border-t-[#06202a]" />
                    <span>Please wait…</span>
                  </>
                ) : sent ? (
                  <>
                    <ShieldCheckIcon className="h-4 w-4" />
                    <span>Verify Code</span>
                  </>
                ) : (
                  <>
                    <span>Send One-Time Code</span>
                    <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              {/* Resend actions when code is sent */}
              {sent && (
                <div className="flex items-center justify-center gap-1 pt-1 text-xs text-zinc-400">
                  <span>Didn&apos;t receive it?</span>
                  <button
                    type="button"
                    disabled={loading || resendCooldown > 0}
                    onClick={() => sendCode()}
                    className="font-medium text-cyan-300 transition hover:text-cyan-200 hover:underline disabled:cursor-not-allowed disabled:text-zinc-600 disabled:no-underline"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
                  </button>
                </div>
              )}
            </form>

            {/* OAuth Dividers & Buttons */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Or continue with
              </span>
              <div className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Google OAuth */}
              <button
                type="button"
                onClick={() => oauth("google")}
                disabled={loading}
                className="flex items-center justify-center gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition-all hover:border-white/[0.18] hover:bg-white/[0.08] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GoogleIcon className="h-4 w-4" />
                <span>Google</span>
              </button>

              {/* GitHub OAuth */}
              <button
                type="button"
                onClick={() => oauth("github")}
                disabled={loading}
                className="flex items-center justify-center gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition-all hover:border-white/[0.18] hover:bg-white/[0.08] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GithubIcon className="h-4 w-4" />
                <span>GitHub</span>
              </button>
            </div>

            {/* Error Message Alert */}
            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300 animate-fade-in-up"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                <div className="min-w-0 flex-1 leading-relaxed">{error}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
