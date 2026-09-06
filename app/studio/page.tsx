"use client";

/**
 * Dashy Studio — dedicated /studio route with built-in Media Library.
 *
 * Left: Creator (prompt, toggle image/video, aspect ratio, model, generate)
 * Right: Library (localStorage `dashy.media.library` masonry grid)
 *
 * Image gen uses Pollinations (free): https://image.pollinations.ai/prompt/{prompt}?width=&height=&nologo=true&seed=&model=
 * Video gen is honest — requires API key, shows modal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  SparklesIcon,
  TrashIcon,
  VideoIcon,
  XIcon,
} from "@/components/icons";

type MediaType = "image" | "video";
type AspectRatio = "1:1" | "16:9" | "9:16";
type ModelOption = "flux" | "default" | "turbo";

interface MediaItem {
  id: string;
  type: MediaType;
  prompt: string;
  url: string;
  createdAt: number;
  aspectRatio: AspectRatio;
  model?: string;
  width: number;
  height: number;
}

const STORAGE_KEY = "dashy.media.library";

const ASPECT_MAP: Record<AspectRatio, { width: number; height: number; label: string }> = {
  "1:1": { width: 1024, height: 1024, label: "Square" },
  "16:9": { width: 1280, height: 720, label: "Landscape" },
  "9:16": { width: 720, height: 1280, label: "Portrait" },
};

const MODEL_OPTIONS: { value: ModelOption; label: string; desc: string }[] = [
  { value: "flux", label: "Flux", desc: "High quality, detailed" },
  { value: "turbo", label: "Turbo", desc: "Fast, balanced" },
  { value: "default", label: "Default", desc: "Stable baseline" },
];

function loadLibrary(): MediaItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MediaItem[];
  } catch {
    return [];
  }
}

function saveLibrary(items: MediaItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded — best effort
  }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function StudioPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [mode, setMode] = useState<MediaType>("image");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>("1:1");
  const [model, setModel] = useState<ModelOption>("flux");
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load library + ?prompt carry-over from chat IMG button
  useEffect(() => {
    setLibrary(loadLibrary());
    const qp = searchParams.get("prompt");
    if (qp) {
      setPrompt(qp);
      // focus after mount
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever library changes (skip initial empty if not loaded? we load first)
  const persist = useCallback((items: MediaItem[]) => {
    setLibrary(items);
    saveLibrary(items);
  }, []);

  // Timer while generating
  useEffect(() => {
    if (generating) {
      const start = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [generating]);

  const dimensions = useMemo(() => ASPECT_MAP[aspect], [aspect]);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error("Enter a prompt", "Describe what you want to generate.");
      return;
    }

    if (mode === "video") {
      setShowVideoModal(true);
      return;
    }

    // IMAGE MODE — Pollinations free
    setGenerating(true);
    const seed = Date.now();
    const { width, height } = ASPECT_MAP[aspect];
    const modelParam = model === "default" ? "" : `&model=${encodeURIComponent(model)}`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      trimmed
    )}?width=${width}&height=${height}&nologo=true&seed=${seed}${modelParam}`;

    try {
      // Wait for image to actually load — honest loading state
      await new Promise<void>((resolve, reject) => {
        const img = new window.Image();
        // Pollinations needs crossOrigin anonymous for canvas safety
        img.crossOrigin = "anonymous";
        const timeout = setTimeout(() => {
          reject(new Error("Image load timed out"));
        }, 45000);
        img.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        img.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Failed to load image"));
        };
        img.src = url;
      });

      const newItem: MediaItem = {
        id: `${seed}`,
        type: "image",
        prompt: trimmed,
        url,
        createdAt: Date.now(),
        aspectRatio: aspect,
        model,
        width,
        height,
      };

      const updated = [newItem, ...loadLibrary()];
      persist(updated);
      toast.success("Image generated", `Added to your library — ${aspect} ${width}x${height}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Generation failed", msg);
    } finally {
      setGenerating(false);
    }
  }, [aspect, mode, model, persist, prompt, toast]);

  const handleDownload = useCallback(
    async (item: MediaItem) => {
      try {
        // Try blob fetch for proper download; fallback to opening URL
        const res = await fetch(item.url, { mode: "cors" });
        if (!res.ok) throw new Error("fetch failed");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `dashy-${item.id}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
        toast.success("Download started");
      } catch {
        // Fallback — open in new tab, user can save manually
        window.open(item.url, "_blank");
        toast.info("Opened in new tab", "Your browser blocked direct download — save from the new tab.");
      }
    },
    [toast]
  );

  const handleCopyUrl = useCallback(
    async (item: MediaItem) => {
      try {
        await navigator.clipboard.writeText(item.url);
        toast.success("URL copied");
      } catch {
        toast.error("Copy failed", "Clipboard access denied");
      }
    },
    [toast]
  );

  const handleCopyPrompt = useCallback(
    async (p: string) => {
      try {
        await navigator.clipboard.writeText(p);
        toast.success("Prompt copied");
      } catch {
        toast.error("Copy failed");
      }
    },
    [toast]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const filtered = library.filter((i) => i.id !== id);
      persist(filtered);
      toast.info("Removed from library");
      if (previewItem?.id === id) setPreviewItem(null);
    },
    [library, persist, previewItem, toast]
  );

  const handleUsePrompt = useCallback((p: string) => {
    setPrompt(p);
    textareaRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-navy">
      {/* Header bar */}
      <div className="flex-shrink-0 border-b border-white/[0.06] bg-white/[0.02] px-6 py-4 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-cyan-400/20">
              <SparklesIcon className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-white">Dashy Studio</h1>
              <p className="text-[11px] text-zinc-500">Generate images & organize your media library</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-zinc-400">
              {library.length} assets
            </span>
            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-300">
              Pollinations • Free
            </span>
          </div>
        </div>
      </div>

      {/* Main split */}
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-0 lg:flex-row">
        {/* LEFT: Creator */}
        <div className="w-full flex-shrink-0 border-b border-white/[0.06] bg-navy-deep/50 p-6 lg:w-[420px] lg:border-b-0 lg:border-r">
          <div className="space-y-6">
            {/* Toggle Image | Video */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Mode
              </label>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                <button
                  type="button"
                  onClick={() => setMode("image")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                    mode === "image"
                      ? "bg-cyan-500 text-[#06202a] shadow-lg shadow-cyan-500/20"
                      : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                  }`}
                >
                  <ImageIcon className="h-4 w-4" />
                  Image
                </button>
                <button
                  type="button"
                  onClick={() => setMode("video")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                    mode === "video"
                      ? "bg-white text-zinc-900 shadow-lg"
                      : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                  }`}
                >
                  <VideoIcon className="h-4 w-4" />
                  Video
                  <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                    Beta
                  </span>
                </button>
              </div>
            </div>

            {/* Prompt */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Prompt
                </label>
                <span className="text-[10px] text-zinc-600">{prompt.length}/1000</span>
              </div>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, 1000))}
                  placeholder={
                    mode === "image"
                      ? "A neon sports car parked under a cyberpunk city skyline at night, rain reflections, ultra detailed..."
                      : "A cinematic drone shot flying over a futuristic city..."
                  }
                  rows={6}
                  className="min-h-[140px] w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 transition-colors focus:border-cyan-400/40 focus:outline-none focus:ring-4 focus:ring-cyan-400/10"
                />
                <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-black/40 px-2 py-1 text-[10px] text-zinc-500 backdrop-blur">
                  <SparklesIcon className="h-3 w-3" />
                  Be descriptive
                </div>
              </div>
            </div>

            {/* Aspect Ratio */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Aspect Ratio
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ASPECT_MAP) as AspectRatio[]).map((ratio) => {
                  const info = ASPECT_MAP[ratio];
                  const active = aspect === ratio;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspect(ratio)}
                      className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 transition-all ${
                        active
                          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200 shadow-lg shadow-cyan-500/10"
                          : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-zinc-200"
                      }`}
                    >
                      <div
                        className={`rounded-[3px] border-2 transition-colors ${
                          active ? "border-cyan-300/60 bg-cyan-400/20" : "border-zinc-600 bg-zinc-700/30 group-hover:border-zinc-500"
                        }`}
                        style={{
                          width: ratio === "1:1" ? 20 : ratio === "16:9" ? 28 : 14,
                          height: ratio === "1:1" ? 20 : ratio === "16:9" ? 14 : 28,
                        }}
                      />
                      <span className="text-xs font-medium">{ratio}</span>
                      <span className="text-[10px] opacity-70">{info.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                {dimensions.width} × {dimensions.height} • {dimensions.label}
              </p>
            </div>

            {/* Model */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Model / Style
              </label>
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as ModelOption)}
                  className="w-full appearance-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 pr-10 text-sm font-medium text-zinc-200 transition-colors focus:border-cyan-400/40 focus:outline-none focus:ring-4 focus:ring-cyan-400/10"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value} className="bg-[#0d1020]">
                      {m.label} — {m.desc}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Generate CTA */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating || !prompt.trim()}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-cyan-500 px-6 py-4 text-[15px] font-semibold text-[#06202a] shadow-xl shadow-cyan-500/20 transition-all hover:bg-cyan-400 hover:shadow-cyan-400/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {generating ? (
                  <>
                    <LoaderIcon className="h-5 w-5 animate-spin" />
                    Generating… {elapsed}s
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-5 w-5 transition-transform group-hover:rotate-12" />
                    Generate {mode === "image" ? "Image" : "Video"}
                  </>
                )}
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </button>

              {generating && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2.5 text-xs text-cyan-300">
                  <ClockIcon className="h-3.5 w-3.5 animate-pulse" />
                  <span>Pollinations is rendering your masterpiece…</span>
                  <span className="font-mono font-semibold">{elapsed}s</span>
                </div>
              )}

              <p className="text-center text-[11px] leading-relaxed text-zinc-600">
                Free generation via Pollinations.ai • No API key needed for images.
                <br />
                Your media is stored locally in this browser.
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT: Library */}
        <div className="flex min-w-0 flex-1 flex-col bg-navy">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] bg-white/[0.02] px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-300">
                <ImageIcon className="h-4 w-4 text-zinc-500" />
                Your Media
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                  {library.length}
                </span>
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">Local library • {STORAGE_KEY}</p>
            </div>
            <div className="flex items-center gap-2">
              {library.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Clear entire media library? This cannot be undone.")) {
                      persist([]);
                      toast.info("Library cleared");
                    }
                  }}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {library.length === 0 ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-8 py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                  <SparklesIcon className="h-8 w-8 text-zinc-600" />
                </div>
                <h3 className="mt-6 text-sm font-medium text-zinc-300">No masterpieces yet</h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                  Your generated masterpieces will appear here.
                  <br />
                  Start by describing an image on the left and hit Generate.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "A neon sports car",
                    "Cyberpunk cat in rain",
                    "Minimalist mountain logo",
                    "Studio Ghibli forest spirit",
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleUsePrompt(s)}
                      className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {library.map((item) => (
                  <div
                    key={item.id}
                    className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-all hover:border-white/[0.12] hover:bg-white/[0.04] hover:shadow-xl hover:shadow-black/20"
                  >
                    {/* Image */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.prompt}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        onClick={() => setPreviewItem(item)}
                      />
                      {/* Top badges */}
                      <div className="absolute left-2 top-2 flex items-center gap-1.5">
                        <span className="rounded-md border border-white/20 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                          {item.aspectRatio}
                        </span>
                        <span className="rounded-md border border-cyan-400/20 bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-100 backdrop-blur">
                          {item.model || "flux"}
                        </span>
                      </div>
                      {/* Hover overlay actions */}
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void handleDownload(item)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-lg transition-transform hover:scale-105"
                          title="Download"
                        >
                          <DownloadIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyUrl(item)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition-transform hover:scale-105 hover:bg-white/20"
                          title="Copy URL"
                        >
                          <LinkIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewItem(item)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition-transform hover:scale-105 hover:bg-white/20"
                          title="Preview"
                        >
                          <ImageIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/90 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-500"
                          title="Delete"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Meta */}
                    <div className="p-3">
                      <p className="line-clamp-2 text-[13px] leading-snug text-zinc-200" title={item.prompt}>
                        {item.prompt}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                          <ClockIcon className="h-3 w-3" />
                          {formatRelative(item.createdAt)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleUsePrompt(item.prompt)}
                            className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
                          >
                            Use prompt
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyPrompt(item.prompt)}
                            className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
                            title="Copy prompt"
                          >
                            <CopyIcon className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Video modal — honest architecture */}
      {showVideoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.08] bg-[#131731] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-400/20">
                  <VideoIcon className="h-4 w-4 text-amber-300" />
                </div>
                <h3 className="text-sm font-semibold text-white">Video generation</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowVideoModal(false)}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                <AlertIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-200">API key required</p>
                  <p className="text-xs leading-relaxed text-amber-200/70">
                    Real AI video requires paid compute (Runway, Pika, Replicate). We are not faking an API.
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                Video generation requires a valid API key (Runway/Replicate). Add it in Settings to unlock.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowVideoModal(false)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/[0.06]"
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowVideoModal(false);
                    router.push("/settings");
                  }}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-[#06202a] hover:bg-cyan-400"
                >
                  Go to Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1020] shadow-2xl lg:flex-row">
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black/30 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewItem.url}
                alt={previewItem.prompt}
                className="max-h-[70vh] w-auto max-w-full rounded-xl object-contain"
              />
            </div>
            <div className="w-full flex-shrink-0 border-t border-white/[0.06] bg-white/[0.02] p-5 lg:w-[320px] lg:border-l lg:border-t-0">
              <h3 className="text-sm font-medium text-white">Details</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{previewItem.prompt}</p>
              <div className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Aspect</span>
                  <span className="font-medium text-zinc-300">{previewItem.aspectRatio}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Size</span>
                  <span className="font-medium text-zinc-300">
                    {previewItem.width} × {previewItem.height}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Model</span>
                  <span className="font-medium text-zinc-300">{previewItem.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Created</span>
                  <span className="font-medium text-zinc-300">{new Date(previewItem.createdAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownload(previewItem)}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100"
                >
                  <DownloadIcon className="h-4 w-4" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyUrl(previewItem)}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/[0.08]"
                >
                  <LinkIcon className="h-4 w-4" />
                  Copy URL
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  handleUsePrompt(previewItem.prompt);
                  setPreviewItem(null);
                }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2.5 text-sm font-medium text-cyan-300 hover:bg-cyan-500/15"
              >
                <SparklesIcon className="h-4 w-4" />
                Use this prompt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
