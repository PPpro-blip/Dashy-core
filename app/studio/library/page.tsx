"use client";

/**
 * Dashy Studio — Library tab (/studio/library).
 *
 * The full media gallery for this device's `dashy.media.library` store:
 * every ready asset with its ORIGINAL prompt and generation timestamp,
 * open/view, download, delete, and a Share action that opens THE canonical
 * Share Hub (/share) with that exact asset pre-selected. Failed tiles can
 * be cleared here; retrying happens on the Generate tab where the
 * generation pipeline lives.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  downloadTileImage,
  loadLibrary,
  saveLibrary,
  type Tile,
} from "@/lib/studio-tiles";
import { STUDIO_MEDIA_UPDATED_EVENT } from "@/lib/studio";
import { copyText } from "@/lib/clipboard";
import { StudioTabs } from "@/components/studio/StudioTabs";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  ShareIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StudioLibraryPage() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** Two-step delete confirm. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = useCallback(() => setTiles(loadLibrary()), []);

  useEffect(() => {
    refresh();
    setHydrated(true);
    window.addEventListener(STUDIO_MEDIA_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(STUDIO_MEDIA_UPDATED_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!confirmingId) return;
    const timer = window.setTimeout(() => setConfirmingId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingId]);

  const handleDelete = (tile: Tile) => {
    if (confirmingId !== tile.id) {
      setConfirmingId(tile.id);
      return;
    }
    setConfirmingId(null);
    const next = tiles.filter((item) => item.id !== tile.id);
    setTiles(next);
    saveLibrary(next);
  };

  const handleClearFailed = () => {
    const next = tiles.filter((tile) => tile.status !== "error");
    setTiles(next);
    saveLibrary(next);
  };

  const copyPrompt = (id: string, text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const ready = tiles.filter((tile) => tile.status === "ready" && tile.url);
  const failedCount = tiles.filter((tile) => tile.status === "error").length;

  return (
    <div className="min-h-full bg-[#080b14] px-4 py-5 text-white sm:px-6 sm:py-6 md:px-12 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-4 sm:pb-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-300">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
                Dashy Studio
              </p>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
              Media Library
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-400">
              Every finished render on this device, with its original prompt and
              generation time. Share opens the Share Hub with that image
              pre-selected.
            </p>
          </div>
          {failedCount > 0 && (
            <button
              type="button"
              onClick={handleClearFailed}
              className="flex items-center gap-1.5 rounded-xl border border-red-400/25 bg-red-500/[0.08] px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/[0.15]"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Clear {failedCount} failed
            </button>
          )}
        </header>

        <div className="mt-4">
          <StudioTabs />
        </div>

        {!hydrated ? null : ready.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.015] py-12 text-center sm:py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-zinc-600">
              <ImageIcon className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-300">Your library is empty</h2>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">
              Finished renders land here automatically. Generate your first image
              to start the collection.
            </p>
            <Link
              href="/studio"
              className="mt-6 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-3 text-sm font-bold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-400/30 hover:brightness-105"
            >
              <SparklesIcon className="h-4 w-4" />
              Open Generate
            </Link>
          </div>
        ) : (
          <section className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ready.map((tile) => (
              <article
                key={tile.id}
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] shadow-xl shadow-black/30 transition-all hover:border-cyan-400/30 hover:bg-white/[0.04]"
              >
                <div
                  className="relative w-full overflow-hidden bg-[#0a0e1c]"
                  style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tile.url}
                    alt={tile.prompt}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/share?sourceType=studio_asset&sourceId=${encodeURIComponent(tile.id)}`}
                        title="Share image"
                        aria-label={`Share image: ${tile.prompt.slice(0, 60)}`}
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-violet-500"
                      >
                        <ShareIcon className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => window.open(tile.url, "_blank", "noopener,noreferrer")}
                        title="Open full resolution"
                        aria-label="Open full resolution"
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-cyan-500 hover:text-black"
                      >
                        <ArrowUpRightIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadTileImage(tile.url!, tile.prompt)}
                        title="Download image"
                        aria-label="Download image"
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/60 text-white backdrop-blur-md transition hover:bg-cyan-500 hover:text-black"
                      >
                        <DownloadIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tile)}
                        title={confirmingId === tile.id ? "Click again to delete" : "Delete from library"}
                        aria-label={
                          confirmingId === tile.id
                            ? "Click again to confirm delete"
                            : "Delete from library"
                        }
                        className={`flex h-8 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold backdrop-blur-md transition ${
                          confirmingId === tile.id
                            ? "bg-red-500 text-white"
                            : "w-8 bg-black/60 text-white hover:bg-red-500"
                        }`}
                      >
                        <TrashIcon className="h-4 w-4" />
                        {confirmingId === tile.id && "Sure?"}
                      </button>
                    </div>
                    <span className="self-start rounded-lg bg-black/60 px-2 py-1 text-[10px] font-medium text-cyan-300 backdrop-blur-md">
                      {tile.viaProxy ? "Proxied HD" : "Turbo Direct"}
                    </span>
                  </div>
                </div>

                {/* Prompt + timestamp footer — the original generation record. */}
                <div className="flex items-start justify-between gap-2 border-t border-white/[0.06] bg-black/20 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-zinc-300" title={tile.prompt}>
                      {tile.prompt}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Generated {formatTimestamp(tile.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyPrompt(tile.id, tile.prompt)}
                    title="Copy prompt"
                    aria-label="Copy prompt"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
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
