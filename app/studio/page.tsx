"use client";

/**
 * DashyCore — Studio (never-fail image engine).
 *
 * Server-side proxy first: Generate sets the <img> src to OUR
 * /api/img-proxy, which waits up to 45s for the upstream pollinations.ai
 * render and then streams the finished bytes back. The browser sees one
 * fast, complete download — no more abandoned "failed to load" images.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImageIcon,
  LoaderIcon,
  RefreshIcon,
  SparklesIcon,
  ZapIcon,
} from "@/components/icons";

const SIZE_PRESETS = [
  { id: "square", label: "Square", width: 1024, height: 1024 },
  { id: "wide", label: "Wide", width: 1280, height: 720 },
  { id: "tall", label: "Tall", width: 768, height: 1152 },
] as const;

type SizeId = (typeof SIZE_PRESETS)[number]["id"];
type Status = "idle" | "loading" | "ready" | "error";

interface Generation {
  url: string;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  turbo: boolean;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function buildProxyUrl(prompt: string, seed: number, width: number, height: number, turbo: boolean): string {
  const params = new URLSearchParams({
    prompt,
    seed: String(seed),
    width: String(width),
    height: String(height),
    turbo: turbo ? "true" : "false",
  });
  return `/api/img-proxy?${params.toString()}`;
}

const PROMPT_IDEAS = [
  "A cyberpunk cat in neon rain, cinematic lighting",
  "Cozy cabin in a snowy forest at dusk, warm windows",
  "Floating islands above pink clouds, epic fantasy art",
  "Minimalist logo of a rocket, flat vector style",
];

export default function StudioPage() {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [sizeId, setSizeId] = useState<SizeId>("square");
  const [turbo, setTurbo] = useState(true);
  const [seed, setSeed] = useState<number>(1);
  const [status, setStatus] = useState<Status>("idle");
  const [current, setCurrent] = useState<Generation | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const startedAtRef = useRef(0);

  /* Randomize the seed on mount (client-only — avoids SSR mismatch). */
  useEffect(() => {
    setSeed(randomSeed());
  }, []);

  /* Elapsed-seconds ticker while a render is in flight. */
  useEffect(() => {
    if (status !== "loading") return;
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  const size = SIZE_PRESETS.find((s) => s.id === sizeId) ?? SIZE_PRESETS[0];

  const handleGenerate = useCallback(() => {
    const clean = prompt.trim();
    if (!clean || status === "loading") {
      if (!clean) {
        toast.error(
          "Describe an image first",
          "Type what you want to generate, then hit Generate."
        );
      }
      return;
    }
    const url = buildProxyUrl(clean, seed, size.width, size.height, turbo);
    startedAtRef.current = Date.now();
    setError(null);
    // Setting src immediately: the proxy holds the connection (up to 45s)
    // while the AI renders, then streams the finished image.
    setCurrent({ url, prompt: clean, seed, width: size.width, height: size.height, turbo });
    setStatus("loading");
  }, [prompt, seed, size.height, size.width, status, toast, turbo]);

  const handleImgLoad = useCallback(() => {
    setStatus((prev) => {
      if (prev !== "loading") return prev;
      return "ready";
    });
    setCurrent((gen) => {
      if (gen) {
        setHistory((prev) => {
          if (prev.some((g) => g.url === gen.url)) return prev;
          return [gen, ...prev].slice(0, 8);
        });
      }
      return gen;
    });
  }, []);

  const handleImgError = useCallback(() => {
    setStatus((prev) => (prev === "loading" ? "error" : prev));
    setError(
      "The render didn't come back in time. The engine is likely just busy — hit Retry."
    );
  }, []);

  const handleRetry = useCallback(() => {
    if (!current) return;
    startedAtRef.current = Date.now();
    setError(null);
    // Cache-bust so the browser re-requests even though the URL matches.
    setCurrent({ ...current, url: `${current.url}&retry=${Date.now()}` });
    setStatus("loading");
  }, [current]);

  const handleShuffleSeed = useCallback(() => {
    setSeed(randomSeed());
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${current.url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed", "Clipboard access was denied.");
    }
  }, [current, toast]);

  const handleDownload = useCallback(async () => {
    if (!current || downloading) return;
    setDownloading(true);
    try {
      // Same URL = same bytes (seed-pinned), served from cache after first load.
      const res = await fetch(current.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `dashycore-studio-${current.seed}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      toast.success("Download started", "Your Studio render is on its way.");
    } catch {
      toast.error("Download failed", "Try opening the full-size image instead.");
    } finally {
      setDownloading(false);
    }
  }, [current, downloading, toast]);

  const loadFromHistory = useCallback((gen: Generation) => {
    if (status === "loading") return;
    setError(null);
    setCurrent(gen);
    setStatus("loading");
    startedAtRef.current = Date.now();
  }, [status]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
          <ImageIcon className="h-5 w-5 text-cyan-400" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Studio</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Never-fail image engine · renders stream through our server-side proxy
          </p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Controls */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <label htmlFor="studio-prompt" className="mb-1.5 block text-xs font-medium text-zinc-400">
              Prompt
            </label>
            <textarea
              id="studio-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
              }}
              placeholder="A cyberpunk cat in neon rain…"
              rows={4}
              className="w-full resize-none rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50"
            />

            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-zinc-400">Size</p>
              <div className="grid grid-cols-3 gap-1.5">
                {SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSizeId(preset.id)}
                    aria-pressed={sizeId === preset.id}
                    className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                      sizeId === preset.id
                        ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-300"
                        : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:border-white/[0.2] hover:text-zinc-300"
                    }`}
                  >
                    <span className="block text-xs font-semibold">{preset.label}</span>
                    <span className="mt-0.5 block font-mono text-[10px] opacity-70">
                      {preset.width}×{preset.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-xs font-medium text-zinc-400">Seed</p>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value) || 0)}
                    aria-label="Random seed"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-black/30 px-3 font-mono text-sm text-zinc-200 outline-none transition-colors focus:border-cyan-400/50"
                  />
                  <button
                    type="button"
                    onClick={handleShuffleSeed}
                    title="Randomize seed"
                    aria-label="Randomize seed"
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-400">Turbo</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={turbo}
                  aria-label="Toggle turbo model"
                  onClick={() => setTurbo((t) => !t)}
                  title={turbo ? "Turbo model — fastest renders" : "Flux model — higher detail, slower"}
                  className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                    turbo
                      ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-300"
                      : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <ZapIcon className="h-3.5 w-3.5" />
                  {turbo ? "On" : "Off"}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={status === "loading" || !prompt.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {status === "loading" ? (
                <LoaderIcon className="h-4 w-4 animate-spin" />
              ) : (
                <SparklesIcon className="h-4 w-4" />
              )}
              {status === "loading" ? `Rendering… ${elapsed}s` : "Generate"}
            </button>
            <p className="mt-2 text-center text-[11px] text-zinc-600">
              ⌘/Ctrl + Enter to generate · proxy waits up to 45s
            </p>
          </div>

          {/* Prompt ideas */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="mb-2 text-xs font-medium text-zinc-400">Try an idea</p>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => setPrompt(idea)}
                  className="rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-left text-[11px] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                >
                  {idea}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
              <p className="text-xs font-medium text-zinc-400">
                {current ? (
                  <>
                    Seed <span className="font-mono text-cyan-300">{current.seed}</span>
                    <span className="text-zinc-600"> · {current.width}×{current.height}</span>
                    <span className="text-zinc-600"> · {current.turbo ? "turbo" : "flux"}</span>
                  </>
                ) : (
                  "Your render appears here"
                )}
              </p>
              {status === "ready" && current && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    title="Download image"
                    aria-label="Download image"
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
                  >
                    {downloading ? (
                      <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <DownloadIcon className="h-3.5 w-3.5" />
                    )}
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    title="Copy image link"
                    aria-label="Copy image link"
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                  >
                    {copied ? (
                      <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open full size"
                    aria-label="Open full size"
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                    Full size
                  </a>
                </div>
              )}
            </div>

            <div className="flex min-h-[320px] items-center justify-center bg-black/30 p-6">
              {status === "idle" && (
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
                    <ImageIcon className="h-6 w-6 text-cyan-400" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-zinc-200">No render yet</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
                    Describe an image on the left and hit Generate. Same prompt + seed
                    always reproduces the same image.
                  </p>
                </div>
              )}

              {(status === "loading" || status === "ready") && current && (
                <div className="relative w-full">
                  {status === "loading" && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.06] bg-[#0d1220]/90">
                      <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-400" />
                      <p className="text-sm font-medium text-zinc-200">
                        Rendering… {elapsed}s
                      </p>
                      <p className="max-w-xs text-center text-[11px] leading-relaxed text-zinc-500">
                        The proxy is holding the connection while the AI paints.
                        Complex scenes can take up to 45 seconds.
                      </p>
                      <div className="h-1 w-48 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-cyan-400 transition-all duration-500"
                          style={{ width: `${Math.min(100, (elapsed / 45) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={current.url}
                    src={current.url}
                    alt={current.prompt}
                    onLoad={handleImgLoad}
                    onError={handleImgError}
                    className={`mx-auto max-h-[60vh] w-auto max-w-full rounded-xl border border-white/[0.08] object-contain shadow-2xl shadow-black/50 ${
                      status === "loading" ? "invisible absolute" : ""
                    }`}
                  />
                </div>
              )}

              {status === "error" && (
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
                    <ImageIcon className="h-6 w-6 text-red-400" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-zinc-200">Render failed</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
                    {error}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
                  >
                    <RefreshIcon className="h-4 w-4" />
                    Retry
                  </button>
                </div>
              )}
            </div>

            {current && status !== "idle" && (
              <p className="truncate border-t border-white/[0.06] px-5 py-2.5 font-mono text-[11px] text-zinc-500">
                “{current.prompt}”
              </p>
            )}
          </div>

          {/* Session history */}
          {history.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium text-zinc-400">
                This session ({history.length})
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {history.map((gen) => (
                  <button
                    key={gen.url}
                    type="button"
                    onClick={() => loadFromHistory(gen)}
                    title={gen.prompt}
                    className={`overflow-hidden rounded-lg border transition-all hover:border-cyan-400/50 ${
                      current?.url === gen.url
                        ? "border-cyan-400/60 ring-2 ring-cyan-400/20"
                        : "border-white/[0.08]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={gen.url} alt={gen.prompt} loading="lazy" className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
