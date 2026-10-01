"use client";

/**
 * DashyCore v7 — THE Share Hub (single canonical implementation).
 *
 * One full-page surface at /share. Every entry point in the workspace —
 * global nav, D-Code editor, project cards, Studio assets — lands here; a
 * `?sourceType=…&sourceId=…` query pre-selects that exact source, and
 * changing it is an explicit, deliberate action.
 *
 * Sections, in order:
 *   01 SOURCE            what is being shared (D-Code project / Studio image)
 *   02 PLATFORMS         compact switcher — X · LinkedIn · Instagram ·
 *                        Facebook · WhatsApp; only the active platform's
 *                        detail controls are visible below
 *   03 MASTER CAPTION    one caption + tags, the starting point for variants
 *   04 MEDIA             attach a project image / the Studio image
 *   05 PLATFORM VARIANTS the active platform's copy, budget-aware
 *   06 PREVIEW           the active platform's post, as composed
 *   07 PUBLISH           the real public link (Supabase-backed) + honest
 *                        per-platform actions
 *
 * Honest by design:
 *   · "Published" appears ONLY after the backend confirmed a public link
 *     (dcode_projects.is_public / shared_assets row) or a Meta Direct API
 *     publish succeeded (MetaExportCards handles its own confirmation).
 *   · Handoff platforms say "Open <platform>" — opening a composer is never
 *     reported as a post.
 *   · The provider abstraction (lib/share-providers) stays capability-first
 *     so OAuth direct publishing can land later without a redesign.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getProject, listProjects, toggleProjectPublic, type DCodeProject } from "@/lib/dcode";
import {
  listStudioMedia,
  saveStudioMedia,
  shareStudioMedia,
  studioShareUrl,
  type StudioMediaAsset,
} from "@/lib/studio";
import {
  SHARE_PROVIDERS,
  modeLabel,
  providerById,
  type ShareProviderId,
} from "@/lib/share-providers";
import {
  buildLinkedInUrl,
  buildShortShareUrl,
  buildWhatsAppUrl,
  buildXUrl,
  collectProjectImages,
  composeBody,
  makeDefaultDraft,
  renderTags,
  type ProjectImage,
  type ShareDraft,
} from "@/lib/share-intents";
import { applyPrefsToDraft, getSharePrefs, saveSharePrefs } from "@/lib/share-prefs";
import { copyText } from "@/lib/clipboard";
import { MetaExportCards } from "@/components/share/MetaExportCards";
import { ShareQr } from "@/components/share/ShareQr";
import { useToast } from "@/components/Toast";
import {
  AlertIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  PenIcon,
  RefreshIcon,
  ShareIcon,
  SparklesIcon,
  TrashIcon,
} from "@/components/icons";

/* ---------------------------------------------------------------------- */
/* Source model                                                            */
/* ---------------------------------------------------------------------- */

type HubSource =
  | { type: "dcode_project"; project: DCodeProject }
  | { type: "studio_asset"; asset: StudioMediaAsset };

function sourceTitle(source: HubSource): string {
  return source.type === "dcode_project"
    ? source.project.title.trim() || "Untitled project"
    : source.asset.title.trim() || "Untitled Studio image";
}

/** The live public URL — null until the backend has confirmed one. */
function sourceShareUrl(source: HubSource, origin: string): string | null {
  if (source.type === "dcode_project") {
    const { isPublic, shareSlug } = source.project;
    return isPublic && shareSlug ? buildShortShareUrl(origin, shareSlug) : null;
  }
  return source.asset.shareSlug ? studioShareUrl(source.asset.shareSlug) : null;
}

const PLATFORM_IDS: ShareProviderId[] = ["x", "linkedin", "instagram", "facebook", "whatsapp"];

function SectionHeading({
  step,
  title,
  hint,
  id,
}: {
  step: string;
  title: string;
  hint?: string;
  id?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
        {step}
      </p>
      <h2 id={id} className="text-sm font-semibold text-white">{title}</h2>
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Hub                                                                     */
/* ---------------------------------------------------------------------- */

export function ShareHub() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const requestedType = params.get("sourceType");
  const requestedId = params.get("sourceId");

  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(Boolean(requestedId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<HubSource | null>(null);
  /** Explicit action only — a pre-selected source never falls back silently. */
  const [pickerOpen, setPickerOpen] = useState(!requestedId);
  const [projects, setProjects] = useState<DCodeProject[]>([]);
  const [studioAssets, setStudioAssets] = useState<StudioMediaAsset[]>([]);

  const [active, setActive] = useState<ShareProviderId>("x");
  const [draft, setDraft] = useState<ShareDraft>(() =>
    applyPrefsToDraft(makeDefaultDraft("", "", []), getSharePrefs())
  );
  const [variants, setVariants] = useState<Partial<Record<ShareProviderId, string>>>({});
  const [publishBusy, setPublishBusy] = useState<"publish" | "unpublish" | "regenerate" | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const variantsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  /* ----------------------------- source load ---------------------------- */

  const seedDraft = useCallback((next: HubSource) => {
    const title = sourceTitle(next);
    const url = sourceShareUrl(next, window.location.origin) ?? "";
    const images: ProjectImage[] =
      next.type === "dcode_project"
        ? collectProjectImages(next.project.files)
        : [{ name: "studio-image.jpg", dataUrl: next.asset.imageUrl }];
    const base = applyPrefsToDraft(makeDefaultDraft(title, url, images), getSharePrefs());
    setDraft(
      next.type === "studio_asset"
        ? {
            ...base,
            caption: next.asset.prompt || "Made with Dashy Studio ⚡",
            tags: ["DashyCore", "DashyStudio", "AIArt"],
          }
        : base
    );
    setVariants({});
    setCopyResult(null);
    setShowQr(false);
  }, []);

  const adoptSource = useCallback(
    (next: HubSource, syncUrl: boolean) => {
      setSource(next);
      setPickerOpen(false);
      seedDraft(next);
      if (syncUrl) {
        const id = next.type === "dcode_project" ? next.project.id : next.asset.id;
        router.replace(
          `/share?sourceType=${next.type}&sourceId=${encodeURIComponent(id)}`,
          { scroll: false }
        );
      }
    },
    [router, seedDraft]
  );

  /* Resolve the requested source exactly — never a stale or sibling item. */
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      setLoadError(null);
      if (!requestedId) return;
      setLoading(true);
      try {
        if (requestedType === "studio_asset") {
          const asset = listStudioMedia().find((item) => item.id === requestedId);
          if (!asset) {
            throw new Error(
              "This Studio image is not in your library on this device."
            );
          }
          if (!cancelled) adoptSource({ type: "studio_asset", asset }, false);
          return;
        }
        // Default (incl. legacy links without sourceType): a D-Code project.
        const project = await getProject(requestedId);
        if (!project) {
          throw new Error("This project is unavailable or you no longer have access to it.");
        }
        if (!cancelled) adoptSource({ type: "dcode_project", project }, false);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load this source.");
          setPickerOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
    // Intentionally keyed on the query only — the hub re-resolves per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedType, requestedId]);

  /* Picker data — loaded lazily, shown only on explicit request. */
  useEffect(() => {
    if (!pickerOpen) return;
    setStudioAssets(listStudioMedia());
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [pickerOpen]);

  useEffect(() => {
    if (!copyResult) return;
    const timer = window.setTimeout(() => setCopyResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [copyResult]);

  useEffect(() => {
    if (!confirmingRevoke) return;
    const timer = window.setTimeout(() => setConfirmingRevoke(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingRevoke]);

  /* ------------------------------- derived ------------------------------ */

  const shareUrl = source && origin ? sourceShareUrl(source, origin) : null;
  const published = Boolean(shareUrl);

  /* Keep the draft's permalink in sync once the backend assigns one. */
  useEffect(() => {
    if (!shareUrl) return;
    setDraft((current) => (current.url === shareUrl ? current : { ...current, url: shareUrl }));
  }, [shareUrl]);

  const provider = providerById(active);
  const masterComposed = useMemo(
    () =>
      active === "instagram"
        ? [draft.caption.trim(), renderTags(draft.tags)].filter(Boolean).join("\n")
        : composeBody(draft.caption, draft.tags, ""),
    [active, draft.caption, draft.tags]
  );
  const variantText = variants[active] ?? masterComposed;
  const overLimit =
    provider.textLimit !== undefined && variantText.length > provider.textLimit;

  const imageOptions: ProjectImage[] = useMemo(() => {
    if (!source) return [];
    return source.type === "dcode_project"
      ? collectProjectImages(source.project.files)
      : [{ name: "studio-image.jpg", dataUrl: source.asset.imageUrl }];
  }, [source]);

  /** Draft whose caption is the active platform's final text (tags baked in). */
  const activeDraft: ShareDraft = useMemo(
    () => ({ ...draft, caption: variantText, tags: [], url: shareUrl ?? draft.url }),
    [draft, variantText, shareUrl]
  );

  const studioPublicImageUrl =
    source?.type === "studio_asset" && origin
      ? new URL(source.asset.imageUrl, origin).toString()
      : undefined;

  /* ------------------------------- actions ------------------------------ */

  const handlePublish = useCallback(async () => {
    if (!source || publishBusy) return;
    setPublishBusy("publish");
    try {
      if (source.type === "dcode_project") {
        const updated = await toggleProjectPublic(source.project.id, true);
        setSource({ type: "dcode_project", project: updated });
        toast.show({
          type: "success",
          title: "Published",
          message: "Anyone with the link can now view this project.",
        });
      } else {
        const shared = await shareStudioMedia(source.asset);
        const nextAsset = { ...source.asset, shareSlug: shared.slug };
        setSource({ type: "studio_asset", asset: nextAsset });
        // Mirror the slug into the local library so Library shows it too.
        saveStudioMedia(
          listStudioMedia().map((item) =>
            item.id === nextAsset.id ? { ...item, shareSlug: shared.slug } : item
          )
        );
        toast.show({
          type: "success",
          title: "Published",
          message: "Anyone with the link can view this Studio image and its prompt.",
        });
      }
    } catch (error) {
      toast.show({
        type: "error",
        title: "Publishing failed",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPublishBusy(null);
    }
  }, [source, publishBusy, toast]);

  const handleUnpublish = useCallback(async () => {
    if (!source || source.type !== "dcode_project" || publishBusy) return;
    setPublishBusy("unpublish");
    try {
      const updated = await toggleProjectPublic(source.project.id, false);
      setSource({ type: "dcode_project", project: updated });
      setShowQr(false);
      toast.show({
        type: "info",
        title: "Link revoked",
        message: "The project is private again — the old link no longer works.",
      });
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not revoke",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPublishBusy(null);
      setConfirmingRevoke(false);
    }
  }, [source, publishBusy, toast]);

  const handleRegenerate = useCallback(async () => {
    if (!source || source.type !== "dcode_project" || publishBusy) return;
    setPublishBusy("regenerate");
    try {
      const updated = await toggleProjectPublic(source.project.id, true);
      setSource({ type: "dcode_project", project: updated });
      toast.show({
        type: "success",
        title: "New link minted",
        message: "The previous link stopped working; the project stays public.",
      });
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not regenerate",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPublishBusy(null);
    }
  }, [source, publishBusy, toast]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    setCopying(true);
    try {
      setCopyResult((await copyText(shareUrl)) ? "copied" : "failed");
    } finally {
      setCopying(false);
    }
  }, [shareUrl]);

  const canDeviceShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleDeviceShare = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.share({
        title: draft.title,
        text: [draft.caption.trim(), renderTags(draft.tags)].filter(Boolean).join("\n\n"),
        url: shareUrl,
      });
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") {
        toast.show({
          type: "error",
          title: "Device share failed",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      }
    }
  }, [shareUrl, draft, toast]);

  /** Handoff: opens the platform composer prefilled. Never claims a post. */
  const handleOpenPlatform = useCallback(() => {
    if (!shareUrl) return;
    const builders: Partial<Record<ShareProviderId, (d: ShareDraft) => string>> = {
      x: buildXUrl,
      linkedin: buildLinkedInUrl,
      whatsapp: buildWhatsAppUrl,
    };
    const build = builders[active];
    if (!build) return;
    saveSharePrefs({ destination: active, caption: draft.caption, tags: draft.tags });
    window.open(build(activeDraft), "_blank", "noopener,noreferrer");
    toast.show({
      type: "info",
      title: `Opened ${provider.name}`,
      message: "Finish and confirm your post there — Dashy never posts for you.",
    });
  }, [shareUrl, active, activeDraft, draft, provider.name, toast]);

  /* ------------------------------ rendering ------------------------------ */

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-zinc-500">
        <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
        Loading your share source…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* Page header */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
            <ShareIcon className="h-3.5 w-3.5" /> Publishing cockpit
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            Share Hub
          </h1>
        </div>
        <p className="flex items-center gap-1.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3 py-2 text-[11px] text-emerald-300">
          <LockIcon className="h-3.5 w-3.5" /> Nothing publishes without your confirmation
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-5 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200"
        >
          <AlertIcon className="h-4 w-4 flex-shrink-0" /> {loadError}
        </div>
      )}

      <div className="space-y-6">
        {/* 01 — SOURCE */}
        <section aria-labelledby="share-source" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <SectionHeading id="share-source" step="01 · Source" title="What you're sharing" />
          {pickerOpen || !source ? (
            <div>
              <p className="text-xs text-zinc-500">
                Choose something to share. Only real sources in your workspace are listed.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    D-Code projects
                  </p>
                  {projects.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/[0.1] p-4 text-center text-xs text-zinc-500">
                      No D-Code projects yet — create one from D-Code or Projects.
                    </p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {projects.map((project) => (
                        <li key={project.id}>
                          <button
                            type="button"
                            onClick={() => adoptSource({ type: "dcode_project", project }, true)}
                            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition-colors hover:border-cyan-400/35 hover:bg-cyan-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                          >
                            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                              <CodeIcon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-zinc-100">
                                {project.title.trim() || "Untitled project"}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-zinc-500">
                                {project.files.length} {project.files.length === 1 ? "file" : "files"} · {project.language}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Studio images
                  </p>
                  {studioAssets.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/[0.1] p-4 text-center text-xs text-zinc-500">
                      Your Studio library is empty on this device —{" "}
                      <Link href="/studio" className="text-cyan-300 hover:text-cyan-200">
                        generate an image
                      </Link>{" "}
                      first.
                    </p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {studioAssets.slice(0, 8).map((asset) => (
                        <li key={asset.id}>
                          <button
                            type="button"
                            onClick={() => adoptSource({ type: "studio_asset", asset }, true)}
                            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-left transition-colors hover:border-cyan-400/35 hover:bg-cyan-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                          >
                            <span className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-black/40">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={asset.imageUrl}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-zinc-100">{asset.title}</span>
                              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                {asset.prompt}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {source && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="mt-4 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Keep sharing “{sourceTitle(source)}”
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {source.type === "studio_asset" ? (
                  <span className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl border border-white/[0.08] bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={source.asset.imageUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </span>
                ) : (
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
                    <CodeIcon className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{sourceTitle(source)}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {source.type === "dcode_project"
                      ? `D-Code project · ${source.project.files.length} ${
                          source.project.files.length === 1 ? "file" : "files"
                        } · ${source.project.language}`
                      : "Dashy Studio image"}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <Link
                  href={
                    source.type === "dcode_project"
                      ? `/d-code/${source.project.id}`
                      : "/studio/library"
                  }
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  <PenIcon className="h-3.5 w-3.5" />
                  {source.type === "dcode_project" ? "Open in D-Code" : "Open in Studio"}
                </Link>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex h-9 items-center rounded-lg border border-white/[0.1] bg-black/20 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  Change source
                </button>
              </div>
            </div>
          )}
        </section>

        {source && !pickerOpen && (
          <>
            {/* 02 — PLATFORMS */}
            <section aria-labelledby="share-platforms" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <SectionHeading
                id="share-platforms"
                step="02 · Platforms"
                title="Where it goes"
                hint="Only the selected platform's controls are shown below."
              />
              <div role="tablist" aria-label="Platform" className="flex flex-wrap gap-1.5">
                {PLATFORM_IDS.map((id) => {
                  const p = providerById(id);
                  const selected = active === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActive(id)}
                      className={`flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                        selected
                          ? "border-cyan-400/45 bg-cyan-400/[0.1] text-cyan-200"
                          : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                      }`}
                    >
                      <span style={{ color: p.accent }}>{p.icon}</span>
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                    provider.mode === "direct"
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                      : provider.mode === "handoff"
                        ? "border-amber-400/20 bg-amber-400/10 text-amber-300"
                        : "border-white/10 bg-white/[0.04] text-zinc-400"
                  }`}
                >
                  {modeLabel(provider.mode)}
                </span>
                {provider.warning ?? provider.description}
              </p>
            </section>

            {/* 03 — MASTER CAPTION */}
            <section aria-labelledby="share-caption" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <SectionHeading
                id="share-caption"
                step="03 · Master caption"
                title="One draft, every platform"
                hint="Platform variants below start from this."
              />
              <label className="block text-xs font-medium text-zinc-400">
                Caption
                <textarea
                  value={draft.caption}
                  onChange={(event) => setDraft((d) => ({ ...d, caption: event.target.value }))}
                  rows={3}
                  placeholder="Tell your audience what you made…"
                  className="mt-2 w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm leading-relaxed text-zinc-100 outline-none transition-colors focus:border-cyan-400/40"
                />
              </label>
              <label className="mt-4 block text-xs font-medium text-zinc-400">
                Tags
                <input
                  value={draft.tags.join(" ")}
                  onChange={(event) =>
                    setDraft((d) => ({
                      ...d,
                      tags: event.target.value.split(/[\s,]+/).filter(Boolean),
                    }))
                  }
                  placeholder="DashyCore DCode AI"
                  className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-400/40"
                />
              </label>
              {draft.tags.length > 0 && (
                <p className="mt-2 truncate text-[11px] text-cyan-400/80">{renderTags(draft.tags)}</p>
              )}
            </section>

            {/* 04 — MEDIA */}
            <section aria-labelledby="share-media" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <SectionHeading id="share-media" step="04 · Media" title="Attached image" />
              {imageOptions.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/[0.12] bg-black/10 px-4 py-3.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.03] text-zinc-600">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-xs font-medium text-zinc-300">No media in this source</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Link previews will use the page's Open Graph image instead.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {imageOptions.map((image) => {
                    const selected = draft.imageName === image.name;
                    return (
                      <button
                        key={image.name}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setDraft((d) =>
                            selected
                              ? { ...d, imageName: null, imageDataUrl: null }
                              : { ...d, imageName: image.name, imageDataUrl: image.dataUrl }
                          )
                        }
                        className={`group relative h-20 w-20 overflow-hidden rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                          selected ? "border-cyan-400/60" : "border-white/[0.1] hover:border-white/25"
                        }`}
                        title={selected ? `Detach ${image.name}` : `Attach ${image.name}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.dataUrl} alt={image.name} className="absolute inset-0 h-full w-full object-cover" />
                        {selected && (
                          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400 text-[#06202a]">
                            <CheckIcon className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 05 — PLATFORM VARIANTS */}
            <section
              ref={variantsRef}
              aria-labelledby="share-variants"
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionHeading id="share-variants" step="05 · Platform variant" title={`${provider.name} copy`} />
                <div className="flex items-center gap-3">
                  {variants[active] !== undefined && (
                    <button
                      type="button"
                      onClick={() =>
                        setVariants((all) => {
                          const next = { ...all };
                          delete next[active];
                          return next;
                        })
                      }
                      className="text-[11px] text-zinc-500 hover:text-zinc-200"
                    >
                      Reset to master
                    </button>
                  )}
                  <span
                    aria-live="polite"
                    className={`text-[11px] ${overLimit ? "font-semibold text-red-300" : "text-zinc-600"}`}
                  >
                    {variantText.length}
                    {provider.textLimit ? ` / ${provider.textLimit}` : " chars"}
                  </span>
                </div>
              </div>
              <textarea
                value={variantText}
                onChange={(event) => setVariants((all) => ({ ...all, [active]: event.target.value }))}
                rows={4}
                aria-label={`${provider.name} copy`}
                className={`w-full resize-y rounded-xl border bg-black/20 p-3 text-sm leading-relaxed text-zinc-100 outline-none transition-colors ${
                  overLimit ? "border-red-400/50 focus:border-red-400/70" : "border-white/[0.08] focus:border-cyan-400/40"
                }`}
              />
              {overLimit && (
                <p role="alert" className="mt-1.5 text-[11px] text-red-300">
                  Over {provider.name}'s {provider.textLimit}-character limit — trim before opening the composer.
                </p>
              )}
            </section>

            {/* 06 — PREVIEW */}
            <section aria-labelledby="share-preview" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <SectionHeading id="share-preview" step="06 · Preview" title={`As it appears on ${provider.name}`} />
              <div className="rounded-xl border border-white/[0.08] bg-black/25 p-4">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-bold text-cyan-300">
                    D
                  </span>
                  <div>
                    <p className="text-xs font-medium text-zinc-200">DashyCore</p>
                    <p className="text-[10px] text-zinc-600">Draft · {provider.name}</p>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                  {variantText || "Your post preview appears here."}
                </p>
                {draft.imageDataUrl && (
                  <div className="relative mt-3 h-40 w-full max-w-xs overflow-hidden rounded-lg border border-white/[0.08]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draft.imageDataUrl} alt="Attached media preview" className="absolute inset-0 h-full w-full object-cover" />
                  </div>
                )}
                <p className="mt-3 flex items-center gap-1.5 border-t border-white/[0.06] pt-2.5 text-[10px] uppercase tracking-wider text-zinc-600">
                  <LinkIcon className="h-3 w-3" />
                  {published ? "Public link attached" : "No public link yet — publish below"}
                  <span className="ml-auto normal-case tracking-normal">Preview only · nothing has been posted</span>
                </p>
              </div>
            </section>

            {/* 07 — PUBLISH */}
            <section aria-labelledby="share-publish" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <SectionHeading
                id="share-publish"
                step="07 · Publish"
                title="Real link, honest actions"
                hint="Published means the backend confirmed it — nothing less."
              />

              {/* Link status card */}
              <div
                className={`rounded-xl border ${
                  published ? "border-cyan-400/25 bg-cyan-400/[0.05]" : "border-amber-400/25 bg-amber-400/[0.05]"
                }`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                      published ? "bg-cyan-400/15 text-cyan-300" : "bg-amber-400/15 text-amber-300"
                    }`}
                  >
                    {published ? <GlobeIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-zinc-100">
                      {published
                        ? "Published — public link is live"
                        : source.type === "dcode_project"
                          ? "Not published — the project is private"
                          : "Not published — this image has no public link yet"}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                      {published
                        ? "Anyone with the link can view it. Copy it or hand it to a platform below."
                        : "Create the public link first — platform posts need a URL that actually works."}
                    </p>
                  </div>
                  {!published && (
                    <button
                      type="button"
                      onClick={() => void handlePublish()}
                      disabled={publishBusy !== null}
                      className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-colors hover:bg-cyan-400 disabled:opacity-50"
                    >
                      {publishBusy === "publish" ? (
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <GlobeIcon className="h-3.5 w-3.5" />
                      )}
                      Publish link
                    </button>
                  )}
                </div>

                {published && shareUrl && (
                  <>
                    <div className="flex items-center gap-2 border-t border-white/[0.06] bg-black/20 px-4 py-3">
                      <input
                        aria-label="Public share link"
                        readOnly
                        value={shareUrl}
                        onFocus={(event) => event.currentTarget.select()}
                        className="min-w-0 flex-1 truncate bg-transparent font-mono text-[11px] text-zinc-400 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopyLink()}
                        disabled={copying}
                        className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20 disabled:opacity-40"
                      >
                        {copying ? (
                          <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                        ) : copyResult === "copied" ? (
                          <CheckIcon className="h-3.5 w-3.5" />
                        ) : (
                          <CopyIcon className="h-3.5 w-3.5" />
                        )}
                        {copyResult === "copied" ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowQr((v) => !v)}
                        aria-expanded={showQr}
                        className={`flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${
                          showQr
                            ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                            : "border-white/[0.1] bg-white/[0.03] text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-300"
                        }`}
                      >
                        QR
                      </button>
                      {canDeviceShare && (
                        <button
                          type="button"
                          onClick={() => void handleDeviceShare()}
                          title="Open your device's share sheet"
                          className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                        >
                          <ShareIcon className="h-3.5 w-3.5" />
                          Device
                        </button>
                      )}
                    </div>
                    {copyResult === "failed" && (
                      <p role="status" className="border-t border-white/[0.06] px-4 py-2 text-[11px] text-amber-300">
                        Copy failed. Select the link above to copy it manually.
                      </p>
                    )}
                    {showQr && (
                      <div className="flex flex-col items-center border-t border-white/[0.06] px-4 py-4">
                        <ShareQr value={shareUrl} />
                        <p className="mt-2 text-[11px] text-zinc-500">Scan to open the public page</p>
                      </div>
                    )}
                    {source.type === "dcode_project" && (
                      <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void handleRegenerate()}
                          disabled={publishBusy !== null}
                          title="Mint a fresh link — the old one stops working"
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-40"
                        >
                          {publishBusy === "regenerate" ? (
                            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshIcon className="h-3.5 w-3.5" />
                          )}
                          Regenerate link
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirmingRevoke) void handleUnpublish();
                            else setConfirmingRevoke(true);
                          }}
                          disabled={publishBusy !== null}
                          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                            confirmingRevoke
                              ? "border-red-400/50 bg-red-500/15 text-red-200"
                              : "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-red-400/40 hover:text-red-300"
                          }`}
                        >
                          {publishBusy === "unpublish" ? (
                            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <TrashIcon className="h-3.5 w-3.5" />
                          )}
                          {confirmingRevoke ? "Click again to revoke" : "Revoke & make private"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Per-platform action — honest by construction. */}
              <div className="mt-4">
                {active === "instagram" || active === "facebook" ? (
                  <MetaExportCards
                    draft={{ ...draft, url: shareUrl ?? draft.url }}
                    onCustomize={(appId) => {
                      setActive(appId);
                      variantsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                    publicImageUrl={studioPublicImageUrl}
                  />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/15 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-100">
                        {published ? "Ready to share" : "Waiting for the public link"}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                        {published
                          ? `Opens ${provider.name}'s composer prefilled — you confirm the post there.`
                          : `Publish the link above, then hand off to ${provider.name}.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenPlatform}
                      disabled={!published || overLimit}
                      className="flex h-10 flex-shrink-0 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowUpRightIcon className="h-3.5 w-3.5" />
                      Open {provider.name}
                    </button>
                  </div>
                )}
                <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-relaxed text-zinc-600">
                  <SparklesIcon className="h-3.5 w-3.5 flex-shrink-0" />
                  Handoffs open the platform with your draft — they are never reported as published.
                  Direct publishing stays behind explicit confirmation.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
