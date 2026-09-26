"use client";

/**
 * DashyCore v7 — Dashy Studio.
 *
 * Zero-cost image generation (pollinations.ai, same engine as the chat <IMG>
 * button) with a real media library persisted in `dashy.media.library`
 * (localStorage) and a database-backed Share Hub:
 *
 *   Share → upsert into Supabase `shared_assets` (image_url = proxied URL,
 *   title = prompt, is_public = true) → copy https://dashy-core.vercel.app/s/<slug>
 *   → open the Share Hub modal (OG preview, social exports, public toggle).
 *
 * Sharing is schema-safe: if `shared_assets` is missing the UI still produces
 * the link and explains the state — it never crashes.
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { ShareHubModal, type ShareHubState } from "@/components/ShareHubModal";
import {
  addMedia,
  listMedia,
  MEDIA_LIBRARY_EVENT,
  newAssetId,
  proxiedImageUrl,
  removeMedia,
  updateMedia,
  type MediaAsset,
} from "@/lib/media-library";
import { shareAsset, shareUrlFor } from "@/lib/shared-assets";
import {
  DownloadIcon,
  GlobeIcon,
  ImageIcon,
  LoaderIcon,
  SparklesIcon,
  Share2Icon,
  TrashIcon,
} from "@/components/icons";

function pollinationsUrl(prompt: string): string {
  const seed = Math.floor(Math.random() * 100_000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?width=1024&height=1024&nologo=true&seed=${seed}`;
}

export default function StudioPage() {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [generating, setGenerating] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<ShareHubState | null>(null);

  /* Media library is the single source of truth (also read by Analytics). */
  useEffect(() => {
    setAssets(listMedia());
    const sync = () => setAssets(listMedia());
    window.addEventListener(MEDIA_LIBRARY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MEDIA_LIBRARY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const handleGenerate = useCallback(() => {
    const text = prompt.trim();
    if (!text) {
      toast.error("Describe an image first", "Type a prompt, then hit Generate.");
      return;
    }
    setGenerating(true);
    const asset: MediaAsset = {
      id: newAssetId(),
      url: pollinationsUrl(text),
      prompt: text,
      createdAt: Date.now(),
      shareSlug: null,
      isPublic: false,
    };
    setAssets(addMedia(asset));
    setPrompt("");
    setGenerating(false);
    toast.success("Rendering", `“${text.slice(0, 60)}${text.length > 60 ? "…" : ""}”`);
  }, [prompt, toast]);

  const handleShare = useCallback(
    async (asset: MediaAsset) => {
      setSharingId(asset.id);
      try {
        const result = await shareAsset({
          imageUrl: proxiedImageUrl(asset.url),
          title: asset.prompt || "Dashy Studio image",
          isPublic: true,
          slug: asset.shareSlug ?? null,
        });

        setAssets(
          updateMedia(asset.id, {
            shareSlug: result.asset.slug,
            isPublic: result.asset.isPublic,
          })
        );

        const url = shareUrlFor(result.asset.slug);
        try {
          await navigator.clipboard.writeText(url);
          toast.success("Link copied", url);
        } catch {
          toast.info("Share link ready", url);
        }

        setShareState({
          asset: result.asset,
          persisted: result.persisted,
          reason: result.reason,
        });
      } finally {
        setSharingId(null);
      }
    },
    [toast]
  );

  const handleDelete = useCallback((id: string) => {
    setAssets(removeMedia(id));
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        Dashy Studio
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Generate images with the zero-cost engine, then publish them to the
        Share Hub with one tap.
      </p>

      {/* Composer */}
      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleGenerate();
            }}
            placeholder="A neon cyan dashboard floating over a dark ocean…"
            aria-label="Image prompt"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-cyan-400/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-60"
          >
            {generating ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SparklesIcon className="h-4 w-4" />
            )}
            Generate
          </button>
        </div>
      </section>

      {/* Library */}
      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Media library
          </h2>
          <span className="text-xs text-zinc-500">
            {assets.length} asset{assets.length === 1 ? "" : "s"}
          </span>
        </div>

        {assets.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
              <ImageIcon className="h-6 w-6 text-cyan-400" />
            </div>
            <p className="mt-4 text-base font-medium text-zinc-100">
              No images yet
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Describe something above and hit Generate — it lands here
              instantly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <article
                key={asset.id}
                className="group overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-cyan-400/30"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-black/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={asset.prompt}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  {asset.shareSlug ? (
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-cyan-400/30 bg-[#06202a]/80 px-2 py-1 text-[10px] font-medium text-cyan-300">
                      <GlobeIcon className="h-3 w-3" />
                      Shared
                    </span>
                  ) : null}
                </div>

                <div className="p-3">
                  <p className="line-clamp-2 text-xs text-zinc-300">
                    {asset.prompt}
                  </p>
                  <div className="mt-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleShare(asset)}
                      disabled={sharingId === asset.id}
                      title="Share to the Share Hub"
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-60"
                    >
                      {sharingId === asset.id ? (
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Share2Icon className="h-3.5 w-3.5" />
                      )}
                      Share
                    </button>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open full size"
                      className="rounded-lg border border-white/[0.08] p-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDelete(asset.id)}
                      title="Remove from library"
                      aria-label="Remove from library"
                      className="rounded-lg border border-white/[0.08] p-2 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <ShareHubModal
        state={shareState}
        onClose={() => setShareState(null)}
        onVisibilityChange={(slug, isPublic) => {
          const target = assets.find((asset) => asset.shareSlug === slug);
          if (target) setAssets(updateMedia(target.id, { isPublic }));
        }}
      />
    </div>
  );
}
