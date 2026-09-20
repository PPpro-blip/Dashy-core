"use client";

/**
 * DashyCore v7 — Studio: the bulletproof image engine.
 *
 * ZERO-LOGIC LOADING. The browser never fetches from a 3rd party:
 *
 *   1. "Generate" builds a same-origin URL: /api/img-proxy?prompt=…&seed=…
 *   2. That URL goes straight into a standard <img src>.
 *   3. The BROWSER owns the connection + native loading behaviour. Our
 *      server (app/api/img-proxy) does the slow Pollinations fetch with a
 *      50s budget, so the tab keeps a healthy same-origin request open.
 *   4. <img onLoad> flips the card to done; <img onError> flips it to a
 *      friendly retry state. No fetch(), no AbortController, no state
 *      machine — the platform does the work.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ImageIcon,
  LoaderIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";

interface Generation {
  id: string;
  prompt: string;
  seed: number;
  /** Same-origin proxy URL — the ONLY thing the browser talks to. */
  src: string;
  status: "loading" | "done" | "error";
}

const SUGGESTIONS = [
  "A neon cyberpunk city at night, rain-slick streets, cinematic",
  "Isometric floating island with a tiny lighthouse, pastel colors",
  "Macro photo of a dew-covered leaf at golden hour",
  "Retro-futuristic control room, CRT monitors, teal and orange",
];

function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function proxyUrl(prompt: string, seed: number): string {
  return `/api/img-proxy?prompt=${encodeURIComponent(prompt)}&seed=${seed}`;
}

export default function StudioPage() {
  const [prompt, setPrompt] = useState("");
  const [generations, setGenerations] = useState<Generation[]>([]);
  const idRef = useRef(0);

  const anyLoading = useMemo(
    () => generations.some((g) => g.status === "loading"),
    [generations]
  );

  const handleGenerate = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const seed = newSeed();
    idRef.current += 1;
    const generation: Generation = {
      id: `gen-${Date.now()}-${idRef.current}`,
      prompt: trimmed,
      seed,
      src: proxyUrl(trimmed, seed),
      status: "loading",
    };
    setGenerations((prev) => [generation, ...prev]);
  }, [prompt]);

  const handleRetry = useCallback((id: string) => {
    setGenerations((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const seed = newSeed();
        return { ...g, seed, src: proxyUrl(g.prompt, seed), status: "loading" };
      })
    );
  }, []);

  const handleRemove = useCallback((id: string) => {
    setGenerations((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const setStatus = useCallback((id: string, status: Generation["status"]) => {
    setGenerations((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status } : g))
    );
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {/* Hero */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 shadow-lg shadow-cyan-500/10">
          <ImageIcon className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Studio <span className="text-cyan-400">Image Engine</span>
          </h1>
          <p className="text-xs text-zinc-500">
            Server-side streaming · turbo model · zero client fetch logic
          </p>
        </div>
      </div>

      {/* Prompt composer */}
      <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 focus-within:border-cyan-400/30">
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="Describe the image you want to create…"
            rows={2}
            className="max-h-40 min-h-[54px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="flex h-11 flex-shrink-0 items-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 hover:shadow-cyan-400/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          >
            <SparklesIcon className="h-4 w-4" />
            Generate
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 px-1 pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPrompt(s)}
              className="max-w-full truncate rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {anyLoading && (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
          Rendering on the server — slow prompts can take up to 50 seconds.
          The connection stays open; no need to refresh.
        </p>
      )}

      {/* Grid */}
      {generations.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-white/[0.08] px-6 py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
            <ImageIcon className="h-6 w-6 text-cyan-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-zinc-200">
            Nothing generated yet
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Type a prompt above and hit Generate — images stream straight
            from the DashyCore server.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {generations.map((gen) => (
            <figure
              key={gen.id}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]"
            >
              <div className="relative aspect-square w-full">
                {/* Shimmer scaffold behind the native <img> load. */}
                {gen.status === "loading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-cyan-500/[0.06] via-transparent to-violet-500/[0.06]">
                    <LoaderIcon className="h-6 w-6 animate-spin text-cyan-400" />
                    <span className="px-6 text-center text-[11px] leading-relaxed text-zinc-500">
                      Generating… the browser keeps this connection open to
                      our server
                    </span>
                  </div>
                )}

                {gen.status === "error" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-500/[0.04] px-6 text-center">
                    <span className="text-xs font-medium text-red-300">
                      Generation failed
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRetry(gen.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20"
                    >
                      <RefreshIcon className="h-3 w-3" />
                      Retry with new seed
                    </button>
                  </div>
                ) : (
                  /*
                   * THE engine: a plain <img> pointed at our own server.
                   * key includes the seed so a retry forces a fresh element
                   * (and a fresh request) instead of a cached error state.
                   */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${gen.id}-${gen.seed}`}
                    src={gen.src}
                    alt={gen.prompt}
                    onLoad={() => setStatus(gen.id, "done")}
                    onError={() => setStatus(gen.id, "error")}
                    className={`h-full w-full object-cover transition-opacity duration-500 ${
                      gen.status === "done" ? "opacity-100" : "opacity-0"
                    }`}
                  />
                )}
              </div>

              <figcaption className="flex items-start gap-2 border-t border-white/[0.06] px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-zinc-300">
                    {gen.prompt}
                  </span>
                  <span className="block text-[10px] text-zinc-600">
                    seed {gen.seed} · turbo
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleRetry(gen.id)}
                    title="Regenerate with a new seed"
                    aria-label="Regenerate"
                    className="rounded-md p-1 text-zinc-500 transition-colors hover:text-cyan-300"
                  >
                    <RefreshIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(gen.id)}
                    title="Remove from grid"
                    aria-label="Remove"
                    className="rounded-md p-1 text-zinc-500 transition-colors hover:text-red-400"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
