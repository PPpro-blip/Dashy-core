"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GithubIcon } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oauth = async (provider: "google" | "github") => {
    setLoading(true); setError(null);
    const { error: authError } = await createClient().auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (authError) { setError(authError.message); setLoading(false); }
  };

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    const { error: authError } = await createClient().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (authError) setError(authError.message); else setSent(true);
    setLoading(false);
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    const { error: authError } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
    if (authError) { setError(authError.message); setLoading(false); } else router.push("/chat");
  };

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-6 py-16"><div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-40" /><div className="relative z-10 w-full max-w-md">
    <div className="mb-8 flex items-center justify-center gap-3"><Image src="/icon-512.png" alt="DashyCore Logo" width={36} height={36} /><span className="text-lg font-semibold text-neutral-100">DashyCore</span></div>
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/80 backdrop-blur-xl md:p-10">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome to <span className="text-gradient">DashyCore</span></h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">Sign in securely with a one-time email code, or continue with a provider.</p>
      <div className="my-8 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
      <form onSubmit={sent ? verifyCode : sendCode} className="space-y-4">
        <div><label htmlFor="email" className="mb-2 block text-sm font-medium text-neutral-300">Email</label><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading || sent} placeholder="you@example.com" className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder-zinc-500 focus:border-cyan-400/60 disabled:opacity-60" /></div>
        {sent && <div><label htmlFor="otp" className="mb-2 block text-sm font-medium text-neutral-300">6-digit one-time code</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required disabled={loading} placeholder="000000" className="w-full rounded-lg border border-cyan-400/30 bg-white/[0.04] px-4 py-3 text-center text-lg tracking-[0.5em] text-white outline-none focus:border-cyan-400" /></div>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-cyan-500 px-5 py-3.5 text-sm font-semibold text-[#06202a] hover:bg-cyan-400 disabled:opacity-60">{loading ? "Please wait…" : sent ? "Verify Code" : "Send One-Time Code"}</button>
        {sent && <button type="button" onClick={() => { setSent(false); setCode(""); }} className="w-full text-xs text-zinc-500 hover:text-zinc-300">Use a different email</button>}
      </form>
      <div className="my-6 flex items-center gap-4"><div className="h-px flex-1 bg-white/[0.08]" /><span className="text-xs text-neutral-500">or continue with</span><div className="h-px flex-1 bg-white/[0.08]" /></div>
      <div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => oauth("google")} disabled={loading} className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-neutral-950 hover:bg-neutral-100 disabled:opacity-60">Google</button><button type="button" onClick={() => oauth("github")} disabled={loading} className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-[#24292f] px-4 py-3 text-sm font-medium text-white hover:bg-[#2f353d] disabled:opacity-60"><GithubIcon className="h-5 w-5" /> GitHub</button></div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">{error}</p>}
    </section>
  </div></main>;
}
