"use client";

/**
 * DashyCore v7 — Studio Share Hub modal.
 *
 * Opens right after an image is shared: shows the OpenGraph-style preview
 * card, the public link (already copied to the clipboard), one-tap social
 * exports (X · WhatsApp · Meta) and a public/private toggle backed by the
 * Supabase `shared_assets` row.
 */

import { useCallback, useEffect, useState } from "react";
import { setSharePublic, shareUrlFor, type SharedAsset } from "@/lib/shared-assets";
import { unproxiedImageUrl } from "@/lib/media-library";
import {
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  XIcon,
} from "@/components/icons";

export interface ShareHubState {
  asset: SharedAsset;
  /** False when the DB row could not be written (local-only link). */
  persisted: boolean;
  reason?: string;
}

interface ShareHubModalProps {
  state: ShareHubState | null;
  onClose: () => void;
  onVisibilityChange?: (slug: string, isPublic: boolean) => void;
}

export function ShareHubModal({
  state,
  onClose,
  onVisibilityChange,
}: ShareHubModalProps) {
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state) {
      setIsPublic(state.asset.isPublic);
      setCopied(false);
    }
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  const shareUrl = state ? shareUrlFor(state.asset.slug) : "";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [shareUrl]);

  const handleToggle = useCallback(async () => {
    if (!state) return;
    const next = !isPublic;
    setIsPublic(next);
    setSaving(true);
    const ok = await setSharePublic(state.asset.slug, next);
    setSaving(false);
    if (!ok) {
      // Keep the optimistic UI honest when the row isn't in the DB.
      setIsPublic(state.persisted ? isPublic : next);
    }
    onVisibilityChange?.(state.asset.slug, next);
  }, [isPublic, onVisibilityChange, state]);

  if (!state) return null;

  const { asset } = state;
  const previewSrc = unproxiedImageUrl(asset.imageUrl);
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(
    `${asset.title} — made with Dashy Studio`
  );

  const socials = [
    {
      id: "x",
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      className: "hover:border-white/30 hover:bg-white/[0.08]",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      className: "hover:border-emerald-400/40 hover:bg-emerald-500/10",
    },
    {
      id: "meta",
      label: "Meta",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      className: "hover:border-blue-400/40 hover:bg-blue-500/10",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Share hub"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1020]/95 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Share Hub</h2>
            <p className="text-xs text-zinc-500">
              {state.persisted
                ? "Link is live and database-backed."
                : "Link generated locally — sign in or run the shared_assets migration to publish."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share hub"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* OpenGraph preview card */}
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt={asset.title}
              className="h-48 w-full object-cover"
              loading="lazy"
            />
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-400/80">
                dashy-core.vercel.app
              </p>
              <p className="mt-1 truncate text-sm font-medium text-zinc-100">
                {asset.title}
              </p>
              <p className="text-xs text-zinc-500">
                Generated in Dashy Studio · public preview card
              </p>
            </div>
          </div>

          {/* Link row */}
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <LinkIcon className="h-4 w-4 flex-shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
              {shareUrl}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-2.5 py-1.5 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
            >
              {copied ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                <CopyIcon className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {/* Social exports */}
          <div className="grid grid-cols-3 gap-2">
            {socials.map((social) => (
              <a
                key={social.id}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-center text-xs font-medium text-zinc-200 transition-colors ${social.className}`}
              >
                {social.label}
              </a>
            ))}
          </div>

          {/* Public / private toggle */}
          <button
            type="button"
            onClick={() => void handleToggle()}
            disabled={saving}
            className="flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-60"
          >
            <span className="flex items-center gap-2.5">
              {isPublic ? (
                <GlobeIcon className="h-4 w-4 text-cyan-400" />
              ) : (
                <LockIcon className="h-4 w-4 text-zinc-400" />
              )}
              <span>
                <span className="block text-sm text-zinc-100">
                  {isPublic ? "Public link" : "Private"}
                </span>
                <span className="block text-xs text-zinc-500">
                  {isPublic
                    ? "Anyone with the link can view this image."
                    : "Only you can open this asset."}
                </span>
              </span>
            </span>
            <span
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                isPublic ? "bg-cyan-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  isPublic ? "left-[22px]" : "left-0.5"
                }`}
              />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
