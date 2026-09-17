"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BookOpenIcon,
  CodeIcon,
  GithubIcon,
  ImageIcon,
} from "@/components/icons";

/**
 * DashyCore — Authentication (modern split-screen OTP flow).
 *
 * Left panel (desktop): dark mesh gradient with cyan/purple glows, brand +
 * feature cards. Right panel: passwordless email OTP (Send Code → 6-digit
 * Verify) plus Google / GitHub OAuth. No passwords, no sign-up tabs.
 */

type Step = "email" | "otp";

const FEATURES = [
  {
    icon: CodeIcon,
    title: "D-Code IDE",
    description: "Multi-file editor with terminal & GitHub import",
    accent: "text-cyan-300",
    ring: "border-cyan-400/20 bg-cyan-400/10",
  },
  {
    icon: ImageIcon,
    title: "Studio",
    description: "Text-to-image generation with instant gallery",
    accent: "text-fuchsia-300",
    ring: "border-fuchsia-400/20 bg-fuchsia-400/10",
  },
  {
    icon: BookOpenIcon,
    title: "Knowledge Digest",
    description: "Documents indexed into searchable workspace memory",
    accent: "text-violet-300",
    ring: "border-violet-400/20 bg-violet-400/10",
  },
];

function GoogleMark() {
  return (
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
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<"google" | "github" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  const busy = sending || verifying || oauthBusy !== null;

  const handleOAuth = useCallback(
    async (provider: "google" | "github") => {
      setOauthBusy(provider);
      setError(null);
      try {
        const supabase = createClient();
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (oauthError) {
          setError(oauthError.message);
          setOauthBusy(null);
        }
      } catch {
        setError("Network error. Please check your connection and try again.");
        setOauthBusy(null);
      }
    },
    []
  );

  const handleSendCode = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      const clean = email.trim();
      if (!clean || sending) return;
      setSending(true);
      setError(null);
      setNotice(null);
      try {
        const supabase = createClient();
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: clean,
          options: { shouldCreateUser: true },
        });
        if (otpError) {
          setError(otpError.message);
        } else {
          setStep("otp");
          setNotice(`We sent a 6-digit code to ${clean}.`);
          window.setTimeout(() => codeRefs.current[0]?.focus(), 60);
        }
      } catch {
        setError("Network error. Please check your connection and try again.");
      } finally {
        setSending(false);
      }
    },
    [email, sending]
  );

  const handleVerify = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      const token = code.join("");
      if (token.length !== 6 || verifying) return;
      setVerifying(true);
      setError(null);
      try {
        const supabase = createClient();
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token,
          type: "email",
        });
        if (verifyError) {
          setError(
            verifyError.message ||
              "That code didn't work — check it and try again."
          );
          setVerifying(false);
          return;
        }
        router.push("/chat");
        router.refresh();
      } catch {
        setError("Network error. Please check your connection and try again.");
        setVerifying(false);
      }
    },
    [code, email, router, verifying]
  );

  const handleCodeChange = useCallback(
    (index: number, value: string) => {
      const digit = value.replace(/\D/g, "").slice(-1);
      setCode((prev) => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });
      if (digit && index < 5) {
        codeRefs.current[index + 1]?.focus();
      }
    },
    []
  );

  const handleCodeKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace" && !code[index] && index > 0) {
        event.preventDefault();
        codeRefs.current[index - 1]?.focus();
        setCode((prev) => {
          const next = [...prev];
          next[index - 1] = "";
          return next;
        });
      }
    },
    [code]
  );

  const handleCodePaste = useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData("text").replace(/\D/g, "");
      if (!text) return;
      event.preventDefault();
      const digits = text.slice(0, 6).split("");
      setCode((prev) => prev.map((_, i) => digits[i] ?? ""));
      codeRefs.current[Math.min(digits.length, 5)]?.focus();
    },
    []
  );

  const handleBackToEmail = useCallback(() => {
    setStep("email");
    setCode(["", "", "", "", "", ""]);
    setError(null);
    setNotice(null);
  }, []);

  return (
    <main className="flex min-h-screen bg-navy">
      {/* ============ LEFT PANEL — brand showcase (desktop) ============ */}
      <section className="relative hidden w-[60%] flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
        {/* Mesh gradient backdrop */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[#070a14]" />
          <div className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full bg-cyan-500/20 blur-[140px]" />
          <div className="absolute -bottom-40 right-[-120px] h-[520px] w-[520px] rounded-full bg-violet-600/25 blur-[150px]" />
          <div className="absolute left-1/2 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-[120px]" />
          <div
            className="bg-grid absolute inset-0 opacity-60"
            style={{
              maskImage:
                "radial-gradient(ellipse 80% 70% at 40% 40%, black 20%, transparent 75%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 80% 70% at 40% 40%, black 20%, transparent 75%)",
            }}
          />
        </div>

        {/* Logo row */}
        <div className="relative z-10 flex items-center gap-3">
          <Image
            src="/icon-512.png"
            alt="DashyCore Logo"
            width={44}
            height={44}
            className="h-11 w-11"
            priority
          />
          <span className="text-xl font-semibold tracking-tight text-white">
            DashyCore
          </span>
        </div>

        {/* Headline + features */}
        <div className="relative z-10 max-w-xl">
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-white xl:text-6xl">
            Your Unified
            <br />
            <span className="text-gradient">AI Workspace</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-400">
            Chat, code, create and remember — every AI surface you need, wired
            into one fast, private workspace.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-xl shadow-black/40 backdrop-blur-xl transition-colors hover:border-white/[0.16]"
              >
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${feature.ring}`}
                >
                  <feature.icon className={`h-4 w-4 ${feature.accent}`} />
                </span>
                <p className="mt-3 text-sm font-semibold text-white">
                  {feature.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer strip */}
        <p className="relative z-10 text-xs text-zinc-600">
          Passwordless by design — your inbox is your key.
        </p>
      </section>

      {/* ============ RIGHT PANEL — OTP auth ============ */}
      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-12">
        {/* Mobile glow (desktop keeps the right side calm) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[620px] -translate-x-1/2 rounded-full bg-gradient-to-b from-cyan-500/10 via-violet-500/[0.06] to-transparent blur-3xl lg:hidden"
        />

        <div className="relative z-10 w-full max-w-sm">
          {/* Mobile brand row */}
          <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
            <Image
              src="/icon-512.png"
              alt="DashyCore Logo"
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            <span className="text-base font-semibold tracking-tight text-white">
              DashyCore
            </span>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/80 backdrop-blur-xl">
            {step === "email" ? (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Enter your email and we&apos;ll send you a one-time code —
                  no password needed.
                </p>

                <form onSubmit={handleSendCode} className="mt-6 space-y-4">
                  <div>
                    <label
                      htmlFor="auth-email"
                      className="mb-2 block text-sm font-medium text-neutral-300"
                    >
                      Email
                    </label>
                    <input
                      id="auth-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={busy}
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sending ? (
                      <span className="flex items-center justify-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 animate-spin rounded-full border-2 border-[#06202a]/30 border-t-[#06202a]"
                        />
                        Sending code…
                      </span>
                    ) : (
                      "Send Code"
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  Check your inbox
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-medium text-zinc-200">
                    {email.trim()}
                  </span>
                  .
                </p>

                <form onSubmit={handleVerify} className="mt-6 space-y-4">
                  <div
                    className="flex items-center justify-between gap-2"
                    role="group"
                    aria-label="6-digit verification code"
                  >
                    {code.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => {
                          codeRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete={
                          index === 0 ? "one-time-code" : "off"
                        }
                        maxLength={1}
                        value={digit}
                        disabled={busy}
                        onChange={(e) =>
                          handleCodeChange(index, e.target.value)
                        }
                        onKeyDown={(e) => handleCodeKeyDown(index, e)}
                        onPaste={handleCodePaste}
                        aria-label={`Digit ${index + 1}`}
                        className="h-12 w-full rounded-lg border border-white/[0.1] bg-white/[0.04] text-center text-lg font-semibold text-white transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={busy || code.join("").length !== 6}
                    className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {verifying ? (
                      <span className="flex items-center justify-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 animate-spin rounded-full border-2 border-[#06202a]/30 border-t-[#06202a]"
                        />
                        Verifying…
                      </span>
                    ) : (
                      "Verify"
                    )}
                  </button>
                </form>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={handleBackToEmail}
                    disabled={busy}
                    className="font-medium text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-50"
                  >
                    ← Use a different email
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendCode()}
                    disabled={busy}
                    className="font-medium text-cyan-300 transition-colors hover:text-cyan-200 disabled:opacity-50"
                  >
                    Resend code
                  </button>
                </div>
              </>
            )}

            {/* Divider */}
            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
              <span className="text-xs text-neutral-500">or</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            </div>

            {/* Social */}
            <button
              type="button"
              onClick={() => void handleOAuth("google")}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-medium text-neutral-950 shadow-md shadow-white/5 transition-all hover:bg-neutral-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {oauthBusy === "google" ? (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
                />
              ) : (
                <GoogleMark />
              )}
              <span>Continue with Google</span>
            </button>
            <button
              type="button"
              onClick={() => void handleOAuth("github")}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.12] bg-[#24292f] px-5 py-3.5 text-sm font-medium text-white shadow-md shadow-black/30 transition-all hover:bg-[#2f353d] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {oauthBusy === "github" ? (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              ) : (
                <GithubIcon className="h-5 w-5 text-white" />
              )}
              <span>Continue with GitHub</span>
            </button>

            {notice && !error && (
              <p className="mt-4 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-xs leading-relaxed text-cyan-200">
                {notice}
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
          </div>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-600">
            By continuing you agree to the Terms & Privacy Policy.
          </p>
        </div>
      </section>
    </main>
  );
}
