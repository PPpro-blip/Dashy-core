"use client";

/**
 * Dashy Studio — direct-load image generation with a Media Library.
 *
 * Pipeline (direct-first):
 *  1. Build the DIRECT Pollinations URL:
 *     https://image.pollinations.ai/prompt/{encodedPrompt}?seed=&width=&height=&nologo=true
 *     That endpoint returns RAW IMAGE BYTES (JPEG/PNG), NOT JSON — so it can
 *     be preloaded straight from the browser with `new Image()`.
 *  2. Preload the direct URL in the browser. `onload` marks the asset
 *     complete (status "ready") and its imgUrl is saved to the
 *     `dashy.media.library` localStorage store.
 *  3. `onerror` retries the SAME url through the fast same-origin
 *     `/api/img-proxy` fallback; if that fails too the tile errors out.
 *  4. A 40-second overall timer bounds every generation, and every pending
 *     job is cleaned up on unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SparklesIcon,
  RefreshIcon,
  DownloadIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  ArrowUpRightIcon,
  ImageIcon,
} from "@/components/icons";

export interface Tile {
  id: string;
  prompt: string;
  url?: string;
  status: "loading" | "ready" | "error";
  createdAt: number;
  /** Generation width/height in px — baked into the direct Pollinations URL. */
  width: number;
  height: number;
  seed?: string | number;
  /** True when the displayed URL is the same-origin /api/img-proxy fallback. */
  viaProxy?: boolean;
}

const STUDIO_TIMEOUT_MS = 40_000; // 40 seconds minimum timeout

/** localStorage-backed Media Library (survives reloads). */
const LIBRARY_KEY = "dashy.media.library";
const LIBRARY_LIMIT = 60;

const ASPECT_OPTIONS = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
} as const;
type AspectKey = keyof typeof ASPECT_OPTIONS;

const PRESET_PROMPTS = [
  "Futuristic cyberpunk workstation glowing in neon blue and violet",
  "Photorealistic cozy glass cabin surrounded by pine trees at dusk",
  "Hyperdetailed isometric 3D render of an AI neural laboratory",
  "Cinematic astronaut exploring iridescent crystalline caverns on an alien world",
  "Minimalist obsidian logo emblem with metallic cyan reflections",
];

/**
 * Direct Pollinations URL. The endpoint answers with raw image bytes
 * (JPEG/PNG), never JSON — perfect for a plain browser `Image()` preload.
 */
function buildDirectUrl(
  prompt: string,
  seed: number,
  width: number,
  height: number
): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?seed=${seed}&width=${width}&height=${height}&nologo=true`;
}

/** Same-origin fast proxy fallback for a direct URL that errored. */
function buildProxyUrl(directUrl: string): string {
  return `/api/img-proxy?url=${encodeURIComponent(directUrl)}`;
}

/**
 * Restores one stored entry into a Tile. Tolerates legacy media-library
 * shapes from older Studio builds (string ids, video assets, missing
 * dimensions). Anything without a usable URL becomes a retryable error tile.
 */
function normalizeStoredTile(entry: unknown): Tile | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown>;
  // Older libraries also stored video assets — images only here.
  if (item.type === "video") return null;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  if (!prompt) return null;

  const storedUrl = typeof item.url === "string" ? item.url : "";
  const ready = Boolean(storedUrl) && item.status !== "error";
  const url = ready ? storedUrl : undefined;

  return {
    id:
      typeof item.id === "string" || typeof item.id === "number"
        ? String(item.id)
        : `${typeof item.createdAt === "number" ? item.createdAt : Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
    prompt,
    url,
    status: ready ? "ready" : "error",
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    width:
      typeof item.width === "number" && item.width > 0 ? item.width : 1024,
    height:
      typeof item.height === "number" && item.height > 0 ? item.height : 1024,
    seed:
      typeof item.seed === "number" || typeof item.seed === "string"
        ? item.seed
        : undefined,
    viaProxy: ready ? url!.startsWith("/api/img-proxy") : undefined,
  };
}

/** Loads the Media Library from localStorage (best effort). */
function loadLibrary(): Tile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tiles: Tile[] = [];
    for (const entry of parsed) {
      const tile = normalizeStoredTile(entry);
      if (tile) tiles.push(tile);
    }
    return tiles.slice(0, LIBRARY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Persists finished tiles (ready/error). Optimistic `loading` tiles stay
 * transient — a refresh mid-generation simply drops them.
 */
function saveLibrary(tiles: Tile[]): void {
  if (typeof window === "undefined") return;
  try {
    const persistable = tiles
      .filter((tile) => tile.status !== "loading")
      .slice(0, LIBRARY_LIMIT);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(persistable));
  } catch {
    // Storage quota exceeded — best effort.
  }
}

/** Maps a tile back to its aspect key (remix preserves the tile's shape). */
function aspectForTile(tile: Tile): AspectKey {
  for (const [key, size] of Object.entries(ASPECT_OPTIONS) as Array<
    [AspectKey, { width: number; height: number }]
  >) {
    if (size.width === tile.width && size.height === tile.height) return key;
  }
  return "1:1";
}

export default function StudioPage() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<AspectKey>("1:1");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Keep track of active image objects and timers for cleanup on unmount
  const activeJobsRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; cancel: () => void }>
  >(new Map());

  // Restore the Media Library once on mount.
  useEffect(() => {
    setTiles(loadLibrary());
    setHydrated(true);
  }, []);

  // Persist finished tiles to dashy.media.library (after hydration only,
  // so the restore itself is never clobbered by an empty write).
  useEffect(() => {
    if (!hydrated) return;
    saveLibrary(tiles);
  }, [tiles, hydrated]);

  useEffect(() => {
    return () => {
      // Cleanup all pending jobs on unmount
      activeJobsRef.current.forEach((job) => {
        clearTimeout(job.timer);
        job.cancel();
      });
      activeJobsRef.current.clear();
    };
  }, []);

  const generate = useCallback(
    (promptOverride?: string, aspectOverride?: AspectKey) => {
      const text = (promptOverride ?? prompt).trim();
      if (!text || typeof window === "undefined") return;

      const key = aspectOverride ?? aspect;
      const { width, height } = ASPECT_OPTIONS[key];
      const id = crypto.randomUUID();
      const seed = Date.now();
      const directUrl = buildDirectUrl(text, seed, width, height);
      const proxyUrl = buildProxyUrl(directUrl);

      const newTile: Tile = {
        id,
        prompt: text,
        status: "loading",
        createdAt: Date.now(),
        width,
        height,
        seed,
      };

      setTiles((prev) => [newTile, ...prev.filter((t) => t.id !== id)]);
      if (!promptOverride) {
        setPrompt("");
      }
      setBusy(true);

      let finished = false;
      let directImg: HTMLImageElement | null = null;
      let proxyImg: HTMLImageElement | null = null;

      const cleanup = () => {
        if (directImg) {
          directImg.onload = null;
          directImg.onerror = null;
          directImg = null;
        }
        if (proxyImg) {
          proxyImg.onload = null;
          proxyImg.onerror = null;
          proxyImg = null;
        }
        const job = activeJobsRef.current.get(id);
        if (job) {
          clearTimeout(job.timer);
          activeJobsRef.current.delete(id);
        }
      };

      const finish = (
        status: Tile["status"],
        loadedUrl?: string,
        viaProxy = false
      ) => {
        if (finished) return;
        finished = true;
        cleanup();

        // Asset complete: "ready" tiles (with their imgUrl) are persisted to
        // dashy.media.library by the save effect.
        setTiles((prev) =>
          prev.map((tile) =>
            tile.id === id
              ? {
                  ...tile,
                  status,
                  url: status === "ready" ? loadedUrl : undefined,
                  viaProxy: status === "ready" ? viaProxy : undefined,
                }
              : tile
          )
        );
        setBusy(false);
      };

      // Set 40-second minimum overall timer
      const timer = setTimeout(() => {
        console.warn(
          `[Studio] Generation timed out after ${STUDIO_TIMEOUT_MS / 1000}s for prompt: "${text}"`
        );
        finish("error");
      }, STUDIO_TIMEOUT_MS);

      // Cancel callback for cleanup
      const cancel = () => {
        if (!finished) {
          finished = true;
          cleanup();
        }
      };

      activeJobsRef.current.set(id, { timer, cancel });

      // Fast same-origin proxy fallback, armed when the direct load errors.
      const tryProxyFallback = () => {
        if (finished || typeof window === "undefined") return;
        console.info(
          `[Studio] Direct Pollinations load failed — retrying through fast proxy: ${proxyUrl}`
        );
        const fallback = new window.Image();
        proxyImg = fallback;
        fallback.onload = () => {
          finish("ready", proxyUrl, true);
        };
        fallback.onerror = () => {
          // If the proxy load also fails, mark as error
          console.error(
            `[Studio] Proxy fallback also failed for seed ${seed}`
          );
          finish("error");
        };
        fallback.decoding = "async";
        fallback.src = proxyUrl;
      };

      // DIRECT LOAD FIRST — image.pollinations.ai answers with raw image
      // bytes, so the browser preloads the URL directly (no fetch/JSON).
      const img = new window.Image();
      directImg = img;
      img.onload = () => {
        // Mark asset as complete, set status to 'ready' — the imgUrl is
        // saved to dashy.media.library by the persistence effect.
        finish("ready", directUrl, false);
      };
      img.onerror = () => {
        // Retry with fast proxy fallback or mark error
        tryProxyFallback();
      };
      img.decoding = "async";
      img.src = directUrl;
    },
    [prompt, aspect]
  );

  const clearFailed = () => {
    setTiles((current) => current.filter((tile) => tile.status !== "error"));
  };

  const clearAll = () => {
    setTiles([]);
  };

  const copyPrompt = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadImage = (url: string, promptText: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashy-studio-${promptText.slice(0, 24).replace(/[^a-z0-9]/gi, "-").toLowerCase() || "image"}.png`;
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const failedCount = tiles.filter((t) => t.status === "error").length;

  return (
    <div className="min-h-full bg-[#080b14] px-4 py-8 text-white sm:px-6 md:px-12">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-white/[0.06] pb-8">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-300">
                <SparklesIcon className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
                Dashy Studio
              </p>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
              Make something visual.
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-400">
              Turn high-level concepts into instant high-resolution imagery — direct Pollinations loads with a fast proxy fallback, saved to your media library.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-3 shadow-lg shadow-cyan-950/30 backdrop-blur-md">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_12px] shadow-cyan-300" />
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-cyan-100">&lt;IMG&gt; Vision Engine</span>
              <span className="text-[11px] text-cyan-300/70">Direct-Load · 40s Pipeline</span>
            </div>
          </div>
        </header>

        {/* Prompt Input Box */}
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.09] bg-white/[0.035] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl md:p-6">
          <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />

          <div className="relative z-10 flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    generate();
                  }
                }}
                placeholder="Describe the image you want to create in vivid detail…"
                rows={2}
                className="min-h-16 flex-1 resize-none rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3.5 text-sm text-white outline-none placeholder:text-zinc-500 transition-colors focus:border-cyan-400/60 focus:bg-black/40"
              />
              <button
                type="button"
                onClick={() => generate()}
                disabled={busy || !prompt.trim()}
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-8 py-3.5 text-sm font-bold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-400/30 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06202a]/30 border-t-[#06202a]" />
                    <span>Rendering…</span>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-4 w-4" />
                    <span>Generate</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex items-center gap-1.5">
                  <span>Press</span>
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    Enter
                  </kbd>
                  <span>to generate ·</span>
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    Shift + Enter
                  </kbd>
                  <span>for new line</span>
                </p>

                {/* Aspect ratio — baked into the direct URL as width/height */}
                <div className="flex items-center gap-1.5" role="group" aria-label="Aspect ratio">
                  <span className="text-[11px] text-zinc-600">Aspect:</span>
                  {(Object.keys(ASPECT_OPTIONS) as AspectKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAspect(key)}
                      title={`${ASPECT_OPTIONS[key].width}×${ASPECT_OPTIONS[key].height}`}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                        aspect === key
                          ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-300"
                          : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-cyan-400/40 hover:text-cyan-300"
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick suggestions */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-zinc-600">Try:</span>
                {PRESET_PROMPTS.slice(0, 3).map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setPrompt(preset);
                    }}
                    className="truncate max-w-[140px] sm:max-w-[180px] rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                    title={preset}
                  >
                    {preset.split(" ").slice(0, 3).join(" ")}…
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Gallery Controls */}
        {tiles.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Media Library
              </h2>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-400">
                {tiles.length}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {failedCount > 0 && (
                <button
                  type="button"
                  onClick={clearFailed}
                  className="flex items-center gap-1.5 text-xs font-medium text-red-400 transition hover:text-red-300"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Clear Failed ({failedCount})
                </button>
              )}
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                Clear All
              </button>
            </div>
          </div>
        )}

        {/* Tiles Grid */}
        {tiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.015] py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-zinc-600">
              <ImageIcon className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-300">No images generated yet</h3>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">
              Type a prompt above and press Generate. Images load directly from the Vision engine with a 40-second safety window, and every finished asset is saved to your media library.
            </p>
          </div>
        ) : (
          <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((tile) => (
              <article
                key={tile.id}
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] shadow-xl shadow-black/30 transition-all hover:border-cyan-400/30 hover:bg-white/[0.04]"
              >
                <div
                  className="relative w-full overflow-hidden bg-[#0a0e1c]"
                  style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
                >
                  {tile.status === "ready" && tile.url ? (
                    <>
                      <img
                        src={tile.url}
                        alt={tile.prompt}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      {/* Floating overlay actions on hover */}
                      <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => window.open(tile.url, "_blank", "noopener,noreferrer")}
                            title="Open full resolution"
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-cyan-500 hover:text-black"
                          >
                            <ArrowUpRightIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadImage(tile.url!, tile.prompt)}
                            title="Download image"
                            className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-cyan-500 hover:text-black"
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="rounded-lg bg-black/60 px-2 py-1 text-[10px] font-medium text-cyan-300 backdrop-blur-md">
                            {tile.viaProxy ? "Proxied HD" : "Direct Pollinations"}
                          </span>
                          <button
                            type="button"
                            onClick={() => generate(tile.prompt, aspectForTile(tile))}
                            title="Generate variation"
                            className="flex items-center gap-1 rounded-lg bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-cyan-400 hover:text-black"
                          >
                            <RefreshIcon className="h-3 w-3" />
                            <span>Remix</span>
                          </button>
                        </div>
                      </div>
                    </>
                  ) : tile.status === "loading" ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-zinc-400">
                      <div className="relative">
                        <span className="block h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-cyan-400" />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <SparklesIcon className="h-4 w-4 animate-pulse text-cyan-300" />
                        </span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-zinc-200">
                          Creating your image…
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          Direct load · proxy fallback · up to 40s
                        </p>
                      </div>
                    </div>
                  ) : (
                    /* Error state */
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400">
                        <RefreshIcon className="h-6 w-6" />
                      </div>
                      <span className="text-sm font-medium text-red-300">
                        This image took too long to create.
                      </span>
                      <p className="text-xs text-zinc-500">
                        Both the direct provider and the proxy fallback were unresponsive.
                      </p>
                      <button
                        type="button"
                        onClick={() => generate(tile.prompt, aspectForTile(tile))}
                        className="mt-2 flex items-center gap-1.5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 active:scale-95"
                      >
                        <RefreshIcon className="h-3.5 w-3.5" />
                        Retry Generation
                      </button>
                    </div>
                  )}
                </div>

                {/* Card Prompt Footer */}
                <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/20 p-3.5">
                  <p className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={tile.prompt}>
                    {tile.prompt}
                  </p>
                  <button
                    type="button"
                    onClick={() => copyPrompt(tile.id, tile.prompt)}
                    title="Copy prompt"
                    className="ml-2 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
                  >
                    {copiedId === tile.id ? (
                      <CheckIcon className="h-3.5 w-3.5 text-cyan-400" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
