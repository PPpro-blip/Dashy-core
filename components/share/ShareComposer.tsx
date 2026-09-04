"use client";

/**
 * DashyCore v7 — ShareComposer
 *
 * A branded modal sheet (full-screen friendly on mobile) where the user
 * edits the draft for ONE share target before confirming. This is the core
 * of the per-app composer: it renders the app's fields (title / caption /
 * tags / image) on top of a live preview card, then performs the honest
 * share action for that app (deep-link intent or copy — never a fake post).
 */

import { useEffect, useMemo, useState } from "react";
import {
  buildFacebookShareUrl,
  buildInstagramCaption,
  buildLinkedInUrl,
  buildMailto,
  buildOgShareUrl,
  buildRedditUrl,
  buildTelegramUrl,
  buildWhatsAppUrl,
  buildXText,
  buildXUrl,
  buildYouTubeDescription,
  buildYouTubeTitle,
  DASHY_LOGO,
  renderTags,
  tagSlug,
  type ProjectImage,
  type ShareAppConfig,
  type ShareDraft,
} from "@/lib/share-intents";
import { useToast } from "@/components/Toast";
import { copyText } from "@/lib/clipboard";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  LinkIcon,
  LoaderIcon,
  XIcon,
} from "@/components/icons";

interface ShareComposerProps {
  app: ShareAppConfig;
  draft: ShareDraft;
  onChange: (draft: ShareDraft) => void;
  imageOptions: ProjectImage[];
  onBack: () => void;
  onClose: () => void;
  /**
   * Fired when the user CONFIRMS this composer (deep-link opened or text
   * copied) — the hub records the destination + caption + tags so the next
   * "Share now" prefers this app. Never fired on cancel/back.
   */
  onConfirm?: (appId: ShareAppConfig["id"], draft: ShareDraft) => void;
}

function ChipInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const commit = () => {
    const slug = tagSlug(input);
    setInput("");
    if (slug && !tags.includes(slug)) onChange([...tags, slug]);
  };
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            title={`Remove ${tag}`}
            aria-label={`Remove ${tag}`}
            className="group flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-xs font-medium text-cyan-300 transition-colors hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300"
          >
            {tag}
            <XIcon className="h-3 w-3 opacity-60 group-hover:opacity-100" />
          </button>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !input && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={tags.length ? "add another…" : "add a tag…"}
          aria-label="Add tag"
          className="min-w-[7rem] flex-1 bg-transparent px-1 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none"
        />
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-zinc-600">
        Type + Enter to add · click a chip to remove
      </p>
    </div>
  );
}

export function ShareComposer({
  app,
  draft,
  onChange,
  imageOptions,
  onBack,
  onClose,
  onConfirm,
}: ShareComposerProps) {
  const toast = useToast();
  const [copying, setCopying] = useState<string | null>(null);

  /* ESC closes the composer (basic a11y). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accent = app.accent;

  const xText = useMemo(
    () => buildXText(draft.caption, draft.tags, draft.url, app.charBudget ?? 280),
    [draft.caption, draft.tags, draft.url, app.charBudget]
  );

  const previewImage = draft.imageDataUrl ?? DASHY_LOGO;
  const previewCaption =
    app.id === "x"
      ? xText
      : [draft.caption.trim(), renderTags(draft.tags)]
          .filter(Boolean)
          .join(" · ");

  const fieldLabel = (id: string, text: string) => (
    <label
      htmlFor={`composer-${app.id}-${id}`}
      className="mb-1.5 block text-xs font-medium text-zinc-400"
    >
      {text}
    </label>
  );

  const handleCopy = async (
    label: string,
    text: string,
    successTitle = "Copied to clipboard",
    successMessage = "Paste it where you like."
  ) => {
    setCopying(label);
    try {
      const ok = await copyText(text);
      toast.show({
        type: ok ? "success" : "error",
        title: ok ? successTitle : "Copy failed",
        message: ok ? successMessage : "Please copy manually.",
      });
    } finally {
      setCopying(null);
    }
  };

  const open = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleConfirm = () => {
    // Record the confirmed destination + draft BEFORE performing the share
    // action so the hub's "Share now" can prefer this app next time.
    onConfirm?.(app.id, draft);
    switch (app.id) {
      case "whatsapp":
        open(buildWhatsAppUrl(draft));
        break;
      case "facebook": {
        // FB sharer only reads the URL — embed the draft as OG query params.
        const ogUrl = buildOgShareUrl(draft.url, {
          title: draft.title,
          desc: draft.caption,
          imageName: draft.imageName,
        });
        open(buildFacebookShareUrl(ogUrl));
        break;
      }
      case "x":
        open(buildXUrl(draft));
        break;
      case "telegram":
        open(buildTelegramUrl(draft));
        break;
      case "linkedin":
        open(buildLinkedInUrl(draft));
        break;
      case "reddit":
        open(buildRedditUrl(draft));
        break;
      case "email":
        window.location.href = buildMailto(draft);
        break;
      case "instagram":
        void handleCopy(
          "caption",
          buildInstagramCaption(draft),
          "Caption copied",
          "Paste it into a Story, post or DM in the Instagram app, and attach your image manually."
        );
        break;
      case "youtube":
        void handleCopy(
          "description",
          buildYouTubeDescription(draft),
          "Description copied",
          "Paste title & description into YouTube Studio when you upload your video."
        );
        break;
    }
  };

  const secondaryActions: Array<{ label: string; action: () => void }> = [];
  if (app.id === "facebook") {
    secondaryActions.push({
      label: "Copy link",
      action: () => void handleCopy("link", draft.url),
    });
  } else if (app.id === "instagram") {
    secondaryActions.push({
      label: "Open instagram.com",
      action: () => open("https://www.instagram.com"),
    });
  } else if (app.id === "youtube") {
    secondaryActions.push({
      label: "Copy title",
      action: () => void handleCopy("title", buildYouTubeTitle(draft)),
    });
  } else if (app.id === "linkedin") {
    secondaryActions.push({
      label: "Copy caption",
      action: () =>
        void handleCopy(
          "caption",
          [draft.caption.trim(), renderTags(draft.tags)].filter(Boolean).join("\n")
        ),
    });
  }

  return (
    <>
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close share composer"
        className="fixed inset-0 z-[70] cursor-default bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Compose a ${app.name} share`}
        className="fixed left-1/2 top-1/2 z-[80] flex max-h-[92vh] w-[min(46rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1220] shadow-2xl shadow-black/80"
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5"
          style={{ boxShadow: `inset 0 3px 0 0 ${accent}` }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to share hub"
            className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
          >
            <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" />
            Hub
          </button>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${app.badge}22`, color: accent }}
          >
            <span className="text-sm font-bold">{app.name.charAt(0)}</span>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-white">
              Share on {app.name}
            </h2>
            <p className="truncate text-[11px] text-zinc-500">
              {app.id === "facebook"
                ? "Title & image come from the link preview"
                : app.mode === "copy"
                ? "We build the text — you paste it in the app"
                : "We'll open the app with this pre-filled"}
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

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Live preview card */}
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-stretch gap-3">
              <div className="relative w-24 flex-shrink-0 bg-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewImage}
                  alt="Share preview"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1 py-2.5 pr-3">
                <p className="truncate text-sm font-semibold text-white">
                  {draft.title || "Untitled project"}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">
                  {previewCaption || "Built with DashyCore D-Code ⚡"}
                </p>
                <p className="mt-1.5 truncate font-mono text-[10px] text-zinc-600">
                  {draft.url}
                </p>
              </div>
            </div>
          </div>

          {/* Title */}
          {app.fields.showTitle && (
            <div>
              {fieldLabel("title", "Title")}
              <input
                id={`composer-${app.id}-title`}
                type="text"
                value={draft.title}
                onChange={(e) => onChange({ ...draft, title: e.target.value })}
                autoFocus
                placeholder="A compelling headline"
                spellCheck={false}
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50"
              />
            </div>
          )}

          {/* Caption / body */}
          {app.fields.showCaption && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                {fieldLabel("caption", "Caption / body")}
                {app.charBudget && (
                  <span
                    className={`text-[10px] font-medium ${
                      xText.length > app.charBudget
                        ? "text-red-400"
                        : "text-zinc-600"
                    }`}
                  >
                    {xText.length}/{app.charBudget}
                  </span>
                )}
              </div>
              <textarea
                id={`composer-${app.id}-caption`}
                value={draft.caption}
                onChange={(e) => onChange({ ...draft, caption: e.target.value })}
                rows={3}
                placeholder="Say something about this project…"
                className="w-full resize-y rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50"
              />
            </div>
          )}

          {/* Tags */}
          {app.fields.showTags && (
            <div>
              {fieldLabel("tags", "Tags")}
              <ChipInput tags={draft.tags} onChange={(tags) => onChange({ ...draft, tags })} />
            </div>
          )}

          {/* Image picker */}
          {app.fields.showImage && (
            <div>
              {fieldLabel("image", "Preview image")}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...draft, imageName: null, imageDataUrl: null })
                  }
                  className={`relative h-16 w-16 overflow-hidden rounded-xl border transition-colors ${
                    draft.imageName === null
                      ? "border-cyan-400 ring-2 ring-cyan-400/40"
                      : "border-white/[0.08] hover:border-cyan-400/40"
                  }`}
                  aria-label="Use DashyCore logo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={DASHY_LOGO} alt="DashyCore logo" className="h-full w-full object-cover" />
                  {draft.imageName === null && (
                    <span className="absolute inset-0 flex items-center justify-center bg-cyan-400/20">
                      <CheckIcon className="h-4 w-4 text-cyan-200" />
                    </span>
                  )}
                </button>

                {imageOptions.map((img) => {
                  const selected = draft.imageName === img.name;
                  return (
                    <button
                      key={img.name}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...draft,
                          imageName: img.name,
                          imageDataUrl: img.dataUrl,
                        })
                      }
                      className={`relative h-16 w-16 overflow-hidden rounded-xl border transition-colors ${
                        selected
                          ? "border-cyan-400 ring-2 ring-cyan-400/40"
                          : "border-white/[0.08] hover:border-cyan-400/40"
                      }`}
                      aria-label={`Use ${img.name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                      {selected && (
                        <span className="absolute inset-0 flex items-center justify-center bg-cyan-400/20">
                          <CheckIcon className="h-4 w-4 text-cyan-200" />
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-center text-[8px] font-medium text-zinc-300">
                        {img.name}
                      </span>
                    </button>
                  );
                })}
                {imageOptions.length === 0 && (
                  <p className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-zinc-500">
                    <LinkIcon className="h-3.5 w-3.5" />
                    No images in this project — using the DashyCore logo.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-5 py-3.5">
          <button
            type="button"
            onClick={handleConfirm}
            style={{ backgroundColor: accent }}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-[#0a0a0b] shadow-lg transition-opacity hover:opacity-90"
          >
            {copying ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : app.mode === "copy" ? (
              <CopyIcon className="h-4 w-4" />
            ) : (
              <ArrowUpRightIcon className="h-4 w-4" />
            )}
            {app.ctaLabel}
          </button>
          {secondaryActions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.action}
              className="min-h-11 rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
            >
              {a.label}
            </button>
          ))}
        </div>

        {app.helper && (
          <p className="border-t border-white/[0.04] bg-white/[0.01] px-5 py-2.5 text-[11px] leading-relaxed text-zinc-500">
            <span className="mr-1 font-semibold text-zinc-400">Note:</span>
            {app.helper}
          </p>
        )}
      </div>
    </>
  );
}
