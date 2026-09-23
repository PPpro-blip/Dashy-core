"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { socialShareUrl, type ShareDestination } from "@/lib/share-links";
import {
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  ShareIcon,
  XIcon,
} from "@/components/icons";

/** Reusable for D-Code and any future Studio share action. */
export interface ShareHubProps {
  open: boolean;
  onClose: () => void;
  kind: string;
  title: string;
  description: string;
  imageUrl?: string;
  url: string | null;
  isPublic: boolean;
  busy: boolean;
  error?: string | null;
  onVisibilityChange: (publicAccess: boolean) => void;
  onRetry?: () => void;
}

function XBrandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.9 2h3.1l-6.8 7.8L23.2 22h-6.3l-4.9-7.5L5.5 22H2.4l7.3-8.5L1.9 2h6.4l4.5 6.9L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z" />
    </svg>
  );
}

function WhatsAppBrandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.3 3.7A11.5 11.5 0 0 0 2.5 17.5L1 23l5.6-1.5A11.5 11.5 0 1 0 20.3 3.7ZM12 21a9.5 9.5 0 0 1-4.8-1.3l-.3-.2-3.3.9.9-3.2-.2-.3A9.5 9.5 0 1 1 12 21Zm5.2-7.1c-.3-.2-1.7-.9-2-1-.2-.1-.4-.2-.6.2l-.9 1.1c-.2.2-.3.2-.6.1-1.6-.8-2.7-1.5-3.7-3.3-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.6l-.9-2.1c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.7s1.2 3.2 1.3 3.4c.2.2 2.3 3.6 5.7 4.7 2.8.9 3.4.7 4 .7.7-.1 1.7-.7 2-1.5.2-.7.2-1.4.1-1.5-.1-.2-.3-.3-.6-.4Z" />
    </svg>
  );
}

function LinkedInBrandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.4 2H3.6C2.7 2 2 2.7 2 3.6v16.8c0 .9.7 1.6 1.6 1.6h16.8c.9 0 1.6-.7 1.6-1.6V3.6c0-.9-.7-1.6-1.6-1.6ZM7.9 18.7H4.9V9h3v9.7ZM6.4 7.7a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Zm12.3 11h-3V14c0-1.1 0-2.5-1.6-2.5s-1.8 1.2-1.8 2.5v4.7h-3V9h2.9v1.3h.1c.4-.8 1.4-1.6 2.9-1.6 3.1 0 3.5 2 3.5 4.6v5.4Z" />
    </svg>
  );
}

export function ShareHub({
  open,
  onClose,
  kind,
  title,
  description,
  imageUrl = "/share-card.png",
  url,
  isPublic,
  busy,
  error,
  onVisibilityChange,
  onRetry,
}: ShareHubProps) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setCopyError("");
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  async function copyLink() {
    if (!url) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API may be unavailable outside a secure context. Use the
      // selected input as a fallback, and leave it selected if copying fails.
      linkRef.current?.select();
      let copiedWithFallback = false;
      try {
        copiedWithFallback = document.execCommand("copy");
      } catch {
        // Selection still lets the visitor use their own copy shortcut.
      }
      if (copiedWithFallback) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      } else {
        setCopyError("Select the link above and copy it manually.");
      }
    }
  }

  function openSocial(destination: ShareDestination) {
    if (!url || !isPublic) return;
    window.open(
      socialShareUrl(destination, url, title),
      "_blank",
      "noopener,noreferrer,width=720,height=620",
    );
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close Share Hub"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[#020611]/80 backdrop-blur-md"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-hub-title"
        aria-describedby="share-hub-subtitle"
        className="relative z-10 max-h-[min(92vh,850px)] w-full max-w-[960px] overflow-y-auto rounded-[26px] border border-white/[0.13] bg-[#0c1222] shadow-[0_35px_120px_rgba(0,0,0,0.75),0_0_65px_rgba(34,211,238,0.09)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-52 rounded-t-[26px] bg-[radial-gradient(ellipse_at_15%_0%,rgba(34,211,238,0.16),transparent_67%)]" />
        <header className="relative flex items-start gap-4 border-b border-white/[0.08] px-5 py-5 sm:px-8 sm:py-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300 shadow-inner shadow-cyan-300/10">
            <ShareIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-300/90">
              DashyCore / Share Hub
            </p>
            <h2
              id="share-hub-title"
              className="mt-1.5 text-xl font-semibold tracking-tight text-white sm:text-2xl"
            >
              Put your work out there.
            </h2>
            <p
              id="share-hub-subtitle"
              className="mt-1 text-xs text-zinc-400 sm:text-sm"
            >
              One link, full control. Choose who gets to see your {kind}{" "}
              project.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close Share Hub"
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="relative grid gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] md:gap-8">
          {/* The same title, description and image the link exposes to crawlers. */}
          <section aria-label="Live link preview" className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.17em] text-zinc-400">
                Live meta preview
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{" "}
                Live
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#121b2d] shadow-2xl shadow-black/30">
              <Image
                src={imageUrl}
                alt="DashyCore D-Code share artwork"
                width={1200}
                height={630}
                className="aspect-[1.9] w-full object-cover"
              />
              <div className="space-y-2 px-4 py-4 sm:px-5">
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300">
                  dashycore · {kind}
                </p>
                <h3
                  className="truncate text-base font-semibold text-white"
                  title={title}
                >
                  {title || "Untitled project"}
                </h3>
                <p className="line-clamp-2 min-h-[2.5em] text-xs leading-5 text-zinc-400">
                  {description}
                </p>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
              <GlobeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />A preview of
              how your link appears in a social feed. Private projects stay
              hidden from visitors.
            </p>
          </section>

          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-2xl border border-white/[0.10] bg-white/[0.035] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isPublic ? "bg-cyan-300/10 text-cyan-300" : "bg-violet-300/10 text-violet-300"}`}
                >
                  {isPublic ? (
                    <GlobeIcon className="h-4 w-4" />
                  ) : (
                    <LockIcon className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    Public Access
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                    {isPublic
                      ? "Anyone with the link can view."
                      : "Only you can view this link."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPublic}
                  aria-label="Public Access"
                  disabled={busy || !url}
                  onClick={() => onVisibilityChange(!isPublic)}
                  className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${isPublic ? "border-cyan-300/60 bg-cyan-400" : "border-white/20 bg-zinc-700"}`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-md transition-transform ${isPublic ? "translate-x-5" : ""}`}
                  >
                    {busy ? (
                      <LoaderIcon className="h-3 w-3 animate-spin text-zinc-600" />
                    ) : null}
                  </span>
                </button>
              </div>
            </section>

            <section aria-label="Project link">
              <div className="mb-2.5 flex items-center justify-between">
                <label
                  htmlFor="share-url"
                  className="text-[11px] font-semibold uppercase tracking-[0.17em] text-zinc-400"
                >
                  Your link
                </label>
                <span className="font-mono text-[10px] text-zinc-500">
                  {isPublic ? "PUBLIC" : "OWNER ONLY"}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.12] bg-[#070d1b]/90 px-3.5 text-cyan-300 focus-within:border-cyan-300/50">
                  <LinkIcon className="h-4 w-4 shrink-0" />
                  <input
                    ref={linkRef}
                    id="share-url"
                    aria-label="Share URL"
                    type="text"
                    readOnly
                    value={url ?? ""}
                    placeholder={
                      busy ? "Preparing your link…" : "Link unavailable"
                    }
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-12 min-w-0 flex-1 truncate bg-transparent font-mono text-[11px] text-zinc-200 outline-none placeholder-zinc-500 sm:text-xs"
                  />
                </div>
                <button
                  type="button"
                  disabled={!url || busy}
                  onClick={() => void copyLink()}
                  className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#05212a] shadow-lg shadow-cyan-400/10 transition-all hover:bg-cyan-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    <CopyIcon className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy Link"}
                </button>
              </div>
              <p
                role="status"
                aria-live="polite"
                className={`mt-2 min-h-4 text-[11px] ${copyError ? "text-amber-300" : "text-zinc-500"}`}
              >
                {copyError ||
                  (copied
                    ? "Link copied to clipboard."
                    : isPublic
                      ? "This link is ready to share."
                      : "Private link: other visitors receive a 403 until you enable Public Access.")}
              </p>
              {error && (
                <div
                  role="alert"
                  className="mt-2 flex items-center gap-3 rounded-lg border border-red-400/25 bg-red-400/[0.08] px-3 py-2 text-xs text-red-200"
                >
                  <span className="flex-1">{error}</span>
                  {!url && onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="font-semibold underline underline-offset-2"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="mt-auto">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.17em] text-zinc-400">
                  Send it further
                </span>
                <span className="text-[10px] text-zinc-500">
                  {isPublic ? "Choose a channel" : "Enable Public Access first"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={!url || !isPublic || busy}
                  onClick={() => openSocial("x")}
                  className="group flex min-h-24 flex-col items-start justify-between rounded-xl border border-white/[0.12] bg-[#121826] p-2.5 text-white transition-all hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#1b2231] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 sm:p-4"
                >
                  <XBrandIcon />
                  <span className="text-[10px] font-semibold sm:text-xs">
                    X{" "}
                    <span className="text-zinc-500 transition-colors group-hover:text-zinc-300">
                      ↗
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!url || !isPublic || busy}
                  onClick={() => openSocial("whatsapp")}
                  className="group flex min-h-24 flex-col items-start justify-between rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-2.5 text-emerald-300 transition-all hover:-translate-y-0.5 hover:border-emerald-400/60 hover:bg-emerald-400/[0.13] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 sm:p-4"
                >
                  <WhatsAppBrandIcon />
                  <span className="text-[10px] font-semibold sm:text-xs">
                    WhatsApp{" "}
                    <span className="text-emerald-500/60 transition-colors group-hover:text-emerald-200">
                      ↗
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!url || !isPublic || busy}
                  onClick={() => openSocial("linkedin")}
                  className="group flex min-h-24 flex-col items-start justify-between rounded-xl border border-blue-400/20 bg-blue-400/[0.06] p-2.5 text-blue-300 transition-all hover:-translate-y-0.5 hover:border-blue-400/60 hover:bg-blue-400/[0.13] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 sm:p-4"
                >
                  <LinkedInBrandIcon />
                  <span className="text-[10px] font-semibold sm:text-xs">
                    LinkedIn{" "}
                    <span className="text-blue-400/60 transition-colors group-hover:text-blue-200">
                      ↗
                    </span>
                  </span>
                </button>
              </div>
            </section>
          </div>
        </div>
        <footer className="flex items-center justify-between border-t border-white/[0.07] bg-black/15 px-5 py-3 sm:px-8">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> Powered by
            DashyCore
          </span>
          <span className="font-mono text-[10px] text-zinc-600">
            SHARE / 01
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
