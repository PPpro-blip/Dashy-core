"use client";

/**
 * DashyCore v7 — Studio · Generate.
 *
 * Uses the image generator DashyCore already ships: the Pollinations <IMG>
 * engine behind the chat composer's IMG button (lib/studio.buildImageUrl is
 * the single implementation both surfaces call). No new provider, no fake
 * API.
 *
 * Generated images are kept in the local Studio library (browser storage —
 * there is no server-side asset store in this repository yet) and can be
 * handed straight to the canonical Share Hub.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { useShareHub } from "@/components/share/ShareHubProvider";
import { StudioTabs } from "@/components/studio/StudioTabs";
import {
  buildImageUrl,
  listStudioAssets,
  saveStudioAsset,
  STUDIO_INCOMING_KEY,
  STUDIO_SIZES,
  type StudioAsset,
  type StudioSize,
} from "@/lib/studio";
import {
  AlertIcon,
  DownloadIcon,
  ImageIcon,
  LoaderIcon,
  ShareIcon,
  SparklesIcon,
  WandIcon,
} from "@/components/icons";

export default function StudioGeneratePage() {
  const toast = useToast();
  const shareHub = useShareHub();

  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<StudioSize>(STUDIO_SIZES[0]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asset, setAsset] = useState<StudioAsset | null>(null);
  const [recent, setRecent] = useState<StudioAsset[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setRecent(listStudioAssets().slice(0, 6));
  }, [asset]);

  /* "Open in Studio" hand-off from a chat image. */
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STUDIO_INCOMING_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(STUDIO_INCOMING_KEY);
      const incoming = JSON.parse(raw) as { prompt?: string };
      if (incoming.prompt) {
        setPrompt(incoming.prompt);
        promptRef.current?.focus();
      }
    } catch {
      // Corrupt hand-off — ignore.
    }
  }, []);

  const generate = useCallback(() => {
    const clean = prompt.trim();
    if (!clean) {
      toast.error("Describe the image first", "Tell Studio what to create.");
      promptRef.current?.focus();
      return;
    }
    setPending(true);
    setFailed(false);
    const url = buildImageUrl(clean, { width: size.width, height: size.height });
    // The asset is only stored once the image actually loads (onLoad below).
    setAsset({
      id: `pending-${Date.now()}`,
      prompt: clean,
      url,
      width: size.width,
      height: size.height,
      origin: "studio",
      createdAt: Date.now(),
    });
  }, [prompt, size, toast]);

  const handleLoaded = useCallback(() => {
    setPending(false);
    setAsset((current) => {
      if (!current) return current;
      // Persist on first successful render only.
      if (!current.id.startsWith("pending-")) return current;
      const saved = saveStudioAsset({
        prompt: current.prompt,
        url: current.url,
        width: current.width,
        height: current.height,
        origin: "studio",
      });
      return saved;
    });
  }, []);

  const handleError = useCallback(() => {
    setPending(false);
    setFailed(true);
  }, []);

  const share = useCallback(() => {
    if (!asset || asset.id.startsWith("pending-")) return;
    shareHub.open({
      kind: "studio-asset",
      id: asset.id,
      prompt: asset.prompt,
      imageUrl: asset.url,
      createdAt: asset.createdAt,
    });
  }, [asset, shareHub]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Studio
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Generate visuals with the Dashy image engine, then share them.
          </p>
        </div>
        <StudioTabs />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
        {/* ------------------------------ prompt ------------------------------ */}
        <section className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <label
              htmlFor="studio-prompt"
              className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
            >
              Prompt
            </label>
            <textarea
              id="studio-prompt"
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
              }}
              rows={4}
              placeholder="A neon-lit workstation at night, cinematic lighting, ultra detailed…"
              className="w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 focus:border-cyan-400/50 focus:outline-none"
            />

            <fieldset className="mt-3">
              <legend className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Format
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {STUDIO_SIZES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSize(s)}
                    aria-pressed={s.id === size.id}
                    className={`min-h-[36px] rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                      s.id === size.id
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                        : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              onClick={generate}
              disabled={pending || !prompt.trim()}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {pending ? (
                <LoaderIcon className="h-4 w-4 animate-spin" />
              ) : (
                <WandIcon className="h-4 w-4" />
              )}
              {pending ? "Generating…" : "Generate image"}
            </button>
            <p className="mt-2 text-center text-[11px] text-zinc-600">
              ⌘/Ctrl + Enter to generate · saved to your local Studio library
            </p>
          </div>

          {recent.length > 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Recent
                </h2>
                <Link
                  href="/studio/library"
                  className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200"
                >
                  Open library
                </Link>
              </div>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {recent.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAsset(item);
                        setPrompt(item.prompt);
                        setFailed(false);
                      }}
                      title={item.prompt}
                      className="relative block aspect-square w-full overflow-hidden rounded-lg border border-white/[0.08] bg-black/30 transition-colors hover:border-cyan-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                    >
                      <Image
                        src={item.url}
                        alt={item.prompt}
                        fill
                        unoptimized
                        sizes="120px"
                        className="object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ------------------------------ canvas ------------------------------ */}
        <section className="min-w-0">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Result
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <div className="relative flex aspect-square w-full items-center justify-center bg-black/30">
              {asset ? (
                <>
                  <Image
                    key={asset.url}
                    src={asset.url}
                    alt={asset.prompt}
                    fill
                    unoptimized
                    sizes="(max-width: 1024px) 100vw, 420px"
                    onLoad={handleLoaded}
                    onError={handleError}
                    className={`object-cover transition-opacity ${
                      pending ? "opacity-0" : "opacity-100"
                    }`}
                  />
                  {pending && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400">
                      <LoaderIcon className="h-5 w-5 animate-spin text-cyan-400" />
                      <p className="text-xs">Rendering your image…</p>
                    </div>
                  )}
                  {failed && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                      <AlertIcon className="h-5 w-5 text-red-400" />
                      <p className="text-xs text-zinc-300">
                        The image engine did not return an image. Try again or
                        adjust the prompt.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 px-6 text-center">
                  <SparklesIcon className="h-6 w-6 text-zinc-600" />
                  <p className="text-xs text-zinc-500">
                    Your generated image appears here.
                  </p>
                </div>
              )}
            </div>

            {asset && !pending && !failed && (
              <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] p-3">
                <button
                  type="button"
                  onClick={share}
                  className="flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  <ShareIcon className="h-3.5 w-3.5" />
                  Share
                </button>
                <a
                  href={asset.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  Download
                </a>
                <Link
                  href="/studio/library"
                  className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Library
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
