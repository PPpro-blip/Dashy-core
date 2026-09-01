"use client";

/**
 * DashyCore v7 — /d-code/share/[share_slug] (public read-only viewer).
 *
 * Serves shared D-Code projects to ANYONE (no session): the browser client
 * fetches by share_slug and Supabase RLS allows the read because the row
 * is is_public = true. Deliberately outside the authenticated route group
 * — no sidebar, no auth guard — with its own minimal public chrome.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { getProjectByShareSlug, type DCodeProject } from "@/lib/dcode";
import { ShareHub } from "@/components/share/ShareHub";
import { CodeIcon, GlobeIcon, LoaderIcon } from "@/components/icons";

interface LoadState {
  status: "loading" | "ready" | "missing";
  project: DCodeProject | null;
}

export default function DCodeSharePage() {
  const params = useParams<{ share_slug: string }>();
  const shareSlug = typeof params.share_slug === "string" ? params.share_slug : "";
  const [state, setState] = useState<LoadState>({
    status: "loading",
    project: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const project = await getProjectByShareSlug(shareSlug);
        if (cancelled) return;
        setState(
          project ? { status: "ready", project } : { status: "missing", project: null }
        );
      } catch {
        if (!cancelled) setState({ status: "missing", project: null });
      }
    }
    if (shareSlug) void load();
    return () => {
      cancelled = true;
    };
  }, [shareSlug]);

  return (
    <div className="flex min-h-screen flex-col bg-navy">
      {/* Minimal public chrome — same 4rem height the workspace expects. */}
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
          D-Code
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300">
            <GlobeIcon className="h-3 w-3" />
            Public share
          </span>
          <Link
            href="/chat"
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
          >
            <CodeIcon className="h-3 w-3" />
            Open DashyCore
          </Link>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {state.status === "loading" ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-zinc-500">
            <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
            <span className="text-sm">Loading shared project…</span>
          </div>
        ) : state.status === "missing" || !state.project ? (
          <div className="mx-auto w-full max-w-md px-6 py-16">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10">
                <CodeIcon className="h-5 w-5 text-cyan-400" />
              </div>
              <p className="mt-4 text-base font-medium text-zinc-100">
                This link is private or no longer exists
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                The project may have been made private or deleted by its owner.
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
          <ShareHub
            title={state.project.title}
            description={state.project.description}
            url={`${typeof window !== "undefined" ? window.location.origin : ""}/d-code/share/${state.project.shareSlug ?? shareSlug}`}
            fileCount={state.project.files.length}
          />
        )}
      </main>
    </div>
  );
}
