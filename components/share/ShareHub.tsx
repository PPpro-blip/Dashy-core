"use client";

/**
 * DashyCore v7 — ShareHub
 *
 * The main share surface (modal sheet on desktop, full-screen friendly on
 * mobile). It shows a live preview card, copy-link, QR code, the OS
 * "Share via device" action and the per-app grid. Tapping an app opens its
 * ShareComposer instead of firing a raw intent immediately.
 */

import { useEffect, useMemo, useState } from "react";
import type { DCodeFile } from "@/lib/dcode";
import {
  collectProjectImages,
  makeDefaultDraft,
  SHARE_APPS,
  SHARE_APP_MAP,
  type ShareAppId,
  type ShareDraft,
} from "@/lib/share-intents";
import { copyText } from "@/lib/clipboard";
import { ShareComposer } from "@/components/share/ShareComposer";
import { ShareQr } from "@/components/share/ShareQr";
import { useToast } from "@/components/Toast";
import {
  CopyIcon,
  GlobeIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  ShareIcon,
  XIcon,
} from "@/components/icons";

/**
 * Owner-only privacy controls surfaced inside the Hub. Omitted for plain
 * visitors (they must never see make public/private) — when absent the Hub
 * renders exactly as before.
 */
export interface ShareHubPrivacy {
  isPublic: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}

interface ShareHubProps {
  onClose: () => void;
  project: { id: string; title: string; files: DCodeFile[] } | null;
  shareUrl: string | null;
  privacy?: ShareHubPrivacy;
}

export function ShareHub({ onClose, project, shareUrl, privacy }: ShareHubProps) {
  const toast = useToast();
  const [selectedApp, setSelectedApp] = useState<ShareAppId | null>(null);
  const [copying, setCopying] = useState(false);
  const [deviceSharing, setDeviceSharing] = useState(false);

  const imageOptions = useMemo(
    () => collectProjectImages(project?.files ?? []),
    [project?.files]
  );

  // The hub remounts on each open (conditional render in the workspace), so
  // this initializer gives us fresh smart defaults every time it opens.
  const [draft, setDraft] = useState<ShareDraft>(() =>
    makeDefaultDraft(
      project?.title ?? "Untitled project",
      shareUrl ?? "",
      imageOptions
    )
  );

  // Keep the composer's permalink in sync with the canonical share URL —
  // e.g. the owner hits "Make public" while the hub is open and the freshly
  // assigned slug must flow into copy/QR/intents immediately.
  useEffect(() => {
    if (!shareUrl) return;
    setDraft((current) =>
      current.url === shareUrl ? current : { ...current, url: shareUrl }
    );
  }, [shareUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (selectedApp) {
    return (
      <ShareComposer
        app={SHARE_APP_MAP[selectedApp]}
        draft={draft}
        onChange={setDraft}
        imageOptions={imageOptions}
        onBack={() => setSelectedApp(null)}
        onClose={onClose}
      />
    );
  }

  const url = draft.url;

  const handleCopyLink = async () => {
    setCopying(true);
    try {
      const ok = await copyText(url);
      const message = ok
        ? privacy && !privacy.isPublic
          ? "The project is private — visitors will see the private notice until you make it public."
          : "Anyone with the link can view this project."
        : "Please copy manually.";
      toast.show({
        type: ok ? "success" : "error",
        title: ok ? "Link copied" : "Copy failed",
        message,
      });
    } finally {
      setCopying(false);
    }
  };

  const handleDeviceShare = async () => {
    if (typeof navigator === "undefined" || !navigator.share) {
      toast.show({
        type: "info",
        title: "Device share not available",
        message: "Copy the link or pick an app from the grid instead.",
      });
      return;
    }
    setDeviceSharing(true);
    try {
      await navigator.share({
        title: draft.title,
        text: draft.caption,
        url,
      });
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        toast.show({
          type: "error",
          title: "Device share failed",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      }
    } finally {
      setDeviceSharing(false);
    }
  };

  return (
    <>
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close share hub"
        className="fixed inset-0 z-[70] cursor-default bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share this project"
        className="fixed left-1/2 top-1/2 z-[80] flex max-h-[92vh] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1220] shadow-2xl shadow-black/80"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
            <ShareIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white">Share this project</h2>
            <p className="truncate text-[11px] text-zinc-500">{project?.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Preview card */}
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-stretch gap-3">
              <div className="relative w-24 flex-shrink-0 bg-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.imageDataUrl ?? "/icon-512.png"}
                  alt="Share preview"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1 py-3 pr-3">
                <p className="truncate text-sm font-semibold text-white">
                  {draft.title}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                  {draft.caption || "Built with DashyCore D-Code ⚡"}
                </p>
                <p className="mt-2 flex items-center gap-1 truncate font-mono text-[10px] text-zinc-600">
                  <GlobeIcon className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{url}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Owner privacy controls — hidden for plain visitors, who never
              see this prop at all. A private project still renders the full
              hub for its owner; this row is how they publish/revoke. */}
          {privacy && (
            <div
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${
                privacy.isPublic
                  ? "border-cyan-400/20 bg-cyan-400/[0.06]"
                  : "border-amber-400/25 bg-amber-400/[0.07]"
              }`}
            >
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                  privacy.isPublic
                    ? "bg-cyan-400/15 text-cyan-300"
                    : "bg-amber-400/15 text-amber-300"
                }`}
              >
                {privacy.isPublic ? (
                  <GlobeIcon className="h-3.5 w-3.5" />
                ) : (
                  <LockIcon className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-zinc-100">
                  {privacy.isPublic
                    ? "Public — anyone with the link can view"
                    : "Private — only you can open this link"}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {privacy.isPublic
                    ? "Making it private revokes visitor access instantly; your Share Hub keeps working."
                    : "Everyone else sees “link is private”. Make it public to activate this link."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => privacy.onToggle(!privacy.isPublic)}
                disabled={privacy.busy}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
                  privacy.isPublic
                    ? "border border-white/[0.1] bg-white/[0.03] text-zinc-300 hover:border-zinc-600 hover:text-white"
                    : "bg-cyan-500 text-[#06202a] shadow-lg shadow-cyan-500/20 hover:bg-cyan-400"
                }`}
              >
                {privacy.busy ? (
                  <LoaderIcon className="h-3 w-3 animate-spin" />
                ) : privacy.isPublic ? (
                  <LockIcon className="h-3 w-3" />
                ) : (
                  <GlobeIcon className="h-3 w-3" />
                )}
                {privacy.isPublic ? "Make private" : "Make public"}
              </button>
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              disabled={!url}
              className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-40"
            >
              {copying ? (
                <LoaderIcon className="h-4 w-4 animate-spin" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
              <span className="text-[11px] font-medium">Copy link</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDeviceShare()}
              disabled={deviceSharing}
              className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-40"
            >
              {deviceSharing ? (
                <LoaderIcon className="h-4 w-4 animate-spin" />
              ) : (
                <ShareIcon className="h-4 w-4" />
              )}
              <span className="text-[11px] font-medium">Share via device</span>
            </button>
          </div>

          {/* QR code */}
          <div className="flex flex-col items-center rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <ShareQr value={url} />
            <p className="mt-2 text-[11px] text-zinc-500">
              Scan to open this public project
            </p>
          </div>

          {/* App grid — each tile opens that app's composer. */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Share to…
            </p>
            <div className="grid grid-cols-3 gap-2">
              {SHARE_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedApp(app.id)}
                  className="group flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 transition-all hover:border-cyan-400/40 hover:bg-white/[0.05]"
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{
                      backgroundColor: `${app.badge}33`,
                      color: app.accent,
                      boxShadow: `0 0 0 1px ${app.accent}55`,
                    }}
                  >
                    {app.name.charAt(0)}
                  </span>
                  <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white">
                    {app.name}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
              <LinkIcon className="h-3.5 w-3.5" />
              Tapping an app opens a composer to refine title, caption & image first.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
