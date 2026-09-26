"use client";

import { useState } from "react";
import { XIcon } from "@/components/icons";

export function ShareHubModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const encoded = encodeURIComponent(url);
  const share = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* fallback links remain available */ } };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Share Hub" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#11152b] p-5 shadow-2xl shadow-black/60"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-white">Share project</h2><p className="mt-1 max-w-[280px] truncate text-xs text-zinc-500">{title}</p></div><button onClick={onClose} aria-label="Close share hub" className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.06] hover:text-white"><XIcon className="h-4 w-4" /></button></div><div className="mt-5 grid grid-cols-2 gap-2"><a href={`https://twitter.com/intent/tweet?url=${encoded}&text=${encodeURIComponent(title)}`} target="_blank" rel="noreferrer" className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-center text-sm text-zinc-200 hover:border-cyan-400/30">Share to X</a><a href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`} target="_blank" rel="noreferrer" className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-center text-sm text-zinc-200 hover:border-emerald-400/30">WhatsApp</a></div><button onClick={() => void share()} className="mt-3 w-full rounded-xl bg-cyan-500 px-3 py-2.5 text-sm font-semibold text-[#06202a] hover:bg-cyan-400">{copied ? "Link copied" : "Copy link"}</button></div>
  </div>;
}
