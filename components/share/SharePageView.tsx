"use client";

/**
 * DashyCore v7 — public read-only share viewer (client).
 *
 * Rendered by the (server) share page. Resolves the share key — EITHER the
 * project uuid OR its 12-char share slug — through lib/dcode; visibility is
 * decided by RLS (anon sees only is_public = true rows, the owner always
 * sees their own row). That asymmetry is intentional: the OWNER must get the
 * full Share Hub even for a private project (composers, copy, QR, device
 * share, make public/private), while visitors keep seeing the
 * "private / no longer exists" empty state.
 *
 * This page is also the custom Dashy Share Hub: when a project is loaded it
 * opens the ShareHub modal with copy-link, QR, "Share via device" (the only
 * place that intentionally calls navigator.share) and the per-app composer
 * grid. Closing the modal leaves the read-only D-Code workspace available.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  getPublicProject,
  toggleProjectPublic,
  type DCodeProject,
} from "@/lib/dcode";
import { createClient } from "@/lib/supabase/client";
import { DCodeWorkspace } from "@/components/dcode/DCodeWorkspace";
import { ShareHub } from "@/components/share/ShareHub";
import { useToast } from "@/components/Toast";
import { CodeIcon, GlobeIcon, LoaderIcon, ShareIcon } from "@/components/icons";

interface LoadState {
  status: "loading" | "ready" | "missing";
  project: DCodeProject | null;
}

export function SharePageView() {
  const params = useParams<{ share_slug: string }>();
  const router = useRouter();
  const toast = useToast();
  const shareRef = typeof params.share_slug === "string" ? params.share_slug : "";
  const [state, setState] = useState<LoadState>({
    status: "loading",
    project: null,
  });
  const [hubOpen, setHubOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [updatingShare, setUpdatingShare] = useState(false);
  // Session user id (UI affordance only — RLS still enforces everything).
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setViewerId(data.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setViewerId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A project the viewer loaded under RLS while not public can only be
  // reached by its owner (the public policy hides private rows from
  // everyone else), so this is the authoritative-enough ownership signal
  // for showing owner-only chrome.
  const isOwner =
    !!state.project && !!viewerId && state.project.userId === viewerId;

  // Canonical permalink for copy/QR/composers: stable slug when one exists,
  // otherwise the project uuid — the loader resolves either key, and the
  // toolbar copy/link builders must use this same shareKey.
  useEffect(() => {
    if (!state.project || typeof window === "undefined") return;
    const shareKey = state.project.shareSlug ?? state.project.id;
    setShareUrl(`${window.location.origin}/d-code/share/${shareKey}`);
  }, [state.project]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const project = await getPublicProject(shareRef);
        if (cancelled) return;
        setState(
          project ? { status: "ready", project } : { status: "missing", project: null }
        );
      } catch {
        if (!cancelled) setState({ status: "missing", project: null });
      }
    }
    if (shareRef) void load();
    return () => {
      cancelled = true;
    };
  }, [shareRef]);

  // The toolbar routes with the project id and `?open=1`; redirect to the
  // canonical share-slug URL so OG previews, image serving and shared links
  // always resolve to the same permalink.
  useEffect(() => {
    if (
      state.status === "ready" &&
      state.project?.shareSlug &&
      shareRef.toLowerCase() !== state.project.shareSlug
    ) {
      const search = typeof window === "undefined" ? "" : window.location.search;
      router.replace(`/d-code/share/${state.project.shareSlug}${search}`);
    }
  }, [router, shareRef, state.project?.shareSlug, state.status]);

  // Auto-open the Share Hub when the toolbar asked for it (`/…?open=1`).
  useEffect(() => {
    if (
      state.status === "ready" &&
      state.project &&
      typeof window !== "undefined" &&
      window.location.search.includes("open=1")
    ) {
      setHubOpen(true);
    }
  }, [state]);

  /** Owner-only: flip is_public, refetch the row and keep UI state == DB. */
  const handleTogglePublic = useCallback(
    async (next: boolean) => {
      if (!state.project || updatingShare) return;
      setUpdatingShare(true);
      try {
        // Awaits the write (slug assignment/reuse) before we trust the link.
        const updated = await toggleProjectPublic(state.project.id, next);
        setState({ status: "ready", project: updated });
        if (next && updated.shareSlug) {
          router.replace(
            `/d-code/share/${updated.shareSlug}${
              typeof window === "undefined" ? "" : window.location.search
            }`
          );
        }
        toast.show(
          next
            ? {
                type: "success",
                title: "Project is public",
                message: "The share link now works for everyone.",
              }
            : {
                type: "info",
                title: "Project is private",
                message:
                  "Visitors can no longer open the link. Your Share Hub stays available.",
              }
        );
      } catch (error) {
        toast.show({
          type: "error",
          title: "Could not update sharing",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setUpdatingShare(false);
      }
    },
    [router, state.project, toast, updatingShare]
  );

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
          {state.project && (
            <button
              type="button"
              onClick={() => setHubOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
            >
              <ShareIcon className="h-3 w-3" />
              Open Share Hub
            </button>
          )}
          <span className="flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300">
            <GlobeIcon className="h-3 w-3" />
            {state.project && !state.project.isPublic
              ? "Private (owner view)"
              : "Public share"}
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
          <DCodeWorkspace project={state.project} readOnly />
        )}
      </main>

      {hubOpen && state.project && (
        <ShareHub
          project={{
            id: state.project.id,
            title: state.project.title,
            files: state.project.files,
          }}
          shareUrl={shareUrl}
          privacy={
            isOwner
              ? {
                  isPublic: state.project.isPublic,
                  busy: updatingShare,
                  onToggle: (next) => void handleTogglePublic(next),
                }
              : undefined
          }
          onClose={() => setHubOpen(false)}
        />
      )}
    </div>
  );
}
