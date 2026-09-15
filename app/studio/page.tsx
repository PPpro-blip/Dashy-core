"use client";

import { useCallback, useState } from "react";

type Tile = { id: number; prompt: string; url?: string; status: "loading" | "ready" | "error" };

function imageUrl(prompt: string, width: number, height: number, seed: number) {
  const source = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  return `/api/img-proxy?url=${encodeURIComponent(source)}`;
}

export default function StudioPage() {
  const [prompt, setPrompt] = useState("");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [busy, setBusy] = useState(false);

  const generate = useCallback((promptOverride?: string) => {
    const value = (promptOverride ?? prompt).trim();
    if (!value || busy) return;
    const id = Date.now();
    const tile: Tile = { id, prompt: value, status: "loading" };
    setTiles((current) => [tile, ...current]);
    setPrompt(value);
    setBusy(true);
    const src = imageUrl(value, 1024, 1024, id);
    const image = new Image();
    let finished = false;
    const finish = (status: Tile["status"]) => {
      if (finished) return;
      finished = true;
      setTiles((current) => current.map((item) => item.id === id ? { ...item, status, url: status === "ready" ? src : undefined } : item));
      setBusy(false);
    };
    image.onload = () => finish("ready");
    image.onerror = () => finish("error");
    image.src = src;
    window.setTimeout(() => finish("error"), 25_000);
  }, [busy, prompt]);

  const clearFailed = () => setTiles((current) => current.filter((tile) => tile.status !== "error"));

  return (
    <main className="min-h-screen bg-[#080b14] px-6 py-10 text-white md:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Dashy Studio</p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Make something visual.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">Turn a thought into an image with the fast, focused Dashy Vision engine.</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px] shadow-cyan-300" />
            <span className="text-sm font-semibold text-cyan-100">&lt;IMG&gt; Engine</span>
            <span className="text-xs text-cyan-300/60">Dashy Vision</span>
          </div>
        </header>

        <section className="rounded-3xl border border-white/[0.09] bg-white/[0.035] p-3 shadow-2xl shadow-black/20 md:p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } }} placeholder="Describe the image you want to create…" rows={2} className="min-h-14 flex-1 resize-none rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-400/50" />
            <button onClick={() => generate()} disabled={busy || !prompt.trim()} className="rounded-2xl bg-cyan-400 px-7 py-3 text-sm font-bold text-[#06202a] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Rendering…" : "Generate"}</button>
          </div>
          <p className="mt-2 px-1 text-[11px] text-zinc-600">Press Enter to generate · Shift + Enter for a new line · Images are securely proxied.</p>
        </section>

        {tiles.length > 0 && <div className="mt-8 flex justify-end"><button onClick={clearFailed} className="text-xs text-zinc-500 transition hover:text-red-300">Clear Failed</button></div>}
        <section className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => <article key={tile.id} className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.03]">
            <div className="aspect-square bg-[#0c1020]">
              {tile.status === "ready" && tile.url ? <img src={tile.url} alt={tile.prompt} className="h-full w-full object-cover" /> : tile.status === "loading" ? <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500"><span className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" /><span className="text-xs">Creating your image…</span></div> : <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><span className="text-sm text-red-300">This image took too long to create.</span><button onClick={() => generate(tile.prompt)} className="rounded-xl border border-red-300/30 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-400/10">Retry</button></div>}
            </div>
            <p className="truncate px-4 py-3 text-xs text-zinc-400">{tile.prompt}</p>
          </article>)}
        </section>
      </div>
    </main>
  );
}
