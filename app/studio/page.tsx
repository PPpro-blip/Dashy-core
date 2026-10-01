"use client";

/**
 * Dashy Studio — Turbo image generation with a Media Library.
 *
 * Pipeline (Turbo, PROXY-FIRST):
 *  1. Build the prompt-mode proxy URL:
 *     /api/img-proxy?prompt=&seed=&width=&height=&turbo=true
 *     The server waits up to 45s for the upstream render, then streams the
 *     finished bytes — the browser sees one fast, complete download.
 *  2. `onload` flips the asset from `generating` -> `ready` and its imgUrl is
 *     saved to the `dashy.media.library` localStorage store.
 *  3. `onerror` retries through the DIRECT Turbo Pollinations URL
 *     (disjoint failure mode: provider lane when the proxy lane fails); if
 *     that fails too the tile errors out.
 *  4. A hard 50-second timer bounds every generation — slow jobs flip to
 *     `error` with a "Retry Turbo" button. Pending jobs clean up on unmount.
 *  5. On mount, a sanitizer resets legacy stuck entries (`generating` /
 *     `pending` / `loading`) in `dashy.media.library` to `error` so they can
 *     be retried or cleared instead of hanging forever.
 *
 * SHARE: every ready card links to THE canonical Share Hub (/share) with
 * that exact asset pre-selected. Publishing the `s_img_*` public link is an
 * explicit action inside the hub (Supabase-backed, works in incognito).
 *
 * Video tab is intentionally honest: real AI video needs paid API keys, so it
 * shows a glassmorphism banner pointing at Settings / Image Mode.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { proxyPromptUrlFor } from "@/lib/img-engine";
import { copyText } from "@/lib/clipboard";
import {
  ASPECT_OPTIONS,
  aspectForTile,
  buildDirectUrl,
  downloadTileImage,
  loadLibrary,
  saveLibrary,
  type AspectKey,
  type Tile,
} from "@/lib/studio-tiles";
import { StudioTabs } from "@/components/studio/StudioTabs";
import { useToast } from "@/components/Toast";
import {
  SparklesIcon,
  RefreshIcon,
  DownloadIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  ArrowUpRightIcon,
  ImageIcon,
  ShareIcon,
} from "@/components/icons";

/** Hard 50-second ceiling per Turbo generation: the proxy-first lane
 * waits up to 45s upstream, leaving a 5s+ window for the direct buster. */
const STUDIO_TIMEOUT_MS = 50_000;

type StudioMode = "image" | "video";

const PRESET_PROMPTS = [
  "Futuristic cyberpunk workstation glowing in neon blue and violet",
  "Photorealistic cozy glass cabin surrounded by pine trees at dusk",
  "Hyperdetailed isometric 3D render of an AI neural laboratory",
  "Cinematic astronaut exploring iridescent crystalline caverns on an alien world",
  "Minimalist obsidian logo emblem with metallic cyan reflections",
];

export default function StudioPage() {
  const router = useRouter();
  const [mode, setMode] = useState<StudioMode>("image");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<AspectKey>("1:1");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const toast = useToast();

  // Keep track of active image objects and timers for cleanup on unmount
  const activeJobsRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; cancel: () => void }>
  >(new Map());

  // Restore the Media Library once on mount. loadLibrary sanitizes legacy
  // stuck entries (generating/pending) to `error`, and the save effect below
  // writes the sanitized list straight back to dashy.media.library.
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
      // PROXY-FIRST: the prompt-mode lane renders server-side (45s wait).
      const proxyUrl = proxyPromptUrlFor({
        prompt: text,
        seed,
        width,
        height,
        turbo: true,
      });
      // Buster lane: the direct provider URL (disjoint failure mode).
      const directUrl = buildDirectUrl(text, seed, width, height);

      const newTile: Tile = {
        id,
        prompt: text,
        status: "generating",
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
      let primaryImg: HTMLImageElement | null = null;
      let busterImg: HTMLImageElement | null = null;

      const cleanup = () => {
        if (primaryImg) {
          primaryImg.onload = null;
          primaryImg.onerror = null;
          primaryImg = null;
        }
        if (busterImg) {
          busterImg.onload = null;
          busterImg.onerror = null;
          busterImg = null;
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

        // Asset complete: `ready` tiles (with their imgUrl) are persisted to
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

      // Hard 50-second timer — slow Turbo jobs flip to `error` with Retry.
      const timer = setTimeout(() => {
        console.warn(
          `[Studio] Turbo generation timed out after ${STUDIO_TIMEOUT_MS / 1000}s for prompt: "${text}"`
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

      // Direct-provider buster, armed when the proxy-first load errors.
      const tryDirectBuster = () => {
        if (finished || typeof window === "undefined") return;
        console.info(
          `[Studio] Proxy lane failed — retrying direct: ${directUrl}`
        );
        const fallback = new window.Image();
        busterImg = fallback;
        fallback.onload = () => {
          finish("ready", directUrl, false);
        };
        fallback.onerror = () => {
          // If the direct load also fails, mark as error
          console.error(
            `[Studio] Direct buster also failed for seed ${seed}`
          );
          finish("error");
        };
        fallback.decoding = "async";
        fallback.src = directUrl;
      };

      // PROXY-FIRST LOAD — /api/img-proxy renders server-side (45s upstream
      // wait) and streams finished bytes, so the browser preloads the URL
      // natively with `new Image()` (no fetch/JSON). `onload` flips
      // generating -> ready.
      const img = new window.Image();
      primaryImg = img;
      img.onload = () => {
        finish("ready", proxyUrl, true);
      };
      img.onerror = () => {
        // Retry with the direct provider buster or mark error
        tryDirectBuster();
      };
      img.decoding = "async";
      img.src = proxyUrl;
    },
    [prompt, aspect]
  );

  const clearFailed = () => {
    setTiles((current) => current.filter((tile) => tile.status !== "error"));
  };

  const copyPrompt = (id: string, text: string) => {
    // copyText() has a textarea fallback — a denied clipboard permission can
    // never throw an unhandled rejection here.
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const failedCount = tiles.filter((t) => t.status === "error").length;

  /**
   * Opens THE canonical Share Hub with this exact asset pre-selected.
   * Publishing the public /s/<slug> link is an explicit action in the hub.
   */
  const openShare = (tile: Tile) => {
    if (tile.status !== "ready" || !tile.url) return;
    router.push(`/share?sourceType=studio_asset&sourceId=${encodeURIComponent(tile.id)}`);
  };

  return (
    <div className="min-h-full bg-[#080b14] px-4 py-5 text-white sm:px-6 sm:py-6 md:px-12 lg:py-8">
      <div className="mx-auto max-w-6xl">
        {/* Compact identity header: the creative workspace remains the focus. */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-4 sm:pb-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-300">
                <SparklesIcon className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
                Dashy Studio
              </p>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
              Make something visual.
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-400">
              Turn high-level concepts into instant high-resolution imagery — Turbo Pollinations loads with a fast proxy fallback, saved to your media library.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-2 shadow-lg shadow-cyan-950/30 backdrop-blur-md sm:px-4">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_12px] shadow-cyan-300" />
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-cyan-100">Turbo Engine</span>
              <span className="text-[11px] text-cyan-300/70">Pollinations Turbo · 30s</span>
            </div>
          </div>
        </header>

        {/* The route and mode controls form one compact tool switcher. */}
        <div className="mt-4 flex flex-col items-start gap-3">
          {/* Generate | Library — real routes shared with the sidebar */}
          <StudioTabs />

          {/* Image / Video mode tabs */}
          <div
            role="tablist"
            aria-label="Studio mode"
            className="flex w-fit gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-md"
          >
            {(["image", "video"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-xl px-5 py-2 text-sm font-semibold capitalize transition-all ${
                  mode === m
                    ? "bg-cyan-400/15 text-cyan-200 shadow-lg shadow-cyan-950/40"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {m === "image" ? "Image Mode" : "Video Mode"}
              </button>
            ))}
          </div>
        </div>

        {mode === "video" ? (
          /* Honest Video Mode — real AI video needs paid provider keys. */
          <section className="relative mt-3 overflow-hidden rounded-3xl border border-white/[0.09] bg-white/[0.035] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8 md:p-10">
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
            <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-300">
                <ImageIcon className="h-7 w-7" />
              </span>
              <h2 className="mt-5 text-2xl font-bold tracking-tight text-white">
                Video Mode
              </h2>
              <p className="mt-3 rounded-2xl border border-white/[0.08] bg-black/30 px-5 py-4 text-sm leading-relaxed text-zinc-300 backdrop-blur-md">
                Real AI Video generation requires paid API keys (Runway / Luma / Replicate). Please add keys in Settings or use Image Mode.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setMode("image")}
                  className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-3 text-sm font-bold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-400/30 hover:brightness-105 active:scale-[0.98]"
                >
                  <SparklesIcon className="h-4 w-4" />
                  Use Image Mode
                </button>
                <Link
                  href="/settings"
                  className="rounded-2xl border border-white/[0.10] bg-white/[0.03] px-6 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                >
                  Open Settings
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* Prompt Input Box */}
            <section className="relative mt-3 overflow-hidden rounded-3xl border border-white/[0.09] bg-white/[0.035] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl md:p-6">
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

            {/* Gallery Controls — latest results only; the Library tab has everything */}
            {tiles.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                    Latest results
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
                  <Link
                    href="/studio/library"
                    className="flex items-center gap-1 text-xs font-medium text-cyan-300 transition hover:text-cyan-200"
                  >
                    Open Library
                    <ArrowUpRightIcon className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            {/* Results only take up space after a generation exists. */}
            {tiles.length > 0 && (
              <section className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {tiles.slice(0, 6).map((tile) => (
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
                                onClick={() => openShare(tile)}
                                title="Share image"
                                aria-label="Share image"
                                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-violet-500 hover:text-white"
                              >
                                <ShareIcon className="h-4 w-4" />
                              </button>
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
                                onClick={() => downloadTileImage(tile.url!, tile.prompt)}
                                title="Download image"
                                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-cyan-500 hover:text-black"
                              >
                                <DownloadIcon className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="rounded-lg bg-black/60 px-2 py-1 text-[10px] font-medium text-cyan-300 backdrop-blur-md">
                                {tile.viaProxy ? "Proxied HD" : "Turbo Direct"}
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
                      ) : tile.status === "generating" ? (
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
                              Turbo load · proxy fallback · up to 30s
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
                            Retry Turbo
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Card Prompt Footer */}
                    <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/20 p-3.5">
                      <p className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={tile.prompt}>
                        {tile.prompt}
                      </p>
                      {tile.status === "ready" && tile.url && (
                        <button
                          type="button"
                          onClick={() => openShare(tile)}
                          title="Share image"
                          aria-label="Share image"
                          className="ml-2 flex h-7 flex-shrink-0 items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.08] px-2 text-[11px] font-semibold text-cyan-300 shadow-[0_0_12px_-4px] shadow-cyan-400/40 transition hover:border-violet-400/50 hover:bg-violet-500/15 hover:text-violet-200"
                        >
                          <ShareIcon className="h-3.5 w-3.5" />
                          Share
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => copyPrompt(tile.id, tile.prompt)}
                        title="Copy prompt"
                        className="ml-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
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
          </>
        )}
      </div>

    </div>
  );
}
