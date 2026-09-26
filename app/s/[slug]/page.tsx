"use client";

/**
 * DashyCore v7 — /s/[slug] (public Studio share page).
 *
 * Anonymous-friendly: reads the `shared_assets` row by slug through the
 * browser client (RLS allows it while is_public = true). Missing row, missing
 * table, or a network failure all render the same calm "not available" state
 * — never an error box.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { getSharedAsset, type SharedAsset } from "@/lib/shared-assets";
import { unproxiedImageUrl } from "@/lib/media-library";
import { GlobeIcon, LoaderIcon } from "@/components/icons";

export default function SharedAssetPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [asset, setAsset] = useState<SharedAsset | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const found = await getSharedAsset(slug);
      if (cancelled) return;
      setAsset(found);
      setStatus(found ? "ready" : "missing");
    }
    if (slug) void load();
    else setStatus("missing");
    return () => {
      cancelled = true;
    };
  }, [slug]);

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
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">
          <GlobeIcon className="h-3.5 w-3.5" />
          Public share
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {status === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-500">
            <LoaderIcon className="h-4 w-4 animate-spin" />
            Loading shared image…
          </div>
        ) : status === "missing" || !asset ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
            <p className="text-base font-medium text-zinc-100">
              This share link isn&apos;t available
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              It may have been made private or removed by its owner.
            </p>
            <Link
              href="/studio"
              className="mt-6 inline-flex rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
            >
              Open Dashy Studio
            </Link>
          </div>
        ) : (
          <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={unproxiedImageUrl(asset.imageUrl)}
              alt={asset.title}
              className="w-full object-contain"
            />
            <div className="px-5 py-4">
              <h1 className="text-lg font-semibold text-white">{asset.title}</h1>
              <p className="mt-1 text-xs text-zinc-500">
                Generated in Dashy Studio
              </p>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
