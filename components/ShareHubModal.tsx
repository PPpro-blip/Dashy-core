"use client";

/**
 * DashyCore v7 — Studio Share Hub modal.
 *
 * Opens right after a Studio card is shared: OpenGraph-style preview card,
 * copy-link, public/private toggle and one-tap social export (X, WhatsApp,
 * Meta/Facebook). The link always works — see lib/share.ts for the
 * Supabase-first / local-fallback strategy that guarantees this modal never
 * opens onto a broken state.
 */

import { useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  FacebookIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  TwitterXIcon,
  WhatsAppIcon,
  XIcon,
} from "@/components/icons";

export interface ShareHubModalProps {
  open: boolean;
  onClose: () => void;
  imageUrl: string;
  title: string;
  shareUrl: string;
  persisted: boolean;
  isPublic: boolean;
  onTogglePublic: (next: boolean) => void;
}

export function ShareHubModal({
  open,
  onClose,
  imageUrl,
  title,
  shareUrl,
  persisted,
  isPublic,
  onTogglePublic,
}: ShareHubModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const domain = (() => {
    try {
      return new URL(shareUrl).host;
    } catch {
      return "dashy-core.vercel.app";
    }
  })();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the link is still visible/selectable in the input.
    }
  };

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);

  const socialLinks = [
    {
      label: "X",
      Icon: TwitterXIcon,
      href: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
    },
    {
      label: "WhatsApp",
      Icon: WhatsAppIcon,
      href: `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
    },
    {
      label: "Meta",
      Icon: FacebookIcon,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0d1020] shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <GlobeIcon className="h-4 w-4 text-cyan-400" />
            Share Hub
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share hub"
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* OpenGraph-style preview card */}
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={title}
              loading="lazy"
              className="h-44 w-full object-cover"
            />
            <div className="p-3">
              <p className="truncate text-sm font-medium text-zinc-100">{title}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                {domain}
              </p>
            </div>
          </div>

          {/* Link + copy */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Public link
            </p>
            <div className="flex items-center gap-2">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3">
                <LinkIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link"
                  className="w-full truncate bg-transparent text-xs text-zinc-300 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleCopy()}
                title={copied ? "Copied!" : "Copy link"}
                aria-label="Copy share link"
                className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
              >
                {copied ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {!persisted && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/80">
                <LockIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                Saved in this browser for now — it will sync to the cloud
                automatically once the share database is ready. The link
                already works.
              </p>
            )}
          </div>

          {/* Public / private toggle */}
          <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <div>
              <p className="text-xs font-medium text-zinc-200">
                {isPublic ? "Public" : "Private"}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {isPublic
                  ? "Anyone with the link can view this."
                  : "Only you can view this."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onTogglePublic(!isPublic)}
              aria-label={isPublic ? "Make private" : "Make public"}
              title={isPublic ? "Make private" : "Make public"}
              className={`transition-colors ${isPublic ? "text-cyan-400" : "text-zinc-600"}`}
            >
              {isPublic ? (
                <ToggleRightIcon className="h-7 w-7" />
              ) : (
                <ToggleLeftIcon className="h-7 w-7" />
              )}
            </button>
          </div>

          {/* Social export */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Share to
            </p>
            <div className="grid grid-cols-3 gap-2">
              {socialLinks.map(({ label, Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 text-[11px] font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
