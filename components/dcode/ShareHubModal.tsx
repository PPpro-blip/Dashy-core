"use client";

/**
 * DashyCore v7 — Share Hub Modal (replaces the bland share toast).
 *
 * A high-end sharing surface for D-Code projects:
 *   - Slug display: read-only input with the public URL
 *   - Glowing "Copy Link" button with a checkmark animation
 *   - "Public Access" privacy switch (OFF → the link shows the Private
 *     screen served by /d-code/share/[slug])
 *   - Social row: X (Twitter), WhatsApp, LinkedIn share intents
 *   - Live card preview of how the link unfurls on social media
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  LoaderIcon,
  LockIcon,
  XIcon,
} from "@/components/icons";

interface ShareHubModalProps {
  open: boolean;
  onClose: () => void;
  /** Full public URL (null while a slug is still being allocated). */
  shareUrl: string | null;
  /** Project title — used in the live social card preview. */
  title: string;
  isPublic: boolean;
  /** Toggling the switch calls this; the parent flips isPublic. */
  onTogglePublic: (next: boolean) => void | Promise<void>;
  /** True while the public/private toggle is persisting. */
  saving: boolean;
}

/* ------------------------------ social icons ----------------------------- */

const XTwitterGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const WhatsAppGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);

const LinkedInGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
  </svg>
);

/* --------------------------------- modal --------------------------------- */

export function ShareHubModal({
  open,
  onClose,
  shareUrl,
  title,
  isPublic,
  onTogglePublic,
  saving,
}: ShareHubModalProps) {
  const [copied, setCopied] = useState(false);

  /* Reset the checkmark whenever the modal opens or the URL changes. */
  useEffect(() => {
    if (open) setCopied(false);
  }, [open, shareUrl]);

  /* Escape closes. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Fallback for clipboard-restricted contexts.
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }, [shareUrl]);

  if (!open) return null;

  const encodedUrl = shareUrl ? encodeURIComponent(shareUrl) : "";
  const shareText = encodeURIComponent(
    `Check out "${title}" on DashyCore D-Code`
  );
  const metaDescription =
    "Interactive code project shared from DashyCore — open the link to browse every file in a live read-only workspace.";

  const socials = [
    {
      name: "X (Twitter)",
      href: `https://twitter.com/intent/tweet?text=${shareText}&url=${encodedUrl}`,
      Glyph: XTwitterGlyph,
      hover: "hover:border-zinc-400/60 hover:bg-white/[0.06] hover:text-white",
    },
    {
      name: "WhatsApp",
      href: `https://wa.me/?text=${shareText}%20${encodedUrl}`,
      Glyph: WhatsAppGlyph,
      hover:
        "hover:border-emerald-400/50 hover:bg-emerald-400/10 hover:text-emerald-300",
    },
    {
      name: "LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      Glyph: LinkedInGlyph,
      hover: "hover:border-sky-400/50 hover:bg-sky-400/10 hover:text-sky-300",
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close share hub"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share project"
        className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0d1020] shadow-2xl shadow-black/80"
      >
        {/* Ambient glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[420px] -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-violet-500/20 blur-3xl"
        />

        {/* Header */}
        <div className="relative flex items-center gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10">
            <GlobeIcon className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Share Hub
            </h2>
            <p className="truncate text-[11px] text-zinc-500">
              Publish “{title}” to anyone with the link
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

        <div className="relative space-y-5 px-6 py-5">
          {/* Privacy toggle */}
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-3">
              {isPublic ? (
                <GlobeIcon className="h-4 w-4 text-cyan-400" />
              ) : (
                <LockIcon className="h-4 w-4 text-zinc-500" />
              )}
              <div>
                <p className="text-xs font-semibold text-zinc-200">
                  Public Access
                </p>
                <p className="text-[11px] text-zinc-500">
                  {isPublic
                    ? "Anyone with the link can view this project"
                    : "Link is disabled — visitors see a Private screen"}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              aria-label="Toggle public access"
              disabled={saving}
              onClick={() => void onTogglePublic(!isPublic)}
              className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 disabled:opacity-60 ${
                isPublic
                  ? "bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
                  : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all duration-200 ${
                  isPublic ? "left-[22px]" : "left-0.5"
                }`}
              >
                {saving && (
                  <LoaderIcon className="h-3 w-3 animate-spin text-zinc-500" />
                )}
              </span>
            </button>
          </div>

          {/* Slug display + copy */}
          <div className={isPublic ? "" : "pointer-events-none opacity-40"}>
            <label
              htmlFor="share-hub-url"
              className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
            >
              Public link
            </label>
            <div className="flex gap-2">
              <input
                id="share-hub-url"
                type="text"
                readOnly
                value={shareUrl ?? "Allocating share link…"}
                onFocus={(e) => e.currentTarget.select()}
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-black/30 px-3.5 font-mono text-[12px] text-cyan-200 outline-none transition-colors focus:border-cyan-400/50"
              />
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!shareUrl}
                className={`flex h-11 flex-shrink-0 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all active:scale-[0.97] disabled:opacity-40 ${
                  copied
                    ? "bg-emerald-500 text-[#052015] shadow-[0_0_24px_rgba(16,185,129,0.45)]"
                    : "bg-cyan-500 text-[#06202a] shadow-[0_0_24px_rgba(6,182,212,0.45)] hover:bg-cyan-400 hover:shadow-[0_0_32px_rgba(34,211,238,0.55)]"
                }`}
              >
                {copied ? (
                  <>
                    <CheckIcon className="h-4 w-4 animate-[ping_0.3s_ease-out_1]" />
                    Copied!
                  </>
                ) : (
                  <>
                    <CopyIcon className="h-4 w-4" />
                    Copy Link
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Social row */}
          <div className={isPublic ? "" : "pointer-events-none opacity-40"}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Share to
            </p>
            <div className="grid grid-cols-3 gap-2">
              {socials.map(({ name, href, Glyph, hover }) => (
                <a
                  key={name}
                  href={shareUrl ? href : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Share on ${name}`}
                  className={`flex flex-col items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3.5 text-zinc-400 transition-all ${hover}`}
                >
                  <Glyph className="h-6 w-6" />
                  <span className="text-[11px] font-medium">{name}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Live social card preview */}
          <div className={isPublic ? "" : "pointer-events-none opacity-40"}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Link preview
            </p>
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <div className="flex h-24 items-center justify-center bg-gradient-to-br from-cyan-500/15 via-blue-500/10 to-violet-500/15">
                <span className="text-gradient text-xl font-bold tracking-tight">
                  DashyCore · D-Code
                </span>
              </div>
              <div className="space-y-1 border-t border-white/[0.06] px-4 py-3">
                <p className="truncate text-[13px] font-semibold text-zinc-100">
                  {title || "Untitled project"} — DashyCore D-Code
                </p>
                <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
                  {metaDescription}
                </p>
                <p className="truncate font-mono text-[10px] uppercase tracking-wide text-zinc-600">
                  {shareUrl ? new URL(shareUrl).host : "dashycore.app"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
