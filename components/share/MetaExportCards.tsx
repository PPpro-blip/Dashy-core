"use client";

/**
 * DashyCore v7 — Meta export cards (Instagram + Facebook) inside the Share Hub.
 *
 * Two modes, switchable per visit (the choice is remembered):
 *
 *   STANDARD — no setup. Copies the caption, then opens Meta's own surface:
 *     · Facebook → facebook.com/sharer with the OG-decorated share link (the
 *       preview card comes from app/s/[slug] `generateMetadata`); paste the
 *       copied caption into the post.
 *     · Instagram → instagram.com (Instagram has no web share intent), plus a
 *       one-tap download of the project image to attach.
 *
 *   DIRECT API PRO — publishes through the Meta Graph API with the token saved
 *     in Settings → Meta Share (this browser only; see lib/meta-graph). Every
 *     publish is a two-step confirm — nothing is ever posted without a click.
 *
 * Standard actions are real `<a target="_blank">` links (never pop-up blocked);
 * the caption is copied in the same click.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildFacebookShareUrl,
  buildInstagramCaption,
  buildOgShareUrl,
  renderTags,
  type ShareDraft,
} from "@/lib/share-intents";
import { copyText } from "@/lib/clipboard";
import {
  fetchMetaProfile,
  INSTAGRAM_CAPTION_LIMIT,
  isPubliclyReachableUrl,
  looksLikeJpeg,
  META_CHANGED_EVENT,
  publishToFacebook,
  publishToInstagram,
  readMetaToken,
  readSelectedPageId,
  writeSelectedPageId,
  type MetaProfile,
  type MetaPublishResult,
  type MetaPublishTarget,
} from "@/lib/meta-graph";
import { useToast } from "@/components/Toast";
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FacebookIcon,
  InstagramIcon,
  KeyIcon,
  LoaderIcon,
  PenIcon,
  RefreshIcon,
} from "@/components/icons";

type MetaMode = "standard" | "pro";

const MODE_STORAGE_KEY = "dashy.meta.mode";
const CONFIRM_WINDOW_MS = 4000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MetaExportCardsProps {
  draft: ShareDraft;
  /** Opens the full per-app composer (title / caption / tags / image). */
  onCustomize: (appId: MetaPublishTarget) => void;
}

/** `/s/<key>` or `/d-code/share/<key>` → key (slug or project uuid). */
function shareKeyFromUrl(value: string): string | null {
  try {
    const match = /^\/(?:s|d-code\/share)\/([^/]+)\/?$/.exec(new URL(value).pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function readStoredMode(): MetaMode {
  if (typeof window === "undefined") return "standard";
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === "pro" ? "pro" : "standard";
  } catch {
    return "standard";
  }
}

export function MetaExportCards({ draft, onCustomize }: MetaExportCardsProps) {
  const toast = useToast();
  const [mode, setMode] = useState<MetaMode>("standard");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<MetaProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [pageId, setPageId] = useState("");
  const [igImageUrl, setIgImageUrl] = useState("");
  const [igImageEdited, setIgImageEdited] = useState(false);
  const [confirming, setConfirming] = useState<MetaPublishTarget | null>(null);
  const [publishing, setPublishing] = useState<MetaPublishTarget | null>(null);
  const [results, setResults] = useState<Partial<Record<MetaPublishTarget, MetaPublishResult>>>({});

  // Mode + token are browser-only state: read after mount, keep in sync.
  useEffect(() => {
    setMode(readStoredMode());
    const sync = () => {
      setToken(readMetaToken());
      setPageId(readSelectedPageId());
    };
    sync();
    window.addEventListener(META_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(META_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const changeMode = useCallback((next: MetaMode) => {
    setMode(next);
    setConfirming(null);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Not remembered — fine.
    }
  }, []);

  /* ------------------------------ derived copy ----------------------------- */

  const shareKey = useMemo(() => shareKeyFromUrl(draft.url), [draft.url]);
  const origin = useMemo(() => {
    try {
      return new URL(draft.url).origin;
    } catch {
      return "";
    }
  }, [draft.url]);

  /** OG-decorated link: the preview card reflects the draft's title/caption/image. */
  const ogLink = useMemo(() => {
    if (!draft.url) return "";
    try {
      return buildOgShareUrl(draft.url, {
        title: draft.title,
        desc: draft.caption,
        imageName: draft.imageName,
      });
    } catch {
      return draft.url;
    }
  }, [draft.caption, draft.imageName, draft.title, draft.url]);

  const facebookMessage = useMemo(
    () => [draft.caption.trim(), renderTags(draft.tags)].filter(Boolean).join("\n\n"),
    [draft.caption, draft.tags]
  );
  const instagramCaption = useMemo(() => buildInstagramCaption(draft), [draft]);

  /** Public URL of the chosen project image (served by the og-image route). */
  const projectImageUrl = useMemo(() => {
    if (!draft.imageName || !shareKey || UUID_RE.test(shareKey) || !origin) return "";
    return `${origin}/d-code/share/${encodeURIComponent(shareKey)}/og-image?file=${encodeURIComponent(
      draft.imageName
    )}`;
  }, [draft.imageName, origin, shareKey]);

  // Follow the draft's image until the user types their own URL.
  useEffect(() => {
    if (!igImageEdited) setIgImageUrl(projectImageUrl);
  }, [igImageEdited, projectImageUrl]);

  /* ------------------------------ Pro: profile ----------------------------- */

  const loadProfile = useCallback(async () => {
    const current = readMetaToken();
    if (!current) return;
    setLoadingProfile(true);
    setProfileError(null);
    try {
      const loaded = await fetchMetaProfile(current);
      setProfile(loaded);
      const remembered = readSelectedPageId();
      const pick =
        loaded.pages.find((page) => page.id === remembered) ??
        loaded.pages.find((page) => page.instagramUserId) ??
        loaded.pages[0];
      setPageId(pick?.id ?? "");
    } catch (error) {
      setProfile(null);
      setProfileError(error instanceof Error ? error.message : "Could not load your Pages.");
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      // Token removed in Settings: forget the Pages it could reach.
      setProfile(null);
      setProfileError(null);
      return;
    }
    if (mode !== "pro") return;
    setProfile(null);
    void loadProfile();
  }, [loadProfile, mode, token]);

  const page = token ? (profile?.pages.find((candidate) => candidate.id === pageId) ?? null) : null;

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  /* ------------------------------- actions -------------------------------- */

  const copyFor = useCallback(
    (target: MetaPublishTarget) => {
      const text = target === "instagram" ? instagramCaption : facebookMessage;
      void copyText(text).then((copied) => {
        toast.show(
          copied
            ? {
                type: "success",
                title: "Caption copied",
                message:
                  target === "instagram"
                    ? "Paste it into your Instagram post and attach the image."
                    : "Paste it into the Facebook post — the link preview is automatic.",
              }
            : {
                type: "error",
                title: "Could not copy the caption",
                message: "Select it from the composer (Customize) and copy manually.",
              }
        );
      });
    },
    [facebookMessage, instagramCaption, toast]
  );

  const publish = useCallback(
    async (target: MetaPublishTarget) => {
      if (!page || publishing) return;
      if (confirming !== target) {
        setConfirming(target);
        return;
      }
      setConfirming(null);
      setPublishing(target);
      setResults((previous) => ({ ...previous, [target]: undefined }));
      const result =
        target === "facebook"
          ? await publishToFacebook({ page, message: facebookMessage, link: ogLink || draft.url })
          : await publishToInstagram({ page, caption: instagramCaption, imageUrl: igImageUrl });
      setResults((previous) => ({ ...previous, [target]: result }));
      setPublishing(null);
      if (result.ok) {
        toast.success(
          target === "facebook" ? "Posted to Facebook" : "Posted to Instagram",
          target === "facebook" ? page.name : `@${page.instagramUsername ?? page.name}`
        );
      } else {
        toast.error("Meta rejected the post", result.error);
      }
    },
    [confirming, draft.url, facebookMessage, igImageUrl, instagramCaption, ogLink, page, publishing, toast]
  );

  /* -------------------------------- render -------------------------------- */

  const igPublicProblem =
    igImageUrl && !isPubliclyReachableUrl(igImageUrl)
      ? "Meta cannot download from a local address — deploy DashyCore or paste any public JPEG URL."
      : null;
  const igJpegHint =
    igImageUrl && !looksLikeJpeg(igImageUrl) && !looksLikeJpeg(draft.imageName ?? "")
      ? "Instagram only accepts JPEG images — PNG, WebP or SVG will be rejected by Meta."
      : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Meta export
        </p>
        <div
          role="tablist"
          aria-label="Meta export mode"
          className="flex rounded-lg border border-white/[0.08] bg-black/25 p-0.5"
        >
          {(
            [
              ["standard", "Standard"],
              ["pro", "Direct API Pro"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => changeMode(value)}
              className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                mode === value
                  ? value === "pro"
                    ? "bg-gradient-to-r from-[#1877F2]/30 to-[#E1306C]/30 text-white"
                    : "bg-white/[0.1] text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "pro" && (
        <ProStatus
          token={token}
          profile={profile}
          loading={loadingProfile}
          error={profileError}
          pageId={pageId}
          onRetry={() => void loadProfile()}
          onSelectPage={(id) => {
            setPageId(id);
            writeSelectedPageId(id);
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* ----------------------------- Instagram ----------------------------- */}
        <MetaCard
          accent="#E1306C"
          icon={<InstagramIcon className="h-4 w-4" />}
          name="Instagram"
          sub={
            mode === "pro"
              ? page?.instagramUsername
                ? `@${page.instagramUsername}`
                : "Professional account"
              : "Copy caption · open Instagram"
          }
          preview={instagramCaption}
          limit={INSTAGRAM_CAPTION_LIMIT}
        >
          {mode === "standard" ? (
            <>
              <a
                href="https://www.instagram.com/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => copyFor("instagram")}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737] px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-pink-500/15 transition-opacity hover:opacity-90"
              >
                Copy caption &amp; open Instagram
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
              <div className="flex gap-1.5">
                {draft.imageDataUrl && draft.imageName ? (
                  <a
                    href={draft.imageDataUrl}
                    download={draft.imageName}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
                  >
                    <DownloadIcon className="h-3 w-3" />
                    Image
                  </a>
                ) : null}
                <CustomizeButton onClick={() => onCustomize("instagram")} />
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-600">
                Instagram has no web share link — paste the caption into a new
                post and attach the image.
              </p>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-zinc-500">
                  Public JPEG image URL
                </span>
                <input
                  type="url"
                  value={igImageUrl}
                  onChange={(event) => {
                    setIgImageEdited(true);
                    setIgImageUrl(event.target.value);
                  }}
                  placeholder="https://…/photo.jpg"
                  spellCheck={false}
                  className="w-full rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1.5 font-mono text-[10px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-pink-400/50"
                />
              </label>
              {igPublicProblem || igJpegHint ? (
                <p className="flex items-start gap-1 text-[10px] leading-relaxed text-amber-300/90">
                  <AlertIcon className="mt-px h-3 w-3 flex-shrink-0" />
                  {igPublicProblem ?? igJpegHint}
                </p>
              ) : null}
              <PublishButton
                target="instagram"
                label={
                  page?.instagramUsername ? `Publish to @${page.instagramUsername}` : "Publish to Instagram"
                }
                disabled={!page || !page.instagramUserId || !igImageUrl.trim() || Boolean(igPublicProblem)}
                disabledReason={
                  !page
                    ? "Pick a Page first"
                    : !page.instagramUserId
                      ? "This Page has no linked Instagram professional account"
                      : !igImageUrl.trim()
                        ? "Add a public JPEG image URL"
                        : igPublicProblem ?? undefined
                }
                confirming={confirming === "instagram"}
                publishing={publishing === "instagram"}
                onClick={() => void publish("instagram")}
              />
              <PublishResultLine result={results.instagram} />
            </>
          )}
        </MetaCard>

        {/* ----------------------------- Facebook ------------------------------ */}
        <MetaCard
          accent="#1877F2"
          icon={<FacebookIcon className="h-4 w-4" />}
          name="Facebook"
          sub={mode === "pro" ? (page ? page.name : "Page feed") : "Copy caption · Meta web share"}
          preview={facebookMessage || "(no caption — the link preview carries the post)"}
        >
          {mode === "standard" ? (
            <>
              <a
                href={ogLink ? buildFacebookShareUrl(ogLink) : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!ogLink}
                onClick={(event) => {
                  if (!ogLink) {
                    event.preventDefault();
                    return;
                  }
                  copyFor("facebook");
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl bg-[#1877F2] px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-blue-500/15 transition-opacity hover:opacity-90 ${
                  ogLink ? "" : "pointer-events-none opacity-40"
                }`}
              >
                Copy caption &amp; open Facebook
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
              <div className="flex gap-1.5">
                <CustomizeButton onClick={() => onCustomize("facebook")} />
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-600">
                Facebook&apos;s sharer only takes the link — its preview card comes
                from this page&apos;s Open Graph tags. Paste the caption above it.
              </p>
            </>
          ) : (
            <>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Posts the caption with the share link attached; Facebook renders
                the link preview from its Open Graph tags.
              </p>
              <PublishButton
                target="facebook"
                label={page ? `Publish to ${page.name}` : "Publish to Facebook"}
                disabled={!page || !draft.url}
                disabledReason={!page ? "Pick a Page first" : !draft.url ? "Make the project public first" : undefined}
                confirming={confirming === "facebook"}
                publishing={publishing === "facebook"}
                onClick={() => void publish("facebook")}
              />
              <PublishResultLine result={results.facebook} />
            </>
          )}
        </MetaCard>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function MetaCard({
  accent,
  icon,
  name,
  sub,
  preview,
  limit,
  children,
}: {
  accent: string;
  icon: React.ReactNode;
  name: string;
  sub: string;
  preview: string;
  limit?: number;
  children: React.ReactNode;
}) {
  const over = limit !== undefined && preview.length > limit;
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border bg-white/[0.02] p-3"
      style={{ borderColor: `${accent}40` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}22`, color: accent, boxShadow: `0 0 0 1px ${accent}55` }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-zinc-100">{name}</p>
          <p className="truncate text-[10px] text-zinc-500">{sub}</p>
        </div>
      </div>
      <p className="line-clamp-3 whitespace-pre-line rounded-lg border border-white/[0.05] bg-black/20 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-400">
        {preview}
      </p>
      {limit !== undefined ? (
        <p className={`-mt-1 text-right text-[9px] ${over ? "text-red-300" : "text-zinc-600"}`}>
          {preview.length}/{limit}
          {over ? " — will be trimmed" : ""}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function CustomizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
    >
      <PenIcon className="h-3 w-3" />
      Customize
    </button>
  );
}

function PublishButton({
  target,
  label,
  disabled,
  disabledReason,
  confirming,
  publishing,
  onClick,
}: {
  target: MetaPublishTarget;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  confirming: boolean;
  publishing: boolean;
  onClick: () => void;
}) {
  const tone =
    target === "instagram"
      ? "from-[#833AB4] via-[#E1306C] to-[#F77737]"
      : "from-[#1877F2] to-[#1877F2]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || publishing}
      title={disabled ? disabledReason : confirming ? "Click again to publish for real" : label}
      className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        confirming
          ? "bg-amber-500 text-[#231400] ring-2 ring-amber-300/50"
          : `bg-gradient-to-r ${tone} hover:opacity-90`
      }`}
    >
      {publishing ? <LoaderIcon className="h-3.5 w-3.5 animate-spin" /> : null}
      {publishing ? "Publishing…" : confirming ? "Click again to confirm" : label}
    </button>
  );
}

function PublishResultLine({ result }: { result: MetaPublishResult | undefined }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-2 py-1.5 text-[10px] leading-relaxed text-red-200">
        {result.error}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[10px] text-emerald-300">
      <CheckIcon className="h-3 w-3" />
      Published
      {result.permalink ? (
        <a
          href={result.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 inline-flex items-center gap-0.5 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200"
        >
          view post <ExternalLinkIcon className="h-2.5 w-2.5" />
        </a>
      ) : null}
    </p>
  );
}

function ProStatus({
  token,
  profile,
  loading,
  error,
  pageId,
  onRetry,
  onSelectPage,
}: {
  token: string;
  profile: MetaProfile | null;
  loading: boolean;
  error: string | null;
  pageId: string;
  onRetry: () => void;
  onSelectPage: (id: string) => void;
}) {
  if (!token) {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
        <KeyIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Direct API Pro publishes with your own Meta Graph token.{" "}
          <a
            href="/settings#meta"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-cyan-300 underline decoration-cyan-400/40 underline-offset-2 hover:text-cyan-200"
          >
            Add it in Settings → Meta Share
          </a>
          . Standard mode needs nothing.
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <p className="mb-2 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-[11px] text-zinc-400">
        <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
        Loading your Pages from Meta…
      </p>
    );
  }
  if (error) {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2.5">
        <AlertIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-300" />
        <p className="flex-1 text-[11px] leading-relaxed text-red-200">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          title="Retry"
          aria-label="Retry loading Pages"
          className="rounded-md p-1 text-red-200 transition-colors hover:bg-red-500/15"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  if (!profile) return null;
  if (profile.pages.length === 0) {
    return (
      <p className="mb-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
        Connected as {profile.name}, but this token manages no Facebook Pages —
        there is nowhere to publish yet.
      </p>
    );
  }
  return (
    <label className="mb-2 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2">
      <span className="text-[10px] font-medium text-zinc-500">Publish as</span>
      <select
        value={pageId}
        onChange={(event) => onSelectPage(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#0a0e1a] px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-cyan-400/50"
      >
        {profile.pages.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
            {candidate.instagramUsername ? ` · @${candidate.instagramUsername}` : " · no Instagram"}
          </option>
        ))}
      </select>
    </label>
  );
}
