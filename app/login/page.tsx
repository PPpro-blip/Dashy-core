"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CheckIcon,
  CodeIcon,
  GithubIcon,
  ImageIcon,
  MessageIcon,
} from "@/components/icons";

/**
 * DashyCore — Authentication (OTP-only, double panel).
 *
 * Left panel: brand hero (logo, headline, feature highlights).
 * Right panel: passwordless email OTP login — 6-digit code, no passwords,
 * no Sign Up tab (first-time OTP verification creates the account
 * silently, so there is deliberately no separate registration UI).
 *
 * Responsive: panels sit side-by-side on lg+; on smaller screens the hero
 * collapses to a compact brand header above the login card.
 */

type Step = "email" | "code";
type OAuthProvider = "google" | "github";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

const HERO_FEATURES = [
  {
    Icon: MessageIcon,
    title: "Chat with any model",
    desc: "One workspace, every frontier model, streaming replies.",
  },
  {
    Icon: CodeIcon,
    title: "D-Code editor",
    desc: "Multi-file Monaco IDE with shareable public links.",
  },
  {
    Icon: ImageIcon,
    title: "Studio image engine",
    desc: "Prompt-to-image renders through our never-fail proxy.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string[]>(() => Array(CODE_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const boxRefs = useRef<Array<HTMLInputElement | null>>([]);

  /* Resend cooldown ticker. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const busy = loading || oauthLoading !== null;

  const handleOAuthSignIn = async (provider: OAuthProvider) => {
    setOauthLoading(provider);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setError(error.message);
        setOauthLoading(null);
      }
      // Success redirects away — keep the spinner until navigation.
    } catch {
      setError("Network error. Please check your connection and try again.");
      setOauthLoading(null);
    }
  };

  const handleSendCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || busy) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true },
      });
      if (error) {
        setError(error.message);
      } else {
        setStep("code");
        setCode(Array(CODE_LENGTH).fill(""));
        setInfo(`We sent a 6-digit code to ${cleanEmail}. It expires in a few minutes.`);
        setCooldown(RESEND_COOLDOWN_SECONDS);
        window.setTimeout(() => boxRefs.current[0]?.focus(), 0);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const token = code.join("");
    if (token.length !== CODE_LENGTH || busy) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: "email",
      });
      if (error) {
        setError(
          error.message.includes("expired")
            ? "That code expired. Request a fresh one below."
            : "That code didn't work. Check the digits and try again."
        );
      } else {
        router.push("/chat");
        router.refresh();
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  /* 6-box OTP input: digits only, auto-advance, backspace nav, full paste. */
  const handleBoxChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setCode((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < CODE_LENGTH - 1) {
      boxRefs.current[index + 1]?.focus();
    }
  };

  const handleBoxKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      boxRefs.current[index - 1]?.focus();
    }
  };

  const handleBoxPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (pasted.length === 0) return;
    event.preventDefault();
    setCode((prev) => {
      const next = [...prev];
      for (let i = 0; i < CODE_LENGTH; i++) {
        next[i] = pasted[i] ?? "";
      }
      return next;
    });
    boxRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  const handleUseDifferentEmail = () => {
    setStep("email");
    setCode(Array(CODE_LENGTH).fill(""));
    setError(null);
    setInfo(null);
  };

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-navy lg:grid-cols-2">
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
      {/* Ambient radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-cyan-500/10 via-violet-500/5 to-transparent blur-3xl"
      />

      {/* ------------------------- LEFT: brand hero ------------------------- */}
      <section className="relative z-10 hidden flex-col justify-between border-r border-white/[0.06] bg-white/[0.015] px-12 py-10 lg:flex xl:px-16">
        <div className="flex items-center gap-3">
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

        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
            Your AI <span className="text-gradient">Operating System</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">
            Chat, code, and create — one passwordless workspace for models,
            projects, and image generation.
          </p>

          <ul className="mt-10 space-y-5">
            {HERO_FEATURES.map(({ Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
                  <Icon className="h-4 w-4 text-cyan-400" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-zinc-100">{title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                    {desc}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-zinc-600">
          <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
          Passwordless sign-in · a 6-digit code lands in your inbox
        </p>
      </section>

      {/* ------------------------- RIGHT: OTP login ------------------------- */}
      <section className="relative z-10 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Compact brand header (small screens only — hero is lg+) */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
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

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/80 backdrop-blur-xl transition-colors hover:border-white/[0.14] md:p-10">
            <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
              {step === "email" ? (
                <>
                  Welcome to <span className="text-gradient">DashyCore</span>
                </>
              ) : (
                "Check your inbox"
              )}
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">
              {step === "email"
                ? "Enter your email — we'll send a one-time code. No password needed."
                : (
                  <>
                    Enter the 6-digit code sent to{" "}
                    <span className="font-medium text-zinc-200">{email.trim()}</span>
                  </>
                )}
            </p>

            <div className="my-7 h-px w-full bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

            {step === "email" ? (
              <form onSubmit={(e) => void handleSendCode(e)} className="space-y-4">
                <div>
                  <label htmlFor="otp-email" className="mb-2 block text-sm font-medium text-neutral-300">
                    Email
                  </label>
                  <input
                    id="otp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy}
                    autoComplete="email"
                    autoFocus
                    className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || !email.trim()}
                  className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2 border-[#06202a]/30 border-t-[#06202a]"
                      />
                      Sending code…
                    </span>
                  ) : (
                    "Send one-time code"
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void handleVerifyCode(e)} className="space-y-4">
                <div>
                  <label
                    id="otp-code-label"
                    className="mb-2 block text-sm font-medium text-neutral-300"
                  >
                    6-digit code
                  </label>
                  <div role="group" aria-labelledby="otp-code-label" className="flex gap-2">
                    {code.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => {
                          boxRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        aria-label={`Digit ${index + 1}`}
                        value={digit}
                        onChange={(e) => handleBoxChange(index, e.target.value)}
                        onKeyDown={(e) => handleBoxKeyDown(index, e)}
                        onPaste={handleBoxPaste}
                        disabled={busy}
                        maxLength={1}
                        className="h-12 w-full rounded-lg border border-white/[0.1] bg-white/[0.04] text-center font-mono text-lg font-semibold text-white transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={busy || code.join("").length !== CODE_LENGTH}
                  className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2 border-[#06202a]/30 border-t-[#06202a]"
                      />
                      Verifying…
                    </span>
                  ) : (
                    "Verify & sign in"
                  )}
                </button>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <button
                    type="button"
                    onClick={handleUseDifferentEmail}
                    disabled={busy}
                    className="text-zinc-500 transition-colors hover:text-cyan-300 disabled:opacity-50"
                  >
                    Use a different email
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendCode()}
                    disabled={busy || cooldown > 0}
                    className="font-medium text-zinc-400 transition-colors hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </form>
            )}

            {/* Status messages */}
            {info && !error && (
              <p
                role="status"
                className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-xs leading-relaxed text-cyan-200"
              >
                {info}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs leading-relaxed text-red-300"
              >
                {error}
              </p>
            )}

            {/* Divider */}
            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
              <span className="text-xs text-neutral-500">or continue with</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            </div>

            {/* Google OAuth */}
            <button
              type="button"
              onClick={() => void handleOAuthSignIn("google")}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-medium text-neutral-950 shadow-md shadow-white/5 transition-all hover:bg-neutral-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {oauthLoading === "google" ? (
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

            {/* GitHub OAuth */}
            <button
              type="button"
              onClick={() => void handleOAuthSignIn("github")}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.12] bg-[#24292f] px-5 py-3.5 text-sm font-medium text-white shadow-md shadow-black/30 transition-all hover:bg-[#2f353d] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {oauthLoading === "github" ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  <span>Redirecting to GitHub…</span>
                </>
              ) : (
                <>
                  <GithubIcon className="h-5 w-5 text-white" />
                  <span>Continue with GitHub</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-zinc-500"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-600">
              New here? Your account is created automatically when you verify
              your first code — no separate sign-up needed.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
