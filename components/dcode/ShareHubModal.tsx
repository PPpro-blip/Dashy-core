"use client";

/**
 * DashyCore — Share Hub modal (D-Code project sharing).
 *
 * Replaces the old "link copied" toast with a full sharing surface:
 *   - Visual link card (read-only input + Copy button)
 *   - Public / Private privacy toggle (updates the DB in real time)
 *   - Live social preview mimicking X / WhatsApp unfurls
 *   - One-tap share buttons: X, WhatsApp, LinkedIn
 *   - Owner management: regenerate slug / revoke link
 *
 * Rendered only for the project owner (the workspace never mounts it in
 * readOnly mode), so every action here is owner-authorized by construction.
 */

import { useEffect, useState } from "react";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  GlobeIcon,
  LinkedInIcon,
  LoaderIcon,
  LockIcon,
  RefreshIcon,
  TrashIcon,
  WhatsAppIcon,
  XIcon,
  XSocialIcon,
} from "@/components/icons";

export type HubBusyKind = "toggle" | "regenerate" | "revoke" | "opening" | null;

export interface ShareHubModalProps {
  title: string;
  description: string | null;
  isPublic: boolean;
  shareSlug: string | null;
  /** Absolute share URL, or null while the project has no slug. */
  shareUrl: string | null;
  busy: HubBusyKind;
  onTogglePublic: (next: boolean) => void;
  onRegenerate: () => void;
  onRevoke: () => void;
  onClose: () => void;
}

type PreviewTab = "x" | "whatsapp";

function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "dashycore.app";
  }
}

export function ShareHubModal({
  title,
  description,
  isPublic,
  shareSlug,
  shareUrl,
  busy,
  onTogglePublic,
  onRegenerate,
  onRevoke,
  onClose,
}: ShareHubModalProps) {
  const [copied, setCopied] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("x");
  /** Two-step confirm for the destructive revoke action. */
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const linkReady = isPublic && shareUrl !== null;
  const blurb = description?.trim() || "A D-Code project shared from DashyCore — open the link to browse the code.";

  /* Escape closes; revoke confirm auto-resets after 3s. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!confirmingRevoke) return;
    const timer = window.setTimeout(() => setConfirmingRevoke(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingRevoke]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the read-only input below is still selectable.
    }
  };

  const shareText = `${title} — built with DashyCore D-Code`;
  const xHref = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`
    : "#";
  const waHref = shareUrl
    ? `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`
    : "#";
  const liHref = shareUrl
    ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`
    : "#";

  const socialBtn =
    "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100";

  return (
    <>
      <button
        type="button"
        aria-label="Close share hub"
        className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share hub"
        className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0d1220] shadow-2xl shadow-black/80"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <GlobeIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-white">Share Hub</h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {title}
              {shareSlug ? (
                <span className="font-mono text-zinc-600"> · /{shareSlug}</span>
              ) : null}
            </p>
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

        <div className="space-y-5 px-5 py-5">
          {/* Privacy toggle */}
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                isPublic
                  ? "bg-cyan-500/10 text-cyan-300"
                  : "bg-white/[0.04] text-zinc-500"
              }`}
            >
              {isPublic ? <GlobeIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-100">
                {isPublic ? "Public — anyone with the link" : "Private — only you"}
              </p>
              <p className="text-[11px] text-zinc-500">
                {isPublic
                  ? "No login needed to view. Toggle off to unpublish."
                  : "Turn on Public to generate a shareable link."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              aria-label={isPublic ? "Make private" : "Make public"}
              disabled={busy !== null}
              onClick={() => onTogglePublic(!isPublic)}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                isPublic ? "bg-cyan-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all ${
                  isPublic ? "left-[22px]" : "left-0.5"
                }`}
              >
                {busy === "toggle" && (
                  <LoaderIcon className="h-3 w-3 animate-spin text-cyan-600" />
                )}
              </span>
            </button>
          </div>

          {/* Visual link card */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Share link</p>
            {linkReady && shareUrl ? (
              <div className="flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] p-1.5 pl-3.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-cyan-200">
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98] ${
                    copied
                      ? "bg-emerald-500 text-white"
                      : "bg-cyan-500 text-[#06202a] hover:bg-cyan-400"
                  }`}
                >
                  {copied ? (
                    <CheckIcon className="h-3.5 w-3.5" />
                  ) : (
                    <CopyIcon className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.10] bg-black/20 px-4 py-4 text-center">
                <LockIcon className="mx-auto h-4 w-4 text-zinc-600" />
                <p className="mt-2 text-xs text-zinc-500">
                  This project is private — no link exists yet.
                </p>
              </div>
            )}
          </div>

          {/* One-tap socials */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Share to</p>
            <div className="flex gap-2">
              <a
                href={xHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!linkReady}
                onClick={(e) => {
                  if (!linkReady) e.preventDefault();
                }}
                className={`${socialBtn} bg-black ring-1 ring-white/20 disabled:pointer-events-none`}
              >
                <XSocialIcon className="h-4 w-4" />X
              </a>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!linkReady}
                onClick={(e) => {
                  if (!linkReady) e.preventDefault();
                }}
                className={`${socialBtn} bg-[#25D366] disabled:pointer-events-none`}
              >
                <WhatsAppIcon className="h-4 w-4" />
                WhatsApp
              </a>
              <a
                href={liHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!linkReady}
                onClick={(e) => {
                  if (!linkReady) e.preventDefault();
                }}
                className={`${socialBtn} bg-[#0A66C2] disabled:pointer-events-none`}
              >
                <LinkedInIcon className="h-4 w-4" />
                LinkedIn
              </a>
            </div>
            {!linkReady && (
              <p className="mt-1.5 text-[11px] text-zinc-600">
                Make the project public to enable one-tap sharing.
              </p>
            )}
          </div>

          {/* Live social preview */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                <EyeIcon className="h-3.5 w-3.5 text-zinc-500" />
                Social preview
              </p>
              <div className="flex rounded-lg border border-white/[0.08] bg-black/30 p-0.5 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={() => setPreviewTab("x")}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    previewTab === "x"
                      ? "bg-white/[0.08] text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  X
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("whatsapp")}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    previewTab === "whatsapp"
                      ? "bg-white/[0.08] text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  WhatsApp
                </button>
              </div>
            </div>

            {previewTab === "x" ? (
              /* X summary-large-card mimic */
              <div className="overflow-hidden rounded-xl border border-white/[0.10] bg-black/40">
                <div className="flex h-28 items-center justify-center gap-2 bg-gradient-to-br from-cyan-500/15 via-[#0d1220] to-violet-500/15">
                  <CodeIcon className="h-7 w-7 text-cyan-400" />
                  <span className="font-mono text-xs text-zinc-500">D-Code · shared project</span>
                </div>
                <div className="border-t border-white/[0.06] px-3.5 py-2.5">
                  <p className="truncate text-[13px] font-semibold text-zinc-100">{title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">{blurb}</p>
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-zinc-600">
                    <GlobeIcon className="h-3 w-3" />
                    {shareUrl ? domainOf(shareUrl) : "dashycore.app"}
                  </p>
                </div>
              </div>
            ) : (
              /* WhatsApp link-preview bubble mimic */
              <div className="rounded-xl border border-white/[0.06] bg-[#0b141a] p-3">
                <div className="ml-auto max-w-full rounded-lg rounded-tr-none bg-[#005c4b] p-1.5">
                  <p className="px-1.5 pb-1 text-xs text-[#e7ffdb]">Check out my D-Code project 👇</p>
                  <div className="overflow-hidden rounded-md bg-[#111b21]">
                    <div className="flex gap-2.5 p-2">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-cyan-500/10">
                        <CodeIcon className="h-6 w-6 text-cyan-400" />
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="truncate text-xs font-semibold text-zinc-100">{title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">{blurb}</p>
                        <p className="mt-1 truncate text-[10px] text-zinc-500">
                          {shareUrl ? domainOf(shareUrl) : "dashycore.app"}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="truncate px-1.5 pb-0.5 pt-1 font-mono text-[10px] text-[#53bdeb]">
                    {shareUrl ?? "Make public to generate a link"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Owner management */}
          <div className="border-t border-white/[0.06] pt-4">
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Manage link</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy !== null || !isPublic}
                title="Generate a new link — the old one stops working"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "regenerate" ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshIcon className="h-3.5 w-3.5" />
                )}
                Regenerate slug
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmingRevoke) {
                    onRevoke();
                    setConfirmingRevoke(false);
                  } else {
                    setConfirmingRevoke(true);
                  }
                }}
                disabled={busy !== null || (!isPublic && !shareSlug)}
                title="Take the project private and permanently kill this link"
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  confirmingRevoke
                    ? "border-red-400/50 bg-red-500/15 text-red-200"
                    : "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-red-400/40 hover:text-red-300"
                }`}
              >
                {busy === "revoke" ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <TrashIcon className="h-3.5 w-3.5" />
                )}
                {confirmingRevoke ? "Click again to revoke" : "Revoke link"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
              Regenerating keeps the project public under a new link. Revoking makes it
              private and the current link can never work again.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
