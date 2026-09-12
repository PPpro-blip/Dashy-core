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
import { generateImage, GENERATION_DEADLINE_MS } from "@/lib/img-engine";
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
  /** Final display URL (direct Pollinations URL, or /api/img-proxy URL). */
  url: string;
  /** Direct Pollinations URL when the display URL is the same-origin proxy. */
  sourceUrl?: string;
  createdAt: number;
  aspectRatio: AspectRatio;
  model?: string;
  seed?: string;
  width: number;
  height: number;
  /**
   * Optimistic tile state; only `ready` and `error` (plus legacy statusless
   * items) are persisted. `generating` / `pending` are legacy states from
   * older Studio builds that crashed mid-generation — they are recovered to
   * `error` on mount by sanitizeLibrary().
   */
  status?: "loading" | "generating" | "pending" | "ready" | "error";
  error?: string;
}

type GenerateOverrides = {
  prompt?: string;
  aspect?: AspectRatio;
  model?: ModelOption;
  id?: string;
};

const STORAGE_KEY = "dashy.media.library";

/** Message shown on tiles recovered from an interrupted generation. */
const INTERRUPTED_MESSAGE =
  "Recovered from an interrupted session — this generation never completed. Retry to regenerate it.";

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
    return (parsed as MediaItem[]).map((item) => ({
      ...item,
      status: item.status ?? "ready",
    }));
  } catch {
    return [];
  }
}

/**
 * Recovers items stuck in `loading` / `generating` / `pending` from previous
 * crashes or refreshes (e.g. an old build that persisted optimistic tiles).
 * Stuck tiles become retryable `error` tiles instead of spinning forever.
 */
function sanitizeLibrary(items: MediaItem[]): MediaItem[] {
  return items.map((item) => {
    if (item.status === "error") return item;
    const stuck =
      item.status === "loading" ||
      item.status === "generating" ||
      item.status === "pending" ||
      !item.url;
    if (stuck) {
      return {
        ...item,
        status: "error" as const,
        error: item.error ?? INTERRUPTED_MESSAGE,
      };
    }
    return { ...item, status: "ready" as const, url: item.url };
  });
}

/**
 * Finished tiles persist; optimistic `loading` tiles are transient (a
 * refresh mid-generation simply drops them — nothing left to spin).
 * `error` tiles persist so Retry / Clear failed survive reloads.
 */
function isPersistable(item: MediaItem): boolean {
  return !item.status || item.status === "ready" || item.status === "error";
}

function saveLibrary(items: MediaItem[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.filter(isPersistable))
    );
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
  const [elapsed, setElapsed] = useState(0);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  /** Number of in-flight generations (drives the generating UI + timer). */
  const [activeCount, setActiveCount] = useState(0);

  /** One AbortController + deadline per in-flight tile id. */
  interface InflightRun {
    controller: AbortController;
    timedOut: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    startedAt: number;
  }
  const inflightRef = useRef<Map<string, InflightRun>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load library + ?prompt carry-over from chat IMG button.
  // Also sanitize localStorage: tiles stuck in `loading`/`generating`/
  // `pending` from a previous crash or refresh are recovered to retryable
  // `error` tiles instead of spinning endlessly.
  useEffect(() => {
    const raw = loadLibrary();
    const sanitized = sanitizeLibrary(raw);
    const recovered = sanitized.filter((item) => item.status === "error").length;
    setLibrary(sanitized);
    if (JSON.stringify(sanitized) !== JSON.stringify(raw)) {
      saveLibrary(sanitized);
      if (recovered > 0) {
        toast.info(
          "Library recovered",
          `${recovered} interrupted generation${recovered === 1 ? "" : "s"} flagged as failed — retry or clear them.`
        );
      }
    }
    const qp = searchParams.get("prompt");
    if (qp) {
      setPrompt(qp);
      // focus after mount
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abort any in-flight generations when the page unmounts (cleanup).
  useEffect(() => {
    return () => {
      inflightRef.current.forEach((run) => {
        if (run.timer) clearTimeout(run.timer);
        run.controller.abort();
      });
      inflightRef.current.clear();
    };
  }, []);

  // Persist whenever library changes (skip initial empty if not loaded? we load first)
  const persist = useCallback((items: MediaItem[]) => {
    setLibrary(items);
    saveLibrary(items);
  }, []);

  /**
   * Functional state update + persist in one place. Used for optimistic
   * loading/error tiles so rapid sequential generates never clobber each
   * other (no single global lock is held beyond the in-flight request).
   */
  const commitLibrary = useCallback(
    (updater: (prev: MediaItem[]) => MediaItem[]) => {
      setLibrary((prev) => {
        const next = updater(prev);
        saveLibrary(next);
        return next;
      });
    },
    []
  );

  // Elapsed timer while any generation is in flight (oldest startedAt).
  useEffect(() => {
    if (activeCount === 0) {
      setElapsed(0);
      return;
    }
    const tick = () => {
      let earliest = Infinity;
      inflightRef.current.forEach((run) => {
        earliest = Math.min(earliest, run.startedAt);
      });
      setElapsed(
        Number.isFinite(earliest) ? Math.floor((Date.now() - earliest) / 1000) : 0
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [activeCount]);

  const dimensions = useMemo(() => ASPECT_MAP[aspect], [aspect]);

  /**
   * Image mode — Pollinations free tier via lib/img-engine.
   * Direct URL fallbacks first, same-origin /api/img-proxy as a last resort.
   * Each run gets its own unique seed/id and its own AbortController with a
   * HARD 45s setTimeout deadline: on timeout the fetch is aborted, the tile
   * flips to a retryable `error` state and a clean toast explains why.
   * The user can also abort immediately via the Cancel button. `overrides`
   * lets an error-tile Retry reuse the same prompt/aspect/id.
   */
  const handleGenerate = useCallback(
    async (overrides?: GenerateOverrides) => {
      const trimmed = (overrides?.prompt ?? prompt).trim();
      if (!trimmed) {
        toast.error("Enter a prompt", "Describe what you want to generate.");
        return;
      }

      // Retry from an error tile is always an image generation, even if the
      // user switched the mode toggle in the meantime.
      if (mode === "video" && !overrides) {
        setShowVideoModal(true);
        return;
      }

      const ratio = overrides?.aspect ?? aspect;
      const modelChoice = overrides?.model ?? model;
      const { width, height } = ASPECT_MAP[ratio];
      const id = overrides?.id ?? crypto.randomUUID();

      // A tile can only have one in-flight generation at a time.
      if (inflightRef.current.has(id)) return;

      // Optimistic tile — spinner immediately, before the network round-trip.
      const pending: MediaItem = {
        id,
        type: "image",
        prompt: trimmed,
        url: "",
        createdAt: Date.now(),
        aspectRatio: ratio,
        model: modelChoice,
        width,
        height,
        status: "loading",
      };
      commitLibrary((prev) => [pending, ...prev.filter((i) => i.id !== id)]);

      // Hard 45s deadline: abort the fetch and fail the tile cleanly.
      const controller = new AbortController();
      const run: InflightRun = {
        controller,
        timedOut: false,
        timer: null,
        startedAt: Date.now(),
      };
      run.timer = setTimeout(() => {
        run.timedOut = true;
        controller.abort();
      }, GENERATION_DEADLINE_MS);
      inflightRef.current.set(id, run);
      setActiveCount(inflightRef.current.size);

      try {
        const result = await generateImage(
          { prompt: trimmed, width, height, model: modelChoice },
          {
            signal: controller.signal,
            // The handler's own 45s setTimeout is the strict deadline and
            // fires first; this engine-side cap is the safety net (46s).
            deadlineMs: GENERATION_DEADLINE_MS + 1000,
          }
        );

        const ready: MediaItem = {
          ...pending,
          url: result.url,
          sourceUrl: result.viaProxy ? result.sourceUrl : undefined,
          seed: result.seed,
          model: result.model,
          status: "ready",
        };
        commitLibrary((prev) => [ready, ...prev.filter((i) => i.id !== id)]);
        toast.success(
          "Image generated",
          `Added to your library — ${ratio} ${width}x${height}${
            result.viaProxy ? " (via image proxy)" : ""
          }`
        );
      } catch (err) {
        let errorText: string;
        if (run.timedOut) {
          errorText = "Generation timed out";
        } else if (controller.signal.aborted) {
          errorText = "Generation cancelled";
        } else {
          errorText =
            err instanceof Error
              ? err.message
              : "Image generation failed. Please try again.";
        }
        commitLibrary((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: "error", error: errorText } : i
          )
        );
        if (run.timedOut) {
          toast.error("Image generation timed out after 45s. Please retry.");
        } else if (controller.signal.aborted) {
          toast.info("Generation cancelled", "Retry from the failed tile anytime.");
        } else {
          toast.error("Generation failed", errorText);
        }
      } finally {
        if (run.timer) clearTimeout(run.timer);
        inflightRef.current.delete(id);
        setActiveCount(inflightRef.current.size);
      }
    },
    [aspect, commitLibrary, mode, model, prompt, toast]
  );

  /** Aborts every in-flight generation immediately (global Cancel). */
  const handleCancel = useCallback(() => {
    inflightRef.current.forEach((run) => {
      run.timedOut = false;
      run.controller.abort();
    });
  }, []);

  /** Aborts a single tile's in-flight generation. */
  const handleCancelOne = useCallback((id: string) => {
    const run = inflightRef.current.get(id);
    if (run) {
      run.timedOut = false;
      run.controller.abort();
    }
  }, []);

  const handleDownload = useCallback(
    async (item: MediaItem) => {
      try {
        // Proxy direct Pollinations URLs through the same-origin proxy so the
        // blob fetch is never blocked by CORS; proxied URLs are already same-origin.
        const src = item.url.startsWith("/")
          ? item.url
          : `/api/img-proxy?url=${encodeURIComponent(item.url)}`;
        const res = await fetch(src, { mode: "cors" });
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
        // Prefer the direct Pollinations URL so shared links work everywhere.
        await navigator.clipboard.writeText(item.sourceUrl || item.url);
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

  /** Removes every errored tile from the library. */
  const handleClearFailed = useCallback(() => {
    const failed = library.filter((i) => i.status === "error").length;
    if (failed === 0) return;
    persist(library.filter((i) => i.status !== "error"));
    toast.info(
      "Failed items cleared",
      `${failed} failed tile${failed === 1 ? "" : "s"} removed from your library.`
    );
  }, [library, persist, toast]);

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

            {mode === "video" ? (
              /* Honest video-mode banner — no fake generators, no infinite loaders. */
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl">
                <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
                <div className="relative flex items-start gap-3">
                  <span className="text-2xl leading-none" aria-hidden="true">
                    📹
                  </span>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold leading-snug text-zinc-100">
                      Real AI Video Generation requires API Keys (Luma / Runway /
                      Replicate).
                    </p>
                    <p className="text-xs italic leading-relaxed text-zinc-400">
                      Please add your API key in Settings or switch to Image Mode.
                    </p>
                  </div>
                </div>
                <div className="relative mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                  <button
                    type="button"
                    onClick={() => router.push("/settings")}
                    className="flex-1 rounded-xl bg-amber-400/90 px-4 py-2.5 text-sm font-semibold text-[#241a02] transition-colors hover:bg-amber-300"
                  >
                    Add API key in Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("image")}
                    className="flex-1 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                  >
                    Switch to Image Mode
                  </button>
                </div>
              </div>
            ) : (
              <>
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
                disabled={activeCount > 0 || !prompt.trim()}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-cyan-500 px-6 py-4 text-[15px] font-semibold text-[#06202a] shadow-xl shadow-cyan-500/20 transition-all hover:bg-cyan-400 hover:shadow-cyan-400/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {activeCount > 0 ? (
                  <>
                    <LoaderIcon className="h-5 w-5 animate-spin" />
                    Generating… {elapsed}s / {GENERATION_DEADLINE_MS / 1000}s
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-5 w-5 transition-transform group-hover:rotate-12" />
                    Generate Image
                  </>
                )}
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </button>

              {activeCount > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2.5 text-xs text-cyan-300">
                  <div className="flex min-w-0 items-center gap-2">
                    <ClockIcon className="h-3.5 w-3.5 flex-shrink-0 animate-pulse" />
                    <span className="truncate">
                      Pollinations is rendering… {elapsed}s elapsed (max{" "}
                      {GENERATION_DEADLINE_MS / 1000}s)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <p className="text-center text-[11px] leading-relaxed text-zinc-600">
                Free generation via Pollinations.ai • No API key needed for images.
                <br />
                Your media is stored locally in this browser.
              </p>
            </div>
              </>
            )}
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
              {library.some((i) => i.status === "error") && (
                <button
                  type="button"
                  onClick={handleClearFailed}
                  className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/15"
                >
                  Clear failed
                </button>
              )}
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
                    {/* Image / optimistic states */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/20">
                      {item.status === "loading" ||
                      item.status === "generating" ||
                      item.status === "pending" ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 bg-black/20">
                          <LoaderIcon className="h-6 w-6 animate-spin text-cyan-400" />
                          <span className="text-xs font-medium text-cyan-300">
                            Generating…
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            Pollinations • {item.width}×{item.height}
                          </span>
                          {inflightRef.current.has(item.id) && (
                            <button
                              type="button"
                              onClick={() => handleCancelOne(item.id)}
                              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      ) : item.status === "error" ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 bg-red-500/[0.03] px-4 text-center">
                          <AlertIcon className="h-5 w-5 text-red-400" />
                          <p className="line-clamp-3 text-[11px] leading-snug text-red-300">
                            {item.error ?? "Generation failed"}
                          </p>
                          <button
                            type="button"
                            disabled={inflightRef.current.has(item.id)}
                            onClick={() =>
                              void handleGenerate({
                                prompt: item.prompt,
                                aspect: item.aspectRatio,
                                model: (item.model as ModelOption) ?? model,
                                id: item.id,
                              })
                            }
                            className="rounded-lg bg-cyan-400 px-3 py-1.5 text-[11px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt={item.prompt}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                          onClick={() => setPreviewItem(item)}
                        />
                      )}
                      {/* Top badges */}
                      {item.status !== "loading" && item.status !== "error" && (
                        <div className="absolute left-2 top-2 flex items-center gap-1.5">
                          <span className="rounded-md border border-white/20 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                            {item.aspectRatio}
                          </span>
                          <span className="rounded-md border border-cyan-400/20 bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-100 backdrop-blur">
                            {item.model || "flux"}
                          </span>
                        </div>
                      )}
                      {/* Hover overlay actions */}
                      {item.status !== "loading" && item.status !== "error" && (
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
                      )}
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
                    Real AI video requires paid compute (Luma, Runway, Replicate). We are not faking an API.
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                Real AI Video Generation requires API Keys (Luma / Runway /
                Replicate). Please add your API key in Settings or switch to
                Image Mode.
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
                {previewItem.seed && (
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Seed</span>
                    <span className="truncate font-mono text-[11px] font-medium text-zinc-300" title={previewItem.seed}>
                      {previewItem.seed}
                    </span>
                  </div>
                )}
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
