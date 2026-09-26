"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getPublicStudioShare, type SharedStudioAsset } from "@/lib/studio";
import { ImageIcon, LoaderIcon, SparklesIcon } from "@/components/icons";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; asset: SharedStudioAsset }
  | { status: "missing" };

function sharedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Public, database-backed Studio image viewer. No auth shell is mounted here. */
export default function StudioSharePage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const asset = await getPublicStudioShare(slug);
        if (!cancelled) setState(asset ? { status: "ready", asset } : { status: "missing" });
      } catch {
        if (!cancelled) setState({ status: "missing" });
      }
    }
    if (slug) void load();
    else setState({ status: "missing" });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <main className="min-h-screen bg-navy px-5 py-6 sm:px-8">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/icon-512.png" alt="DashyCore logo" width={30} height={30} className="rounded-lg" priority />
          <span className="font-semibold tracking-tight text-white">DashyCore</span>
        </Link>
        <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200"><SparklesIcon className="h-3.5 w-3.5" />Studio share</span>
      </header>

      {state.status === "loading" ? (
        <div className="flex min-h-[70vh] items-center justify-center gap-2 text-sm text-zinc-500"><LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />Loading shared image…</div>
      ) : state.status === "missing" ? (
        <section className="mx-auto mt-20 max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10"><ImageIcon className="h-5 w-5 text-cyan-300" /></div>
          <h1 className="mt-4 text-lg font-semibold text-zinc-100">This Studio share is unavailable</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">The link may be incorrect, private, or the owner may have removed it.</p>
          <Link href="/" className="mt-6 inline-flex rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] hover:bg-cyan-400">Visit DashyCore</Link>
        </section>
      ) : (
        <article className="mx-auto mt-8 grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/30 shadow-2xl shadow-black/25">
            <img src={state.asset.imageUrl} alt={state.asset.prompt || state.asset.title} className="h-auto w-full object-contain" />
          </div>
          <aside className="h-fit rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Generated in Dashy Studio</p>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-100">{state.asset.title}</h1>
            {state.asset.prompt && <><h2 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Prompt</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{state.asset.prompt}</p></>}
            <p className="mt-6 border-t border-white/[0.06] pt-4 text-xs text-zinc-600">Shared {sharedDate(state.asset.createdAt)}</p>
          </aside>
        </article>
      )}
    </main>
  );
}
