"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  makeStudioAssetId,
  listStudioMedia,
  saveStudioMedia,
  shareStudioMedia,
  studioShareUrl,
  STUDIO_MEDIA_UPDATED_EVENT,
  type StudioMediaAsset,
} from "@/lib/studio";
import {
  CheckIcon,
  CopyIcon,
  ImageIcon,
  LoaderIcon,
  ShareIcon,
  SparklesIcon,
  XIcon,
} from "@/components/icons";

const IMAGE_GENERATOR_ORIGIN = "https://image.pollinations.ai/prompt/";

type ShareState =
  | { status: "idle" }
  | { status: "sharing"; assetId: string }
  | { status: "ready"; url: string; title: string }
  | { status: "error"; message: string };

function assetTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 64 ? `${clean.slice(0, 61).trimEnd()}…` : clean || "Untitled Studio image";
}

function generatorUrl(prompt: string, seed: string): string {
  const query = new URLSearchParams({
    width: "1024",
    height: "1024",
    nologo: "true",
    seed,
  });
  return `${IMAGE_GENERATOR_ORIGIN}${encodeURIComponent(prompt)}?${query.toString()}`;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "Unknown date";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function StudioPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [assets, setAssets] = useState<StudioMediaAsset[]>([]);
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const refresh = () => setAssets(listStudioMedia());
    refresh();
    window.addEventListener(STUDIO_MEDIA_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STUDIO_MEDIA_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const generatedCountLabel = useMemo(
    () => `${assets.length} generated image${assets.length === 1 ? "" : "s"}`,
    [assets.length]
  );

  const generate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedPrompt = prompt.trim();
    if (!cleanedPrompt) return;

    // The URL calls the live image generator when the browser renders it; the
    // saved item is the actual generated media source, not a placeholder.
    const id = makeStudioAssetId();
    const asset: StudioMediaAsset = {
      id,
      title: assetTitle(cleanedPrompt),
      prompt: cleanedPrompt,
      imageUrl: generatorUrl(cleanedPrompt, id),
      createdAt: new Date().toISOString(),
      shareSlug: null,
    };
    const next = [asset, ...assets];
    setAssets(next);
    saveStudioMedia(next);
    setPrompt("");
  };

  const shareAsset = async (asset: StudioMediaAsset) => {
    setShare({ status: "sharing", assetId: asset.id });
    setCopied(false);
    try {
      const shared = await shareStudioMedia(asset);
      const url = studioShareUrl(shared.slug);
      const next = assets.map((item) =>
        item.id === asset.id ? { ...item, shareSlug: shared.slug } : item
      );
      setAssets(next);
      saveStudioMedia(next);
      // Clipboard access is a user gesture here. Failure still leaves the
      // exact real link visible in Share Hub for manual copying.
      setCopied(await copyText(url));
      setShare({ status: "ready", url, title: shared.title });
    } catch (error) {
      setShare({
        status: "error",
        message: error instanceof Error ? error.message : "Could not create a share link.",
      });
    }
  };

  const closeShareHub = () => {
    setShare({ status: "idle" });
    setCopied(false);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-300">
            <SparklesIcon className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">Live image studio</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Studio</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Generate images from a prompt and keep the real media library in this browser.
          </p>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-400">
          {generatedCountLabel}
        </span>
      </div>

      <section className="mt-7 rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-cyan-400/[0.08] to-violet-500/[0.06] p-5 shadow-xl shadow-black/10">
        <form onSubmit={generate} className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="studio-prompt">Image prompt</label>
          <input
            id="studio-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={800}
            placeholder="Describe an image to generate…"
            className="h-12 min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-[#0a1020]/70 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/50"
          />
          <button
            type="submit"
            disabled={!prompt.trim()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <SparklesIcon className="h-4 w-4" />
            Generate image
          </button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          Generated images are saved only after you create them. Sharing stores the public image and prompt in Supabase.
        </p>
      </section>

      {assets.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.015] px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10">
            <ImageIcon className="h-5 w-5 text-cyan-300" />
          </div>
          <h2 className="mt-4 text-base font-medium text-zinc-100">No Studio images yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
            Start with a prompt above. This library intentionally stays empty until you generate a real image.
          </p>
        </section>
      ) : (
        <section className="mt-8" aria-label="Generated Studio media">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <article key={asset.id} className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
                <div className="aspect-square overflow-hidden bg-black/30">
                  {/* External generated image URLs intentionally use img; Next image optimization is not needed. */}
                  <img
                    src={asset.imageUrl}
                    alt={asset.prompt}
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                  />
                </div>
                <div className="p-4">
                  <h2 className="truncate text-sm font-medium text-zinc-100" title={asset.title}>{asset.title}</h2>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{asset.prompt}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <time className="text-[11px] text-zinc-600" dateTime={asset.createdAt}>{timeLabel(asset.createdAt)}</time>
                    <button
                      type="button"
                      onClick={() => void shareAsset(asset)}
                      disabled={share.status === "sharing" && share.assetId === asset.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20 disabled:opacity-50"
                    >
                      {share.status === "sharing" && share.assetId === asset.id ? (
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShareIcon className="h-3.5 w-3.5" />
                      )}
                      {asset.shareSlug ? "Share again" : "Share"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {share.status === "ready" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="share-hub-title">
          <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close Share Hub" onClick={closeShareHub} />
          <section className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#11162a] p-6 shadow-2xl shadow-black/60">
            <button type="button" onClick={closeShareHub} aria-label="Close Share Hub" className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
              <XIcon className="h-4 w-4" />
            </button>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <CheckIcon className="h-5 w-5" />
            </div>
            <h2 id="share-hub-title" className="mt-4 pr-8 text-lg font-semibold text-white">Share Hub</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {copied ? "Your real public link was copied to the clipboard." : "Your public link is ready to copy."}
            </p>
            <p className="mt-4 truncate text-sm font-medium text-zinc-200" title={share.title}>{share.title}</p>
            <div className="mt-2 flex gap-2 rounded-xl border border-white/[0.08] bg-black/20 p-2">
              <input readOnly value={share.url} aria-label="Public Studio share URL" className="min-w-0 flex-1 bg-transparent px-2 text-xs text-zinc-400 outline-none" />
              <button
                type="button"
                onClick={() => void copyText(share.url).then(setCopied)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-[#06202a] hover:bg-cyan-400"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => router.push(new URL(share.url).pathname)} className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.05]">
                Preview share
              </button>
              <button type="button" onClick={closeShareHub} className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-200">Done</button>
            </div>
          </section>
        </div>
      )}

      {share.status === "error" && (
        <div className="fixed bottom-5 right-5 z-[70] max-w-sm rounded-xl border border-red-400/25 bg-[#21131b] px-4 py-3 text-sm text-red-200 shadow-xl shadow-black/40" role="alert">
          <div className="flex items-start justify-between gap-4">
            <span>{share.message}</span>
            <button type="button" onClick={() => setShare({ status: "idle" })} aria-label="Dismiss error" className="text-red-300/70 hover:text-red-100"><XIcon className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
