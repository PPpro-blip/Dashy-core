"use client";

/**
 * DashyCore v7 — Dashy Studio (zero-cost image generation + Share Hub).
 *
 * - Prompt composer generates images through the same zero-cost
 *   pollinations.ai <IMG> engine used by chat's "Create AI art" action —
 *   no backend round-trip, no API key.
 * - Every generated image is saved to the local media library
 *   (`dashy.media.library` — see lib/media-library.ts) so the gallery
 *   survives reloads.
 * - Each card has a Share button that upserts a public row into Supabase
 *   `shared_assets` (falling back to a local-only link if that table isn't
 *   migrated yet — see lib/share.ts) and opens the Share Hub modal.
 */

import { useEffect, useState } from "react";
import {
  addMedia,
  listMedia,
  MEDIA_LIBRARY_UPDATED_EVENT,
  removeMedia,
  updateMedia,
  type MediaAsset,
} from "@/lib/media-library";
import { setSharePublic, shareAsset } from "@/lib/share";
import { useToast } from "@/components/Toast";
import { ShareHubModal } from "@/components/ShareHubModal";
import {
  DownloadIcon,
  ImageIcon,
  LoaderIcon,
  ShareIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";

const SUGGESTIONS = [
  "A cyberpunk cat in neon rain",
  "A cozy cabin in a snowy forest, golden hour",
  "A futuristic city skyline at sunset, cinematic",
  "An astronaut surfing on Saturn's rings",
];

function buildImageUrl(prompt: string): string {
  const seed = Math.floor(Math.random() * 100000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?width=1024&height=1024&nologo=true&seed=${seed}`;
}

export default function StudioPage() {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [shareTarget, setShareTarget] = useState<MediaAsset | null>(null);
  const [sharePersisted, setSharePersisted] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const refresh = () => setAssets(listMedia());

  useEffect(() => {
    refresh();
    window.addEventListener(MEDIA_LIBRARY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(MEDIA_LIBRARY_UPDATED_EVENT, refresh);
  }, []);

  const handleGenerate = (promptOverride?: string) => {
    const text = (promptOverride ?? prompt).trim();
    if (!text) {
      toast.error("Describe an image first", "Type a prompt, then tap Generate.");
      return;
    }
    setGenerating(true);
    // Zero-cost <IMG> engine — instant client-side URL, no worker call.
    const imageUrl = buildImageUrl(text);
    // The browser fetches the image lazily via <img>; we optimistically add
    // the card right away so Studio feels instant, same as chat's <IMG> flow.
    addMedia({ prompt: text, imageUrl });
    setPrompt("");
    window.setTimeout(() => setGenerating(false), 600);
    toast.success("Generating…", `Rendering “${text.slice(0, 60)}${text.length > 60 ? "…" : ""}”`);
  };

  const handleShare = async (asset: MediaAsset) => {
    setSharingId(asset.id);
    try {
      const result = await shareAsset({ imageUrl: asset.imageUrl, title: asset.prompt });
      updateMedia(asset.id, {
        shareSlug: result.slug,
        shareUrl: result.url,
        isPublic: true,
      });
      try {
        await navigator.clipboard.writeText(result.url);
        toast.success("Link copied", result.url);
      } catch {
        toast.success("Share link ready", result.url);
      }
      setShareTarget({ ...asset, shareSlug: result.slug, shareUrl: result.url, isPublic: true });
      setSharePersisted(result.persisted);
      setShareModalOpen(true);
    } catch {
      toast.error("Could not create a share link", "Please try again.");
    } finally {
      setSharingId(null);
    }
  };

  const handleTogglePublic = async (next: boolean) => {
    if (!shareTarget?.shareSlug) return;
    setShareTarget((prev) => (prev ? { ...prev, isPublic: next } : prev));
    updateMedia(shareTarget.id, { isPublic: next });
    await setSharePublic(shareTarget.shareSlug, next);
  };

  const handleDownload = (asset: MediaAsset) => {
    const link = document.createElement("a");
    link.href = asset.imageUrl;
    link.download = `dashy-studio-${asset.id}.jpg`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  };

  const handleDelete = (asset: MediaAsset) => {
    removeMedia(asset.id);
    toast.info("Removed from Studio");
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Studio</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Generate AI art instantly, build a gallery and share it with a
            public link — zero cost, zero API key.
          </p>
        </div>
      </div>

      {/* Composer */}
      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <SparklesIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-400" />
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerate();
              }}
              placeholder="Describe an image… e.g. a cyberpunk cat in neon rain"
              aria-label="Image prompt"
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50"
            />
          </div>
          <button
            type="button"
            onClick={() => handleGenerate()}
            disabled={generating}
            className="flex h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
            Generate
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleGenerate(s)}
              className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* Gallery */}
      <section className="mt-8">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Your creations · {assets.length}
        </p>
        {assets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-black/20 px-6 py-16 text-center">
            <ImageIcon className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-400">No images yet</p>
            <p className="mt-1 text-xs text-zinc-600">
              Describe an image above and tap Generate to create your first
              piece.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.imageUrl}
                  alt={asset.prompt}
                  loading="lazy"
                  className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3">
                  <p className="line-clamp-2 text-[11px] leading-snug text-zinc-200">
                    {asset.prompt}
                  </p>
                  {asset.shareUrl && (
                    <p className="mt-1 truncate text-[10px] text-cyan-300/80">
                      Shared · {asset.shareUrl.replace(/^https?:\/\//, "")}
                    </p>
                  )}
                </div>
                <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => void handleShare(asset)}
                    disabled={sharingId === asset.id}
                    title="Share"
                    aria-label={`Share image: ${asset.prompt}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.1] bg-black/60 text-zinc-200 backdrop-blur transition-colors hover:border-cyan-400/50 hover:text-cyan-300"
                  >
                    {sharingId === asset.id ? (
                      <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShareIcon className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(asset)}
                    title="Download"
                    aria-label={`Download image: ${asset.prompt}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.1] bg-black/60 text-zinc-200 backdrop-blur transition-colors hover:border-white/[0.3]"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(asset)}
                    title="Delete"
                    aria-label={`Delete image: ${asset.prompt}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.1] bg-black/60 text-zinc-200 backdrop-blur transition-colors hover:border-red-400/50 hover:text-red-300"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {shareTarget && (
        <ShareHubModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          imageUrl={shareTarget.imageUrl}
          title={shareTarget.prompt}
          shareUrl={shareTarget.shareUrl ?? ""}
          persisted={sharePersisted}
          isPublic={shareTarget.isPublic ?? true}
          onTogglePublic={(next) => void handleTogglePublic(next)}
        />
      )}
    </div>
  );
}
