"use client";

/**
 * DashyCore v7 — Studio · Library.
 *
 * Every image generated in Studio (and every image generated from the chat
 * IMG button) lands here. Storage is the browser's localStorage: this
 * repository has no server-side asset store, and inventing one was out of
 * scope for this pass — so the library is explicitly labelled as
 * device-local.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { useShareHub } from "@/components/share/ShareHubProvider";
import { StudioTabs } from "@/components/studio/StudioTabs";
import {
  deleteStudioAsset,
  listStudioAssets,
  STUDIO_ASSETS_EVENT,
  type StudioAsset,
} from "@/lib/studio";
import {
  DownloadIcon,
  EyeIcon,
  ImageIcon,
  ShareIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function StudioLibraryPage() {
  const toast = useToast();
  const shareHub = useShareHub();
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [viewing, setViewing] = useState<StudioAsset | null>(null);

  const refresh = useCallback(() => setAssets(listStudioAssets()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(STUDIO_ASSETS_EVENT, refresh);
    return () => window.removeEventListener(STUDIO_ASSETS_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  const remove = useCallback(
    (asset: StudioAsset) => {
      deleteStudioAsset(asset.id);
      setViewing((v) => (v?.id === asset.id ? null : v));
      toast.info("Asset removed", "It is gone from this device's library.");
    },
    [toast]
  );

  const share = useCallback(
    (asset: StudioAsset) =>
      shareHub.open({
        kind: "studio-asset",
        id: asset.id,
        prompt: asset.prompt,
        imageUrl: asset.url,
        createdAt: asset.createdAt,
      }),
    [shareHub]
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Library
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Images you generated, stored on this device.
          </p>
        </div>
        <StudioTabs />
      </div>

      {assets.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-10 text-center sm:p-12">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
            <ImageIcon className="h-6 w-6 text-cyan-400" />
          </div>
          <p className="mt-4 text-base font-medium text-zinc-100">
            Nothing in your library yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
            Generate an image in Studio — or use the IMG button in chat — and
            it will be kept here.
          </p>
          <Link
            href="/studio"
            className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
          >
            <SparklesIcon className="h-4 w-4" />
            Generate an image
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-cyan-400/25"
            >
              <button
                type="button"
                onClick={() => setViewing(asset)}
                aria-label={`View asset: ${asset.prompt}`}
                className="relative block aspect-square w-full bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60"
              >
                <Image
                  src={asset.url}
                  alt={asset.prompt}
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <EyeIcon className="h-6 w-6 text-white" />
                </span>
              </button>

              <div className="flex min-w-0 flex-1 flex-col p-3">
                <p
                  className="line-clamp-2 text-xs leading-relaxed text-zinc-300"
                  title={asset.prompt}
                >
                  {asset.prompt || "Untitled generation"}
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  {asset.width}×{asset.height} · {formatWhen(asset.createdAt)}
                  {asset.origin === "chat" ? " · from chat" : ""}
                </p>

                <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                  <button
                    type="button"
                    onClick={() => share(asset)}
                    className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/10 px-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                  >
                    <ShareIcon className="h-3.5 w-3.5" />
                    Share
                  </button>
                  <a
                    href={asset.url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Download ${asset.prompt}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => remove(asset)}
                    aria-label={`Delete ${asset.prompt}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-zinc-600">
        Studio assets live in this browser only. Cross-device libraries and
        public asset URLs need a server-side storage layer, which DashyCore
        does not have yet.
      </p>

      {/* Lightbox */}
      {viewing && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close preview"
            onClick={() => setViewing(null)}
            className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={viewing.prompt}
            className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0e1c]"
          >
            <div className="flex items-start gap-3 border-b border-white/[0.06] p-3">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-300">
                {viewing.prompt}
              </p>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Close preview"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-zinc-400 transition-colors hover:text-zinc-100"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1 bg-black/40">
              <Image
                src={viewing.url}
                alt={viewing.prompt}
                width={viewing.width}
                height={viewing.height}
                unoptimized
                className="max-h-[70vh] w-full object-contain"
              />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] p-3">
              <button
                type="button"
                onClick={() => share(viewing)}
                className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
              >
                <ShareIcon className="h-3.5 w-3.5" />
                Share
              </button>
              <a
                href={viewing.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
