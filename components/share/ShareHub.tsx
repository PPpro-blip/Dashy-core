"use client";

/**
 * DashyCore v7 — ShareHub
 *
 * The main share surface (modal sheet on desktop, full-screen friendly on
 * mobile). Layout, top to bottom:
 *
 *   1. Big centered project preview card — thumb, title, tags/description,
 *      public URL row with Copy + QR
 *   2. PRIMARY action — a giant "Share now" button:
 *        · navigator.share() when available  → one-tap OS share sheet
 *        · else the LAST-USED app composer (dashy.share.prefs), prefilled
 *        · else it points the user at the app grid below
 *   3. Owner-only privacy controls (make public / private)
 *   4. Clean per-app grid (composers keep full customization)
 *
 * Honest by design: composers deep-link or copy — nothing fakes a post.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DCodeFile } from "@/lib/dcode";
import {
  collectProjectImages,
  makeDefaultDraft,
  SHARE_APPS,
  SHARE_APP_MAP,
  tagSlug,
  type ShareAppId,
  type ShareDraft,
} from "@/lib/share-intents";
import { applyPrefsToDraft, getSharePrefs, saveSharePrefs } from "@/lib/share-prefs";
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
  const [sharingNow, setSharingNow] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const imageOptions = useMemo(
    () => collectProjectImages(project?.files ?? []),
    [project?.files]
  );

  // Last-used destination + caption/tags (dashy.share.prefs). Seeds the
  // draft so "Share now" opens the last-used composer prefilled.
  const prefs = useMemo(() => getSharePrefs(), []);
  const lastApp =
    prefs.destination && SHARE_APP_MAP[prefs.destination]
      ? SHARE_APP_MAP[prefs.destination]
      : null;

  // The hub remounts on each open (conditional render in the workspace), so
  // this initializer gives us fresh smart defaults every time it opens.
  const [draft, setDraft] = useState<ShareDraft>(() =>
    applyPrefsToDraft(
      makeDefaultDraft(
        project?.title ?? "Untitled project",
        shareUrl ?? "",
        imageOptions
      ),
      prefs
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
        onConfirm={(appId, confirmedDraft) => {
          // Remember the last destination + caption + tags — the next
          // "Share now" (desktop, no OS sheet) prefers this composer.
          saveSharePrefs({
            destination: appId,
            caption: confirmedDraft.caption,
            tags: confirmedDraft.tags,
          });
        }}
      />
    );
  }

  const url = draft.url;
  const canDeviceShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

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

  /**
   * PRIMARY one-tap action:
   *   1. navigator.share (mobile + supported desktop) → OS share sheet
   *   2. last-used app composer, prefilled with the remembered draft
   *   3. no preference yet → spotlight the app grid to pick one
   */
  const handleShareNow = async () => {
    if (canDeviceShare) {
      setSharingNow(true);
      try {
        await navigator.share({
          title: draft.title,
          text: [draft.caption.trim(), draft.tags.map(tagSlug).filter(Boolean).join(" ")]
            .filter(Boolean)
            .join("\n\n"),
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
        setSharingNow(false);
      }
      return;
    }
    if (lastApp) {
      setSelectedApp(lastApp.id);
      return;
    }
    // First time on desktop: guide to the grid (one intentional pick).
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    toast.show({
      type: "info",
      title: "Pick where to share",
      message:
        "Choose an app below — your choice is remembered for one-tap sharing next time.",
    });
  };

  const shareNowLabel = canDeviceShare
    ? "Share now"
    : lastApp
    ? `Share now · ${lastApp.name}`
    : "Share now";

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
          {/* Big centered preview card */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] transition-colors hover:border-cyan-400/25">
            <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
              <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-white/[0.08] bg-black/30 shadow-lg shadow-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.imageDataUrl ?? "/icon-512.png"}
                  alt="Share preview"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <p className="mt-3 max-w-full truncate px-2 text-base font-semibold text-white">
                {draft.title || "Untitled project"}
              </p>
              <p className="mt-1 line-clamp-2 max-w-sm text-xs leading-relaxed text-zinc-400">
                {draft.caption || "Built with DashyCore D-Code ⚡"}
              </p>
              {draft.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                  {draft.tags.slice(0, 6).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.08] px-2 py-0.5 text-[10px] font-medium text-cyan-300"
                    >
                      {tagSlug(tag) || tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Public URL row: link + Copy + QR */}
            <div className="flex items-center gap-2 border-t border-white/[0.06] bg-black/20 px-4 py-3">
              <GlobeIcon className="h-3.5 w-3.5 flex-shrink-0 text-cyan-400/70" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
                {url || "Assigning share link…"}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                disabled={!url || copying}
                title="Copy the public project link"
                className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20 disabled:opacity-40"
              >
                {copying ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
                Copy
              </button>
              <button
                type="button"
                onClick={() => setShowQr((v) => !v)}
                aria-expanded={showQr}
                title={showQr ? "Hide QR code" : "Show QR code"}
                className={`flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${
                  showQr
                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                    : "border-white/[0.1] bg-white/[0.03] text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-300"
                }`}
              >
                <LinkIcon className="h-3.5 w-3.5" />
                QR
              </button>
            </div>

            {showQr && (
              <div className="flex flex-col items-center border-t border-white/[0.06] px-4 py-4">
                <ShareQr value={url} />
                <p className="mt-2 text-[11px] text-zinc-500">
                  Scan to open this public project
                </p>
              </div>
            )}
          </div>

          {/* PRIMARY action — one-tap share */}
          <button
            type="button"
            onClick={() => void handleShareNow()}
            disabled={sharingNow || !url}
            className="group flex w-full flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-b from-cyan-400 to-cyan-500 px-6 py-4 text-[#06202a] shadow-lg shadow-cyan-500/25 transition-all hover:from-cyan-300 hover:to-cyan-400 hover:shadow-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2 text-base font-bold">
              {sharingNow ? (
                <LoaderIcon className="h-5 w-5 animate-spin" />
              ) : (
                <ShareIcon className="h-5 w-5" />
              )}
              {shareNowLabel}
            </span>
            <span className="text-[11px] font-medium opacity-75">
              {canDeviceShare
                ? "Opens your device's share sheet"
                : lastApp
                ? `Opens your ${lastApp.name} composer, prefilled`
                : "Pick an app below — remembered for next time"}
            </span>
          </button>

          {/* Owner privacy controls — hidden for plain visitors, who never
              see this prop at all. A private project still renders the full
              hub for its owner; this row is how they publish/revoke. */}
          {privacy && (
            <div
              className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 ${
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

          {/* App grid — each tile opens that app's composer (full
              customization: title, caption, tags, image picker). */}
          <div ref={gridRef}>
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Share to…
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
              {SHARE_APPS.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedApp(app.id)}
                  className={`group flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl border bg-white/[0.02] p-2 transition-all hover:border-cyan-400/40 hover:bg-white/[0.05] hover:shadow-lg hover:shadow-cyan-500/[0.07] ${
                    prefs.destination === app.id
                      ? "border-cyan-400/35"
                      : "border-white/[0.08]"
                  }`}
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold"
                    style={{
                      backgroundColor: `${app.badge}26`,
                      color: app.accent,
                      boxShadow: `0 0 0 1px ${app.accent}55`,
                    }}
                  >
                    {app.name.charAt(0)}
                  </span>
                  <span className="max-w-full truncate text-[11px] font-medium text-zinc-300 group-hover:text-white">
                    {app.name}
                  </span>
                  {prefs.destination === app.id && (
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-cyan-400/80">
                      Last used
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-relaxed text-zinc-600">
              <LinkIcon className="h-3.5 w-3.5 flex-shrink-0" />
              Tapping an app opens a composer to refine title, caption &amp;
              image first — we never post for you.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
