"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { resendOtp, verifyOtpCode } from "@/lib/auth/actions";
import {
  isValidEmail,
  isValidOtpToken,
  maskEmail,
  normalizeEmail,
  normalizeOtpToken,
  safeRedirectPath,
  DEFAULT_POST_AUTH_PATH,
  RESEND_COOLDOWN_SECONDS,
  type AuthMode,
} from "@/lib/auth/otp";

/**
 * DashyCore — OTP verification screen (AUTH-01, screen 3).
 *
 * Reached after requesting a code on /login. Verifies the typed OTP against
 * Supabase Auth (type 'email' per the installed SDK contract, for both
 * signup and sign-in). On success the session is already persisted in
 * cookies by the @supabase/ssr browser client; we then route into the app
 * and refresh so the server re-reads the session.
 *
 * Guarantees: duplicate submissions are blocked, loading always resets in
 * `finally`, resend has a cooldown, and wrong/expired codes get clear errors.
 */

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode: AuthMode =
    searchParams.get("mode") === "signup" ? "signup" : "signin";
  const email = normalizeEmail(searchParams.get("email") ?? "");
  const next = safeRedirectPath(
    searchParams.get("next"),
    DEFAULT_POST_AUTH_PATH
  );

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const busyRef = useRef(false);

  // A code was just sent when arriving here — start the resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  const submitVerification = useCallback(
    async (rawToken: string) => {
      if (busyRef.current) return; // duplicate-submission guard
      const normalized = normalizeOtpToken(rawToken);
      if (!isValidOtpToken(normalized)) {
        setError(`Enter the ${6}-digit code from the email.`);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const { error: verifyError } = await verifyOtpCode(email, normalized, mode);
        if (verifyError) {
          setError(verifyError);
          setToken("");
        } else {
          setNotice("Verified — signing you in…");
          router.push(next);
          router.refresh();
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [email, mode, next, router]
  );

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitVerification(token);
  };

  const handleTokenChange = (value: string) => {
    const normalized = normalizeOtpToken(value).slice(0, 8);
    setToken(normalized);
    setError(null);
    // Auto-submit when the code is complete (still guarded against dupes).
    if (isValidOtpToken(normalized)) {
      void submitVerification(normalized);
    }
  };

  const handleResend = async () => {
    if (busyRef.current || resending || cooldown > 0) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const { error: resendError } = await resendOtp(email, mode, next);
      if (resendError) {
        setError(resendError);
      } else {
        setNotice("A new code was sent to your email.");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setToken("");
      }
    } finally {
      setResending(false);
    }
  };

  const handleChangeEmail = () => {
    const params = new URLSearchParams({ mode, email, next });
    router.push(`/login?${params.toString()}`);
  };

  if (!isValidEmail(email)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-navy px-6">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-center backdrop-blur-xl">
          <p className="text-sm text-zinc-300">
            No email address was provided for verification.
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="mt-4 w-full rounded-xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-[#06202a] transition-all hover:bg-cyan-400"
          >
            Back to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-6 py-16">
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-cyan-500/10 via-violet-500/5 to-transparent blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md">
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

        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/80 backdrop-blur-xl md:p-10">
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            We sent a {6}-digit verification code to{" "}
            <span className="font-medium text-neutral-200">{maskEmail(email)}</span>.
            Enter it below to{" "}
            {mode === "signup" ? "create your account" : "sign in"}.
          </p>

          <form onSubmit={handleVerify} className="mt-8 space-y-4">
            <div>
              <label htmlFor="otp" className="mb-2 block text-sm font-medium text-neutral-300">
                Verification code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={token}
                onChange={(e) => handleTokenChange(e.target.value)}
                required
                disabled={busy}
                autoFocus
                aria-describedby="otp-hint"
                className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-zinc-500 transition-colors focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="••••••"
              />
              <p id="otp-hint" className="mt-2 text-xs text-zinc-500">
                The code expires after a short time. Didn&apos;t get it? Check spam, or resend.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy || !isValidOtpToken(token)}
              className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] shadow-md shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
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
          </form>

          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleChangeEmail}
              disabled={busy || resending}
              className="text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={busy || resending || cooldown > 0}
              className="text-cyan-300 underline-offset-2 transition-colors hover:text-cyan-200 hover:underline disabled:cursor-not-allowed disabled:text-zinc-500 disabled:no-underline"
            >
              {resending
                ? "Sending…"
                : cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : "Resend code"}
            </button>
          </div>

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs leading-relaxed text-red-300"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              aria-live="polite"
              className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs leading-relaxed text-emerald-300"
            >
              {notice}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

export default function VerifyPage() {
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
      <VerifyForm />
    </Suspense>
  );
}
