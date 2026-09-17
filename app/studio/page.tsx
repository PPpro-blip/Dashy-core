"use client";

/**
 * DashyCore — Studio (AI image generation).
 *
 * "Nuclear" raw-URL approach:
 *   1. Generate builds a pollinations.ai URL with a random seed.
 *   2. We DO NOT fetch() it — a background `new Image()` preloads it.
 *   3. `onLoad` flips the asset to `ready` and the <img> renders the URL.
 *   4. `onError` — and ONLY then — retries once via /api/img-proxy.
 *
 * Check the Network tab: each generation is just an <img> loading a URL.
 */

import { useCallback, useState } from "react";
import {
  ImageIcon,
  LoaderIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";

type AssetStatus = "generating" | "ready" | "error";

interface StudioAsset {
  id: string;
  prompt: string;
  seed: number;
  /** The direct pollinations.ai URL (what the <img> loads). */
  targetUrl: string;
  /** Confirmed-loadable URL: direct URL, or the proxy fallback. */
  url: string | null;
  width: number;
  height: number;
  status: AssetStatus;
  createdAt: number;
}

interface SizePreset {
  label: string;
  width: number;
  height: number;
}

const SIZE_PRESETS: SizePreset[] = [
  { label: "Square 1024×1024", width: 1024, height: 1024 },
  { label: "Portrait 768×1152", width: 768, height: 1152 },
  { label: "Landscape 1280×768", width: 1280, height: 768 },
  { label: "Wide 1536×640", width: 1536, height: 640 },
];

const PROMPT_IDEAS = [
  "Neon cyberpunk city at night, rain reflections, cinematic",
  "Cozy cabin in snowy mountains at dusk, warm windows",
  "Abstract gradient waves, cyan and violet, minimal",
  "Astronaut riding a horse on Mars, photorealistic",
];

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildPollinationsUrl(
  prompt: string,
  seed: number,
  width: number,
  height: number
): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?seed=${seed}&width=${width}&height=${height}&nologo=true&model=flux`;
}

export default function StudioPage() {
  const [prompt, setPrompt] = useState("");
  const [sizeIndex, setSizeIndex] = useState(0);
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const size = SIZE_PRESETS[sizeIndex] ?? SIZE_PRESETS[0];

  const markAsset = useCallback(
    (id: string, patch: Partial<StudioAsset>) => {
      setAssets((prev) =>
        prev.map((asset) =>
          asset.id === id ? { ...asset, ...patch } : asset
        )
      );
    },
    []
  );

  /**
   * Background preloader — never fetch(), just an Image element.
   * Direct URL first; the /api/img-proxy fallback ONLY on error.
   */
  const preloadAsset = useCallback(
    (id: string, targetUrl: string) => {
      const direct = new Image();
      direct.onload = () => {
        markAsset(id, { status: "ready", url: targetUrl });
      };
      direct.onerror = () => {
        // Direct load failed — one retry through the same-origin proxy.
        const proxyUrl = `/api/img-proxy?url=${encodeURIComponent(targetUrl)}`;
        const fallback = new Image();
        fallback.onload = () => {
          markAsset(id, { status: "ready", url: proxyUrl });
        };
        fallback.onerror = () => {
          markAsset(id, { status: "error", url: null });
        };
        fallback.src = proxyUrl;
      };
      direct.src = targetUrl;
    },
    [markAsset]
  );

  const handleGenerate = useCallback(() => {
    const clean = prompt.trim();
    if (!clean) return;

    const seed = Math.floor(Math.random() * 1_000_000);
    const targetUrl = buildPollinationsUrl(
      clean,
      seed,
      size.width,
      size.height
    );

    const asset: StudioAsset = {
      id: newId(),
      prompt: clean,
      seed,
      targetUrl,
      url: null,
      width: size.width,
      height: size.height,
      status: "generating",
      createdAt: Date.now(),
    };

    // DO NOT FETCH — register as generating, preload in the background.
    setAssets((prev) => [asset, ...prev]);
    preloadAsset(asset.id, targetUrl);
  }, [prompt, size.width, size.height, preloadAsset]);

  const handleRetry = useCallback(
    (asset: StudioAsset) => {
      markAsset(asset.id, { status: "generating", url: null });
      preloadAsset(asset.id, asset.targetUrl);
    },
    [markAsset, preloadAsset]
  );

  const handleDelete = useCallback((id: string) => {
    setAssets((prev) => prev.filter((asset) => asset.id !== id));
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  const generatingCount = assets.filter(
    (asset) => asset.status === "generating"
  ).length;
  const lightbox = assets.find((asset) => asset.id === lightboxId) ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/10 shadow-lg shadow-fuchsia-500/10">
          <ImageIcon className="h-5 w-5 text-fuchsia-300" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Studio
          </h1>
          <p className="text-xs text-zinc-500">
            Text-to-image · FLUX · raw URL rendering
          </p>
        </div>
        {generatingCount > 0 && (
          <span className="ml-auto flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300">
            <LoaderIcon className="h-3 w-3 animate-spin" />
            {generatingCount} generating…
          </span>
        )}
      </div>

      {/* Generator card */}
      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <label
          htmlFor="studio-prompt"
          className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          Prompt
        </label>
        <textarea
          id="studio-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the image you want… (Enter to generate)"
          rows={3}
          className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-fuchsia-400/50"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SIZE_PRESETS.map((preset, index) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setSizeIndex(index)}
              aria-pressed={sizeIndex === index}
              className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                sizeIndex === index
                  ? "border-fuchsia-400/50 bg-fuchsia-400/10 text-fuchsia-200"
                  : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:border-white/[0.16] hover:text-zinc-300"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <SparklesIcon className="h-4 w-4" />
            Generate
          </button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-zinc-600">Try:</span>
            {PROMPT_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setPrompt(idea)}
                className="max-w-full truncate rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
              >
                {idea.slice(0, 32)}…
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="mt-6">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.10] px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/10">
              <ImageIcon className="h-6 w-6 text-fuchsia-300" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-200">
              Nothing generated yet
            </p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
              Describe an image above and hit Generate — it renders straight
              from the source URL, no middleman.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <article
                key={asset.id}
                className="group overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
              >
                <div
                  className="relative flex aspect-square items-center justify-center overflow-hidden bg-black/40"
                  style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
                >
                  {asset.status === "generating" && (
                    <div className="flex h-full w-full animate-pulse flex-col items-center justify-center gap-3 bg-gradient-to-br from-cyan-500/[0.07] via-transparent to-violet-500/[0.07]">
                      <LoaderIcon className="h-8 w-8 animate-spin text-cyan-400" />
                      <p className="px-6 text-center text-xs leading-relaxed text-zinc-500">
                        Dreaming up pixels…
                      </p>
                      <span className="rounded-md border border-white/[0.08] bg-black/40 px-2 py-0.5 font-mono text-[10px] text-zinc-600">
                        seed {asset.seed}
                      </span>
                    </div>
                  )}

                  {asset.status === "ready" && asset.url && (
                    <button
                      type="button"
                      onClick={() => setLightboxId(asset.id)}
                      className="h-full w-full cursor-zoom-in"
                      aria-label={`View ${asset.prompt}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.url}
                        alt={asset.prompt}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    </button>
                  )}

                  {asset.status === "error" && (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
                      <XIcon className="h-6 w-6 text-red-400" />
                      <p className="text-xs leading-relaxed text-zinc-500">
                        The image failed to load (direct + proxy).
                      </p>
                      <button
                        type="button"
                        onClick={() => handleRetry(asset)}
                        className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-400/20"
                      >
                        <RefreshIcon className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/[0.06] px-3.5 py-3">
                  <p className="truncate text-xs text-zinc-300" title={asset.prompt}>
                    {asset.prompt}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-zinc-600">
                    <span>seed {asset.seed}</span>
                    <span>·</span>
                    <span>
                      {asset.width}×{asset.height}
                    </span>
                    <span
                      className={`ml-auto rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${
                        asset.status === "ready"
                          ? "bg-emerald-400/10 text-emerald-300"
                          : asset.status === "generating"
                            ? "bg-cyan-400/10 text-cyan-300"
                            : "bg-red-400/10 text-red-300"
                      }`}
                    >
                      {asset.status}
                    </span>
                  </div>
                  {asset.status === "ready" && asset.url && (
                    <div className="mt-2.5 flex gap-1.5">
                      <a
                        href={asset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={`studio-${asset.seed}.jpg`}
                        className="flex-1 rounded-lg bg-cyan-500 px-2 py-1.5 text-center text-[11px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                      >
                        Open full size
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDelete(asset.id)}
                        aria-label="Delete image"
                        className="rounded-lg border border-white/[0.08] px-2 py-1.5 text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-400"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Lightbox */}
      {lightbox && lightbox.url && (
        <>
          <button
            type="button"
            aria-label="Close preview"
            onClick={() => setLightboxId(null)}
            className="fixed inset-0 z-40 cursor-zoom-out bg-black/80 backdrop-blur-sm"
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
            <figure className="pointer-events-auto max-h-full max-w-4xl overflow-hidden rounded-2xl border border-white/[0.10] bg-[#0d1220] shadow-2xl shadow-black/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.url}
                alt={lightbox.prompt}
                className="max-h-[75vh] w-auto max-w-full object-contain"
              />
              <figcaption className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                  {lightbox.prompt}
                </p>
                <span className="font-mono text-[10px] text-zinc-600">
                  seed {lightbox.seed}
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxId(null)}
                  className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  Close
                </button>
              </figcaption>
            </figure>
          </div>
        </>
      )}
    </div>
  );
}
