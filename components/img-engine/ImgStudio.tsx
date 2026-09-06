"use client";
import { useEffect, useState } from "react";
import { buildPollinationsFallbacks, loadImage, type ImgEngineParams } from "@/lib/img-engine";

type Item = { id: string; status: "loading" | "ready" | "error"; url?: string; prompt: string; seed: string; model: ImgEngineParams["model"]; createdAt: number };
const sizes: Record<string, [number, number]> = { "1:1": [1024,1024], "16:9": [1280,720], "9:16": [720,1280], "4:3": [1152,864] };
const KEY = "dashy.img.studio.history";

export default function ImgStudio({ initialPrompt, onClose, onSendToChat }: { initialPrompt?: string; onClose: () => void; onSendToChat: (item: Item) => void }) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [aspect, setAspect] = useState("1:1");
  const [model, setModel] = useState<ImgEngineParams["model"]>("flux");
  const [random, setRandom] = useState(true);
  const [seed, setSeed] = useState("");
  const [history, setHistory] = useState<Item[]>([]);
  const [active, setActive] = useState<Item | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => { try { setHistory(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {} }, []);
  useEffect(() => { if (!active || active.status !== "loading") return; const t = window.setInterval(() => setElapsed(x => x + 1), 1000); return () => clearInterval(t); }, [active]);
  const persist = (items: Item[]) => { setHistory(items.slice(0, 12)); try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 12))); } catch {} };
  const generate = async (retryItem?: Item) => {
    const text = (retryItem?.prompt ?? prompt).trim(); if (!text) return;
    const [width, height] = sizes[aspect] ?? sizes["1:1"];
    const item: Item = retryItem ? { ...retryItem, status: "loading" } : { id: crypto.randomUUID(), status: "loading", prompt: text, seed: random ? `${Date.now()}_${Math.floor(Math.random()*1e6)}` : seed, model, createdAt: Date.now() };
    setActive(item); setElapsed(0); persist([item, ...history.filter(x => x.id !== item.id)]);
    const urls = buildPollinationsFallbacks({ prompt: item.prompt, width, height, seed: item.seed, model: item.model });
    for (const url of urls) { try { await loadImage(url); const ready = { ...item, status: "ready" as const, url }; setActive(ready); persist([ready, ...history.filter(x => x.id !== item.id)]); return; } catch {} }
    const failed = { ...item, status: "error" as const }; setActive(failed); persist([failed, ...history.filter(x => x.id !== item.id)]);
  };
  const download = async () => { if (!active?.url) return; const a = document.createElement("a"); a.href = active.url; a.download = "dashy-image.png"; a.target = "_blank"; a.click(); };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
    <section className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-y-auto rounded-t-3xl border border-cyan-400/20 bg-[#0b1224] shadow-2xl shadow-cyan-950/50 sm:rounded-3xl">
      <header className="flex items-center justify-between border-b border-white/[.08] px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-cyan-300">&lt;IMG&gt; ENGINE · Studio</p><p className="mt-1 text-xs text-zinc-500">Generate without interrupting your chat</p></div><button onClick={onClose} className="text-2xl text-zinc-500 hover:text-white">×</button></header>
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_1.1fr]">
        <div><textarea autoFocus value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="A cyberpunk cat in neon rain" className="h-32 w-full resize-none rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm text-white outline-none focus:border-cyan-400" />
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><label>Aspect<select value={aspect} onChange={e=>setAspect(e.target.value)} className="mt-1 block w-full rounded-lg bg-white/10 p-2">{Object.keys(sizes).map(x=><option key={x}>{x}</option>)}</select></label><label>Model<select value={model} onChange={e=>setModel(e.target.value as ImgEngineParams["model"])} className="mt-1 block w-full rounded-lg bg-white/10 p-2"><option value="flux">Flux</option><option value="turbo">Turbo</option><option value="default">Default</option></select></label></div>
          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={random} onChange={e=>setRandom(e.target.checked)} /> Random seed</label>{!random && <input value={seed} onChange={e=>setSeed(e.target.value)} placeholder="Seed" className="mt-2 w-full rounded-lg bg-white/10 p-2 text-sm" />}
          <button onClick={()=>void generate()} disabled={!prompt.trim()} className="mt-5 w-full rounded-xl bg-cyan-400 py-3 font-bold text-[#06131c] disabled:opacity-40">{active?.status === "loading" ? `Generating · ${elapsed}s` : "Generate image"}</button>
          <div className="mt-5 flex flex-wrap gap-2">{["cyberpunk cat", "logo mockup", "cinematic landscape", "product photo"].map(x=><button key={x} onClick={()=>setPrompt(x)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:border-cyan-400 hover:text-cyan-300">{x}</button>)}</div>
        </div>
        <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-white/[.08] bg-black/20 p-3">{active?.url && active.status === "ready" ? <div className="w-full"><img src={active.url} alt={active.prompt} className="mx-auto max-h-[52vh] w-full rounded-xl object-contain" /><div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>void download()} className="rounded-lg bg-white/10 px-3 py-2 text-xs">Download</button><button onClick={()=>navigator.clipboard?.writeText(active.url!)} className="rounded-lg bg-white/10 px-3 py-2 text-xs">Copy URL</button><button onClick={()=>navigator.clipboard?.writeText(active.prompt)} className="rounded-lg bg-white/10 px-3 py-2 text-xs">Copy prompt</button><button onClick={()=>void generate(active)} className="rounded-lg bg-white/10 px-3 py-2 text-xs">Variation</button><button onClick={()=>onSendToChat(active)} className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-[#06131c]">Send to chat</button></div></div> : active?.status === "error" ? <div className="text-center"><p className="text-sm text-red-300">The image engine didn’t respond.</p><button onClick={()=>void generate(active)} className="mt-3 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-bold text-black">Retry</button><button onClick={()=>{setModel("flux");void generate({...active,model:"flux"})}} className="ml-2 rounded-lg bg-white/10 px-4 py-2 text-xs">Try Flux</button></div> : <p className="text-sm text-zinc-600">Your generated image will appear here.</p>}</div>
      </div><div className="border-t border-white/[.08] p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Session history</p><div className="flex gap-3 overflow-x-auto">{history.map(x=><button key={x.id} onClick={()=>setActive(x)} className="w-20 shrink-0 text-left"><div className="h-16 overflow-hidden rounded-lg bg-white/10">{x.url&&<img src={x.url} className="h-full w-full object-cover" alt=""/>}</div><span className="mt-1 block truncate text-[10px] text-zinc-500">{x.prompt}</span></button>)}</div></div>
    </section></div>;
}
