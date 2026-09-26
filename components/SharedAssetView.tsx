"use client";

/**
 * DashyCore v7 — public Share Hub viewer chrome.
 *
 * Renders a shared Studio image outside the authenticated app shell (no
 * sidebar, no auth guard — same pattern as /d-code/share/[share_slug]).
 * When the server couldn't resolve the slug (e.g. it's a local-only share
 * created before the `shared_assets` table existed), we do one more lookup
 * client-side against this browser's localStorage fallback so the link the
 * user just copied still works.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getLocalShare, type SharedAsset } from "@/lib/share";
import { CodeIcon, GlobeIcon, ImageIcon, LoaderIcon } from "@/components/icons";

export function SharedAssetView({
  slug,
  initialAsset,
}: {
  slug: string;
  initialAsset: SharedAsset | null;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "missing";
    asset: SharedAsset | null;
  }>(
    initialAsset
      ? { status: "ready", asset: initialAsset }
      : { status: "loading", asset: null }
  );

  useEffect(() => {
    if (initialAsset) return;
    const local = getLocalShare(slug);
    setState(local ? { status: "ready", asset: local } : { status: "missing", asset: null });
  }, [initialAsset, slug]);

  return (
    <div className="flex min-h-screen flex-col bg-navy">
      <header className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-white/[0.06] bg-navy/85 px-5 backdrop-blur-2xl">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/icon-512.png"
            alt="DashyCore logo"
            width={28}
            height={28}
            className="rounded-lg object-contain"
          />
          <span className="text-base font-semibold tracking-[-0.03em] text-white">
            DashyCore
          </span>
        </Link>
        <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Studio
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300">
            <GlobeIcon className="h-3 w-3" />
            Public share
          </span>
          <Link
            href="/studio"
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
          >
            <CodeIcon className="h-3 w-3" />
            Open DashyCore
          </Link>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
        {state.status === "loading" ? (
          <div className="flex items-center gap-2 text-zinc-500">
            <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
            <span className="text-sm">Loading shared image…</span>
          </div>
        ) : state.status === "missing" || !state.asset ? (
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10">
                <ImageIcon className="h-5 w-5 text-cyan-400" />
              </div>
              <p className="mt-4 text-base font-medium text-zinc-100">
                This link is private or no longer exists
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                The image may have been made private or removed by its owner.
              </p>
              <Link
                href="/"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
              >
                Visit DashyCore
              </Link>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-xl">
            <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/20 shadow-2xl shadow-black/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.asset.imageUrl}
                alt={state.asset.title}
                className="w-full object-contain"
              />
              <div className="p-5">
                <p className="text-base font-medium text-zinc-100">{state.asset.title}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Generated with Dashy Studio · shared publicly
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
