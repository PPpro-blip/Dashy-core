"use client";

/**
 * DashyCore v7 — Share Hub (THE canonical implementation).
 *
 * Rendered in exactly two containers, both of which use this component:
 *   · /share                          → focused page (global entry)
 *   · <ShareHubDialog>                → drawer/modal (contextual entries)
 *
 * Flow: SOURCE → PLATFORMS → CAPTION → MEDIA → VARIANTS → PREVIEW → PUBLISH.
 * Single column on phones/tablets, editor + sticky preview on large screens.
 *
 * Honesty rules baked in:
 *   · a project source is re-read from Supabase (RLS) before anything is
 *     shown, so a client-supplied id is never treated as proof of ownership
 *   · providers advertise their real capability; nothing is ever reported
 *     as "published" unless the public link genuinely went live
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { getProject, toggleProjectPublic } from "@/lib/dcode";
import { useToast } from "@/components/Toast";
import {
  SHARE_PROVIDERS,
  getProvider,
  providerStatus,
  type ProviderId,
  type ProviderState,
} from "@/lib/share/providers";
import {
  captionFor,
  composePreview,
  composeText,
  emptyComposer,
  isVariantOverridden,
  overLimit,
  suggestCaption,
  type ComposerState,
} from "@/lib/share/compose";
import {
  resolveSource,
  sourceTypeLabel,
  type ShareSource,
} from "@/lib/share/types";
import { ShareSourcePicker } from "@/components/share/ShareSourcePicker";
import { SharePreview } from "@/components/share/SharePreview";
import {
  AlertIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  RefreshIcon,
  ShareIcon,
  SparklesIcon,
  XIcon,
} from "@/components/icons";

export interface ShareHubProps {
  /** Source the hub opens with. Null → the "what are you sharing?" picker. */
  initialSource?: ShareSource | null;
  variant?: "page" | "dialog";
  onClose?: () => void;
  /** Dialog-only: rendered as the panel heading id for aria-labelledby. */
  titleId?: string;
}

const STATE_STYLES: Record<ProviderState, string> = {
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  partial: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  manual: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  "needs-link": "border-zinc-500/30 bg-white/[0.04] text-zinc-400",
};

function initialsFor(name: string, email: string): string {
  const src = name.trim() || email.split("@")[0] || "D";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function SourceIcon({ kind }: { kind: ShareSource["kind"] }) {
  if (kind === "dcode-project") return <CodeIcon className="h-4 w-4" />;
  if (kind === "studio-asset") return <SparklesIcon className="h-4 w-4" />;
  return <LinkIcon className="h-4 w-4" />;
}

export function ShareHub({
  initialSource = null,
  variant = "page",
  onClose,
  titleId,
}: ShareHubProps) {
  const toast = useToast();

  const [source, setSource] = useState<ShareSource | null>(initialSource);
  /** "Change source" is deliberately a two-step, intentional action. */
  const [changingSource, setChangingSource] = useState(false);
  const [validating, setValidating] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [composer, setComposer] = useState<ComposerState>(() => emptyComposer());
  const [selected, setSelected] = useState<ProviderId[]>(["x"]);
  const [activeProvider, setActiveProvider] = useState<ProviderId>("x");
  const [author, setAuthor] = useState({ name: "You", initials: "D" });
  const [copiedProvider, setCopiedProvider] = useState<ProviderId | null>(null);

  /** Tracks which source the composer was seeded for. */
  const seededFor = useRef<string | null>(null);

  /* --------------------------- identity (preview) -------------------------- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled || !user) return;
        const name =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          user.email?.split("@")[0] ||
          "You";
        setAuthor({ name, initials: initialsFor(name, user.email ?? "") });
      } catch {
        // Preview falls back to the neutral placeholder.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------- project re-validation ------------------------- */

  /**
   * A project id handed in by a caller is only a hint. The row is re-read
   * through Supabase (RLS: owner-only) so the hub always reflects the
   * server's truth about title / visibility / slug — and refuses sources the
   * session cannot actually reach.
   */
  const revalidate = useCallback(async (candidate: ShareSource) => {
    if (candidate.kind !== "dcode-project") {
      setAccessError(null);
      return;
    }
    setValidating(true);
    setAccessError(null);
    try {
      const fresh = await getProject(candidate.id);
      if (!fresh) {
        setAccessError(
          "This project is no longer available on your account. Pick another source."
        );
        return;
      }
      setSource({
        kind: "dcode-project",
        id: fresh.id,
        title: fresh.title,
        language: fresh.language,
        fileCount: fresh.files.length,
        isPublic: fresh.isPublic,
        shareSlug: fresh.shareSlug,
      });
    } catch (error) {
      setAccessError(
        error instanceof Error ? error.message : "Could not verify this project."
      );
    } finally {
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (source) void revalidate(source);
    // Only on identity change of the source, not on every field update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.kind, source?.id]);

  /* ------------------------------- derived -------------------------------- */

  const resolved = useMemo(
    () => (source ? resolveSource(source) : null),
    [source]
  );

  /* Seed the composer once per source (never clobbers user edits). */
  useEffect(() => {
    if (!source || !resolved) return;
    const key = `${source.kind}:${source.id}`;
    if (seededFor.current === key) {
      // Same source, but the URL may have just gone live.
      setComposer((prev) =>
        prev.url === (resolved.url ?? "")
          ? prev
          : { ...prev, url: resolved.url ?? "" }
      );
      return;
    }
    seededFor.current = key;
    setComposer({
      ...emptyComposer(resolved.url ?? ""),
      caption: suggestCaption(resolved.title, resolved.typeLabel),
    });
  }, [source, resolved]);

  const hasUrl = !!composer.url.trim();
  const provider = getProvider(activeProvider);
  const status = providerStatus(provider, hasUrl);
  const previewText = composePreview(composer, provider);
  const handoffText = composeText(composer, provider);

  const selectedProviders = useMemo(
    () => selected.map((id) => getProvider(id)),
    [selected]
  );
  const readyCount = selectedProviders.filter(
    (p) => providerStatus(p, hasUrl).state !== "needs-link"
  ).length;

  /* -------------------------------- actions -------------------------------- */

  const toggleProvider = useCallback((id: ProviderId) => {
    setSelected((prev) => {
      const next = prev.includes(id)
        ? prev.filter((p) => p !== id)
        : [...prev, id];
      return next;
    });
    setActiveProvider(id);
  }, []);

  const handleChooseSource = useCallback((next: ShareSource) => {
    setSource(next);
    setChangingSource(false);
  }, []);

  const makePublic = useCallback(async () => {
    if (!source || source.kind !== "dcode-project") return;
    setPublishing(true);
    try {
      const updated = await toggleProjectPublic(source.id, true);
      setSource({
        kind: "dcode-project",
        id: updated.id,
        title: updated.title,
        language: updated.language,
        fileCount: updated.files.length,
        isPublic: updated.isPublic,
        shareSlug: updated.shareSlug,
      });
      toast.success(
        "Public link is live",
        "Anyone with the link can now open this project."
      );
    } catch (error) {
      toast.error(
        "Could not publish the link",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setPublishing(false);
    }
  }, [source, toast]);

  const makePrivate = useCallback(async () => {
    if (!source || source.kind !== "dcode-project") return;
    setPublishing(true);
    try {
      const updated = await toggleProjectPublic(source.id, false);
      setSource({
        kind: "dcode-project",
        id: updated.id,
        title: updated.title,
        language: updated.language,
        fileCount: updated.files.length,
        isPublic: updated.isPublic,
        shareSlug: updated.shareSlug,
      });
      toast.info("Project is private", "The public link no longer works.");
    } catch (error) {
      toast.error(
        "Could not update visibility",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setPublishing(false);
    }
  }, [source, toast]);

  const copyText = useCallback(
    async (text: string, label = "Copied") => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(label);
        return true;
      } catch {
        toast.error("Clipboard unavailable", "Select the text and copy manually.");
        return false;
      }
    },
    [toast]
  );

  /** Hands the post off to one platform. Never claims it was published. */
  const handoff = useCallback(
    async (id: ProviderId) => {
      const p = getProvider(id);
      const st = providerStatus(p, hasUrl);
      if (st.state === "needs-link") {
        toast.error(
          `${p.label} needs a public link`,
          "Publish the source's public link first."
        );
        return;
      }
      const text = composeText(composer, p);
      const url = composer.url.trim() || null;

      // Anything the platform will not prefill goes to the clipboard so the
      // user can paste it — that is the honest handoff.
      if (!p.prefill.text && text) {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopiedProvider(id);
        window.setTimeout(() => setCopiedProvider(null), 2500);
      }

      const target = p.buildUrl({ text, url });
      if (!target) {
        toast.error(`${p.label} handoff unavailable`, p.note);
        return;
      }
      window.open(target, "_blank", "noopener,noreferrer");
      toast.info(
        `${p.label} opened`,
        p.prefill.text
          ? "Review it there and post when you're happy."
          : "Caption copied — paste it into the composer."
      );
    },
    [composer, hasUrl, toast]
  );

  const handoffAll = useCallback(async () => {
    for (const p of selectedProviders) {
      if (providerStatus(p, hasUrl).state === "needs-link") continue;
      // Sequential so popup blockers do not silently drop tabs.
      // eslint-disable-next-line no-await-in-loop
      await handoff(p.id);
    }
  }, [handoff, hasUrl, selectedProviders]);

  /* -------------------------------- render --------------------------------- */

  const showPicker = !source || changingSource;

  return (
    <div className="flex min-h-0 w-full flex-col">
      {/* ------------------------------ header ------------------------------ */}
      <div className="flex flex-shrink-0 items-start gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-6">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
          <ShareIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="text-base font-semibold tracking-tight text-white"
          >
            Share Hub
          </h2>
          {/* Launched from a project/asset? Say so — never leave the user
              guessing which source the hub picked up. */}
          {source && resolved && !showPicker ? (
            <p className="mt-0.5 truncate text-xs leading-relaxed text-zinc-400">
              Sharing:{" "}
              <span className="font-medium text-zinc-200">{resolved.title}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Compose once, hand off to each platform. DashyCore never posts on
              your behalf.
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Share Hub"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 ${
          variant === "dialog" ? "" : "pb-10"
        }`}
      >
        <div
          className={
            source && !showPicker
              ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]"
              : ""
          }
        >
          {/* ============================ EDITOR ============================ */}
          <div className="min-w-0 space-y-6">
            {/* ----------------------------- SOURCE ---------------------------- */}
            <section aria-labelledby="share-source-heading">
              <h3
                id="share-source-heading"
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
              >
                Source
              </h3>

              {showPicker ? (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <ShareSourcePicker
                    onSelect={handleChooseSource}
                    onCancel={
                      source ? () => setChangingSource(false) : undefined
                    }
                  />
                </div>
              ) : (
                source &&
                resolved && (
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
                        <SourceIcon kind={source.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-100">
                          {resolved.title}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                          <span>{sourceTypeLabel(source.kind)}</span>
                          {source.kind === "dcode-project" && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {source.fileCount}{" "}
                                {source.fileCount === 1 ? "file" : "files"}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1">
                                {source.isPublic ? (
                                  <GlobeIcon className="h-3 w-3 text-cyan-300" />
                                ) : (
                                  <LockIcon className="h-3 w-3" />
                                )}
                                {source.isPublic ? "Public" : "Private"}
                              </span>
                            </>
                          )}
                          {validating && (
                            <span className="inline-flex items-center gap-1 text-zinc-600">
                              <LoaderIcon className="h-3 w-3 animate-spin" />
                              verifying
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setChangingSource(true)}
                        className="min-h-[36px] flex-shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                      >
                        Change source
                      </button>
                    </div>

                    {accessError && (
                      <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        <AlertIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        {accessError}
                      </p>
                    )}

                    {/* Public link state — the only thing that can be "published" */}
                    <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
                      {resolved.url ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            <CheckIcon className="h-3 w-3" />
                            {source.kind === "dcode-project"
                              ? "Published"
                              : "Live"}
                          </span>
                          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
                            {resolved.url}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              void copyText(resolved.url ?? "", "Link copied")
                            }
                            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                          >
                            <CopyIcon className="h-3 w-3" />
                            Copy
                          </button>
                          {source.kind === "dcode-project" && (
                            <button
                              type="button"
                              onClick={() => void makePrivate()}
                              disabled={publishing}
                              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
                            >
                              <LockIcon className="h-3 w-3" />
                              Make private
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-500/30 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                            <LockIcon className="h-3 w-3" />
                            Not published
                          </span>
                          <p className="min-w-0 flex-1 text-[11px] text-zinc-500">
                            {resolved.blockedReason}
                          </p>
                          {source.kind === "dcode-project" && (
                            <button
                              type="button"
                              onClick={() => void makePublic()}
                              disabled={publishing}
                              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-[11px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400 disabled:opacity-50"
                            >
                              {publishing ? (
                                <LoaderIcon className="h-3 w-3 animate-spin" />
                              ) : (
                                <GlobeIcon className="h-3 w-3" />
                              )}
                              Create public link
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </section>

            {source && !showPicker && (
              <>
                {/* --------------------------- PLATFORMS -------------------------- */}
                <section aria-labelledby="share-platforms-heading">
                  <h3
                    id="share-platforms-heading"
                    className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                  >
                    Platforms
                  </h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {SHARE_PROVIDERS.map((p) => {
                      const st = providerStatus(p, hasUrl);
                      const isOn = selected.includes(p.id);
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => toggleProvider(p.id)}
                            aria-pressed={isOn}
                            className={`flex w-full min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                              isOn
                                ? "border-cyan-400/40 bg-cyan-400/[0.07]"
                                : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                            }`}
                          >
                            <span
                              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                              style={{
                                backgroundColor: `${p.accent}1f`,
                                color: p.accent,
                              }}
                            >
                              <p.Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-zinc-100">
                                {p.label}
                              </span>
                              <span className="block truncate text-[11px] text-zinc-500">
                                {st.label}
                              </span>
                            </span>
                            <span
                              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                                isOn
                                  ? "border-cyan-400/50 bg-cyan-400/20 text-cyan-300"
                                  : "border-white/10 text-transparent"
                              }`}
                              aria-hidden="true"
                            >
                              <CheckIcon className="h-3 w-3" />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                    No platform accounts are connected — DashyCore has no
                    publishing backend yet, so every share is an official
                    handoff you confirm on the platform.
                  </p>
                </section>

                {/* ------------------------ MASTER CAPTION ------------------------ */}
                <section aria-labelledby="share-caption-heading">
                  <h3
                    id="share-caption-heading"
                    className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                  >
                    Master caption
                  </h3>
                  <textarea
                    value={composer.caption}
                    onChange={(e) =>
                      setComposer((c) => ({ ...c, caption: e.target.value }))
                    }
                    rows={4}
                    placeholder="Say something about what you're sharing…"
                    aria-label="Master caption"
                    className="w-full resize-y rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder-zinc-500 focus:border-cyan-400/50 focus:outline-none"
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-zinc-400">
                        Hashtags
                      </span>
                      <input
                        type="text"
                        value={composer.hashtags}
                        onChange={(e) =>
                          setComposer((c) => ({ ...c, hashtags: e.target.value }))
                        }
                        placeholder="#buildinpublic #ai"
                        className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-400/50 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-zinc-400">
                        Mentions{" "}
                        <span className="text-zinc-600">(X · Instagram)</span>
                      </span>
                      <input
                        type="text"
                        value={composer.mentions}
                        onChange={(e) =>
                          setComposer((c) => ({ ...c, mentions: e.target.value }))
                        }
                        placeholder="@dashycore"
                        className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-400/50 focus:outline-none"
                      />
                    </label>
                  </div>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[11px] font-medium text-zinc-400">
                      Link
                    </span>
                    <input
                      type="url"
                      value={composer.url}
                      onChange={(e) =>
                        setComposer((c) => ({ ...c, url: e.target.value }))
                      }
                      placeholder="https://…"
                      className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 font-mono text-[12px] text-zinc-100 placeholder-zinc-600 focus:border-cyan-400/50 focus:outline-none"
                    />
                  </label>
                </section>

                {/* ----------------------------- MEDIA ---------------------------- */}
                <section aria-labelledby="share-media-heading">
                  <h3
                    id="share-media-heading"
                    className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                  >
                    Media
                  </h3>
                  {resolved?.mediaUrl ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <span className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-black/30">
                        <Image
                          src={resolved.mediaUrl}
                          alt={resolved.title}
                          fill
                          unoptimized
                          sizes="64px"
                          className="object-cover"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-zinc-300">
                          1 image attached from this source.
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                          Platform handoffs cannot upload files — download the
                          image and attach it in the platform's composer.
                        </p>
                      </div>
                      <a
                        href={resolved.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                      >
                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                        Open image
                      </a>
                    </div>
                  ) : (
                    <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-500">
                      <ImageIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      No media on this source. Platforms will render the link
                      preview instead.
                    </p>
                  )}
                </section>

                {/* ------------------------ PLATFORM VARIANTS --------------------- */}
                {selected.length > 0 && (
                  <section aria-labelledby="share-variants-heading">
                    <h3
                      id="share-variants-heading"
                      className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                    >
                      Platform variants
                    </h3>

                    {/* Compact switcher — only the active platform expands. */}
                    <div
                      role="tablist"
                      aria-label="Platform variants"
                      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
                    >
                      {selectedProviders.map((p) => {
                        const isActive = p.id === activeProvider;
                        return (
                          <button
                            key={p.id}
                            role="tab"
                            type="button"
                            aria-selected={isActive}
                            onClick={() => setActiveProvider(p.id)}
                            className={`flex min-h-[36px] flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                              isActive
                                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                                : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                            }`}
                          >
                            <p.Icon className="h-3.5 w-3.5" />
                            {p.label}
                            {isVariantOverridden(composer, p.id) && (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-cyan-400"
                                title="Custom copy"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${STATE_STYLES[status.state]}`}
                        >
                          {status.label}
                        </span>
                        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-zinc-500">
                          {status.detail}
                        </p>
                      </div>

                      <textarea
                        value={captionFor(composer, provider.id)}
                        onChange={(e) =>
                          setComposer((c) => ({
                            ...c,
                            variants: { ...c.variants, [provider.id]: e.target.value },
                          }))
                        }
                        rows={4}
                        aria-label={`${provider.label} caption`}
                        className="mt-3 w-full resize-y rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm leading-relaxed text-zinc-100 focus:border-cyan-400/50 focus:outline-none"
                      />

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {provider.charLimit && (
                          <span
                            className={`text-[11px] ${
                              overLimit(handoffText, provider)
                                ? "text-red-300"
                                : "text-zinc-500"
                            }`}
                          >
                            {handoffText.length} / {provider.charLimit}
                          </span>
                        )}
                        {isVariantOverridden(composer, provider.id) && (
                          <button
                            type="button"
                            onClick={() =>
                              setComposer((c) => {
                                const next = { ...c.variants };
                                delete next[provider.id];
                                return { ...c, variants: next };
                              })
                            }
                            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100"
                          >
                            <RefreshIcon className="h-3 w-3" />
                            Reset to master
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(previewText, `${provider.label} copy copied`)
                          }
                          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100"
                        >
                          <CopyIcon className="h-3 w-3" />
                          Copy post
                        </button>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          {/* ======================= PREVIEW + PUBLISH ======================= */}
          {source && !showPicker && (
            <div className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
              <section aria-labelledby="share-preview-heading">
                <h3
                  id="share-preview-heading"
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                >
                  Preview · {provider.label}
                </h3>
                <SharePreview
                  provider={provider}
                  text={composeText(composer, provider)}
                  url={composer.url.trim()}
                  mediaUrl={resolved?.mediaUrl ?? null}
                  source={
                    resolved ?? {
                      title: "",
                      typeLabel: "",
                      url: null,
                      mediaUrl: null,
                      isLive: false,
                      blockedReason: null,
                    }
                  }
                  authorName={author.name}
                  authorInitials={author.initials}
                />
              </section>

              <section aria-labelledby="share-publish-heading">
                <h3
                  id="share-publish-heading"
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500"
                >
                  Publish
                </h3>
                <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <button
                    type="button"
                    onClick={() => void handoff(provider.id)}
                    disabled={status.state === "needs-link"}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  >
                    {copiedProvider === provider.id ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <ExternalLinkIcon className="h-4 w-4" />
                    )}
                    {provider.handoffLabel}
                  </button>

                  {selected.length > 1 && readyCount > 1 && (
                    <button
                      type="button"
                      onClick={() => void handoffAll()}
                      className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                    >
                      Open all {readyCount} selected platforms
                    </button>
                  )}

                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    DashyCore hands the post to the platform — it cannot
                    confirm a publish, so nothing here is ever marked as
                    posted.
                  </p>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
