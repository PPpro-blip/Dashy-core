"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CodeIcon,
  GithubIcon,
  LockIcon,
  MailIcon,
  SparklesIcon,
} from "@/components/icons";

type PendingAction = "send" | "verify" | "google" | "github" | null;

/** One sign-in path: email OTP (or its email link), Google, or GitHub. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (codeSent) codeInputRef.current?.focus();
  }, [codeSent]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((remaining) => remaining - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setPending("send");
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
      setEmail(normalizedEmail);
      setCode("");
      setCodeSent(true);
      setCooldown(30);
      setMessage(
        "We sent you a verification code. You can also use the secure link in your email.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't send a code. Try again.",
      );
    } finally {
      setPending(null);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || code.length < 6) return;
    setPending("verify");
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (authError) throw authError;
      if (!data.session)
        throw new Error(
          "We couldn't finish signing you in. Request a new code.",
        );
      router.replace("/chat");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That code didn't work. Try again.",
      );
      setPending(null);
    }
  }

  async function continueWith(provider: "google" | "github") {
    if (pending) return;
    setPending(provider);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to connect. Please try again.",
      );
      setPending(null);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#090e1b] text-white lg:grid-cols-[3fr_2fr]">
      {/* 60%: the DashyCore story, not a second auth form. */}
      <section className="relative isolate flex min-h-[280px] flex-col overflow-hidden border-b border-white/[0.08] bg-[#0b1326] px-6 py-7 sm:min-h-[360px] sm:px-12 sm:py-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-[max(4rem,7vw)] lg:py-12">
        <div
          aria-hidden="true"
          className="bg-grid pointer-events-none absolute inset-0 opacity-75 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-48 -top-56 h-[620px] w-[620px] rounded-full bg-cyan-400/[0.12] blur-[100px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-72 -right-40 h-[700px] w-[700px] rounded-full bg-violet-500/[0.17] blur-[110px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-15%] top-[20%] h-[650px] w-[650px] rounded-full border border-white/[0.07] shadow-[0_0_0_80px_rgba(255,255,255,0.016),0_0_0_160px_rgba(255,255,255,0.013)]"
        />

        <div className="relative flex items-center gap-3">
          <Image
            src="/icon-512.png"
            alt="DashyCore logo"
            width={42}
            height={42}
            priority
            className="h-10 w-10 rounded-xl"
          />
          <span className="text-lg font-semibold tracking-tight">
            DashyCore
          </span>
          <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/75 sm:block">
            The intelligent workspace
          </span>
        </div>

        <div className="relative z-10 my-auto max-w-2xl py-12 lg:py-20">
          <div className="mb-6 hidden items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.23em] text-cyan-300 sm:flex">
            <span className="h-px w-7 bg-cyan-400" /> All your momentum. One
            place.
          </div>
          <h1 className="text-[clamp(2.8rem,5.3vw,5.8rem)] font-semibold leading-[1.04] tracking-[-0.055em]">
            Think bigger.
            <br />
            <span className="text-gradient">Build faster.</span>
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-slate-300/75 sm:text-base sm:leading-8">
            Your ideas deserve more than another tab. Explore, create and share
            in one workspace powered by your best AI models.
          </p>

          {/* A compact workspace vignette; illustrative, not a fake login step. */}
          <div className="mt-10 hidden max-w-[580px] overflow-hidden rounded-2xl border border-white/[0.13] bg-[#101a2b]/90 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl lg:block">
            <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.035] px-5 py-3">
              <span className="h-2 w-2 rounded-full bg-cyan-300" />
              <span className="h-2 w-2 rounded-full bg-violet-400/70" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="ml-3 font-mono text-[10px] text-slate-400">
                workspace / your next idea
              </span>
              <SparklesIcon className="ml-auto h-3.5 w-3.5 text-cyan-300" />
            </div>
            <div className="grid grid-cols-[145px_1fr]">
              <div className="border-r border-white/[0.06] px-3 py-5 font-mono text-[10px] text-slate-400">
                <div className="mb-5 px-2 font-semibold uppercase tracking-widest text-slate-500">
                  Explorer
                </div>
                <div className="flex items-center gap-2 rounded-md bg-cyan-400/10 px-2 py-2 text-cyan-200">
                  <CodeIcon className="h-3 w-3" /> main.tsx
                </div>
                <div className="mt-1 px-2 py-2 text-slate-500">styles.css</div>
                <div className="mt-1 px-2 py-2 text-slate-500">ideas.md</div>
              </div>
              <div className="px-5 py-6 font-mono text-xs leading-7">
                <p className="text-slate-500">
                  // The beginning of something good
                </p>
                <p>
                  <span className="text-violet-300">const</span>{" "}
                  <span className="text-cyan-300">possibility</span> ={" "}
                  <span className="text-emerald-300">"endless"</span>;
                </p>
                <p>
                  <span className="text-violet-300">export default</span>{" "}
                  <span className="text-cyan-300">create</span>(possibility);
                </p>
                <div className="mt-5 flex items-center gap-2 rounded-lg border border-cyan-300/10 bg-cyan-300/[0.06] px-3 py-2.5 text-[11px] text-slate-300">
                  <SparklesIcon className="h-3.5 w-3.5 text-cyan-300" /> Ready
                  when inspiration strikes{" "}
                  <span className="ml-auto text-cyan-300">↗</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative hidden items-center justify-between border-t border-white/[0.09] pt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 lg:flex">
          <span>Chat · Code · Create</span>
          <span>Built for what&apos;s next / 01</span>
        </div>
      </section>

      {/* 40%: only the OTP flow and the two social providers. */}
      <section className="relative flex min-h-[600px] items-center justify-center px-6 py-12 sm:px-12 lg:min-h-screen lg:px-[clamp(2rem,5vw,6rem)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_100%_100%,rgba(117,73,196,0.08),transparent_55%)]"
        />
        <div className="relative w-full max-w-[420px]">
          <p className="mb-5 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.19em] text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> Your space
            awaits
          </p>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Welcome back<span className="text-cyan-300">.</span>
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            A secure sign-in is all that stands between you and your next
            breakthrough.
          </p>

          {!codeSent ? (
            <form
              onSubmit={(event) => void sendCode(event)}
              className="mt-9 space-y-4"
            >
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-xs font-semibold text-zinc-200"
                >
                  Email address
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-white/[0.13] bg-white/[0.035] px-4 transition-colors focus-within:border-cyan-400/60 focus-within:bg-white/[0.05]">
                  <MailIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    disabled={pending !== null}
                    placeholder="you@example.com"
                    className="h-13 min-w-0 flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none disabled:opacity-50"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={pending !== null}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06242d] shadow-[0_12px_34px_rgba(34,211,238,0.16)] transition-all hover:bg-cyan-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending === "send" ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06242d]/25 border-t-[#06242d]" />
                ) : (
                  <MailIcon className="h-4 w-4" />
                )}
                {pending === "send"
                  ? "Sending your code…"
                  : "Continue with email"}
                {pending !== "send" && (
                  <ArrowUpRightIcon className="ml-auto h-4 w-4" />
                )}
              </button>
              <p className="text-center text-[11px] text-zinc-500">
                No password needed. We&apos;ll email you a one-time code.
              </p>
            </form>
          ) : (
            <form
              onSubmit={(event) => void verifyCode(event)}
              className="mt-9 space-y-4"
            >
              <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-xs text-cyan-100">
                <span className="flex items-center gap-2 font-semibold">
                  <CheckIcon className="h-4 w-4" /> Check your inbox
                </span>
                <span className="mt-1.5 block text-cyan-100/70">
                  Code sent to {email}
                </span>
              </div>
              <div>
                <label
                  htmlFor="otp-code"
                  className="mb-2 block text-xs font-semibold text-zinc-200"
                >
                  Verification code
                </label>
                <input
                  ref={codeInputRef}
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6,8}"
                  minLength={6}
                  maxLength={8}
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                  disabled={pending !== null}
                  placeholder="••••••"
                  className="h-13 w-full rounded-xl border border-white/[0.13] bg-white/[0.035] px-4 font-mono text-lg tracking-[0.28em] text-white placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/60 disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={pending !== null || code.length < 6}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#06242d] transition-all hover:bg-cyan-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending === "verify" ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06242d]/25 border-t-[#06242d]" />
                ) : (
                  <LockIcon className="h-4 w-4" />
                )}
                {pending === "verify" ? "Verifying…" : "Verify and continue"}
              </button>
              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    setCodeSent(false);
                    setCode("");
                    setError(null);
                    setMessage(null);
                  }}
                  className="text-zinc-400 underline underline-offset-4 transition-colors hover:text-white disabled:opacity-50"
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  disabled={pending !== null || cooldown > 0}
                  onClick={() => void sendCode()}
                  className="font-semibold text-cyan-300 transition-colors hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-zinc-500"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-4 py-3 text-xs leading-relaxed text-red-200"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              role="status"
              className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-xs leading-relaxed text-emerald-200"
            >
              {message}
            </p>
          )}

          <div className="my-8 flex items-center gap-4">
            <span className="h-px flex-1 bg-white/[0.09]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              or continue with
            </span>
            <span className="h-px flex-1 bg-white/[0.09]" />
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => void continueWith("google")}
              disabled={pending !== null}
              className="flex h-12 w-full items-center gap-3 rounded-xl border border-white/[0.14] bg-white px-4 text-sm font-semibold text-[#111827] transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0"
                aria-hidden="true"
              >
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
              {pending === "google"
                ? "Connecting to Google…"
                : "Continue with Google"}
              <ArrowUpRightIcon className="ml-auto h-4 w-4 text-zinc-500" />
            </button>
            <button
              type="button"
              onClick={() => void continueWith("github")}
              disabled={pending !== null}
              className="flex h-12 w-full items-center gap-3 rounded-xl border border-white/[0.14] bg-white/[0.055] px-4 text-sm font-semibold text-zinc-100 transition-colors hover:border-white/[0.3] hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GithubIcon className="h-5 w-5" />
              {pending === "github"
                ? "Connecting to GitHub…"
                : "Continue with GitHub"}
              <ArrowUpRightIcon className="ml-auto h-4 w-4 text-zinc-500" />
            </button>
          </div>

          <p className="mt-10 flex items-center justify-center gap-2 border-t border-white/[0.07] pt-6 text-center text-[11px] text-zinc-500">
            <LockIcon className="h-3.5 w-3.5" /> Private by default. Secure by
            design.
          </p>
        </div>
      </section>
    </main>
  );
}
