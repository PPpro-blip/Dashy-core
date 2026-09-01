"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, ShareIcon, ZapIcon } from "@/components/icons";
import { buildShareIntents, shareText } from "@/lib/share-intents";
import { ShareQr } from "./ShareQr";

const apps = [
  ["WhatsApp", "WA"], ["Facebook", "f"], ["X", "𝕏"], ["Telegram", "TG"],
  ["LinkedIn", "in"], ["Reddit", "rd"], ["Email", "✉"],
] as const;

export function ShareHub({ title, description, url, fileCount }: { title: string; description: string | null; url: string; fileCount: number }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [deviceShare, setDeviceShare] = useState(false);
  useEffect(() => setDeviceShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  const intents = buildShareIntents(title, url);
  const text = shareText(title, url);
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(null), 2200); } catch { setCopied(null); }
  }
  return <section className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
    <div className="mb-8 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300"><ZapIcon className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Share Hub</p><h1 className="text-2xl font-semibold tracking-tight text-white">Send this project anywhere</h1></div></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_200px]">
      <div className="rounded-3xl border border-cyan-300/10 bg-white/[0.035] p-6 shadow-2xl shadow-cyan-950/20"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs text-cyan-300">D-CODE PROJECT</p><h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>{description && <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">{description}</p>}</div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">{fileCount} {fileCount === 1 ? "file" : "files"}</span></div>
        <div className="flex gap-2 rounded-xl border border-white/10 bg-black/20 p-2"><input readOnly value={url} className="min-w-0 flex-1 bg-transparent px-2 text-xs text-zinc-300 outline-none"/><button onClick={() => void copy("link", url)} className="flex shrink-0 items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-[#06202a]">{copied === "link" ? <CheckIcon className="h-3.5 w-3.5"/> : <CopyIcon className="h-3.5 w-3.5"/>}{copied === "link" ? "Copied" : "Copy link"}</button></div>
        {deviceShare && <button onClick={() => void navigator.share({ title, text, url })} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 py-3.5 text-sm font-bold text-[#06202a] hover:bg-cyan-300"><ShareIcon className="h-4 w-4"/>Share via device</button>}
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">{apps.map(([label, mark]) => <a key={label} href={intents[label as keyof typeof intents]} target="_blank" rel="noopener noreferrer" className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] text-sm text-zinc-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10"><b className="text-lg text-cyan-300">{mark}</b>{label}</a>)}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><button onClick={() => void copy("instagram", `${text}`)} className="rounded-xl border border-pink-300/20 bg-pink-300/5 p-3 text-left text-sm text-zinc-200"><b>Instagram</b><span className="block text-xs text-zinc-500">{copied === "instagram" ? "Caption copied — paste into Story, bio, or DM" : "Copy caption + link"}</span></button><button onClick={() => void copy("youtube", url)} className="rounded-xl border border-red-300/20 bg-red-300/5 p-3 text-left text-sm text-zinc-200"><b>YouTube</b><span className="block text-xs text-zinc-500">{copied === "youtube" ? "Link copied for your description" : "Copy link for description"}</span></button></div>
      </div><div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.025] p-5"><ShareQr value={url}/><p className="mt-4 text-center text-xs text-zinc-500">Scan to open this public project</p></div>
    </div>
  </section>;
}
