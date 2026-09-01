/**
 * DashyCore v7 — Share Composer intents.
 *
 * Pure, DOM-free helpers for the per-app Share Composers: the app grid
 * config (field visibility, brand accent, CTA copy), message/content
 * builders, and per-app share-URL builders.
 *
 * HONESTY NOTE: none of these perform real posting. Every builder returns a
 * deep-link intent (wa.me, twitter.com/intent, mailto, …) that opens the
 * target app with a pre-filled draft, or a copy action the user pastes
 * themselves (Instagram / YouTube). There is intentionally NO "Posted!"
 * fake-success anywhere in this module.
 */

import type { DCodeFile } from "@/lib/dcode";

/* ---------------------------------------------------------------------- */
/* Types                                                                   */
/* ---------------------------------------------------------------------- */

export type ShareAppId =
  | "whatsapp"
  | "facebook"
  | "x"
  | "telegram"
  | "linkedin"
  | "reddit"
  | "email"
  | "instagram"
  | "youtube";

/** The editable state shared by every composer. */
export interface ShareDraft {
  title: string;
  caption: string;
  tags: string[];
  url: string;
  /** Project image file name used for the preview + FB Open Graph image. */
  imageName: string | null;
  /** Base64 data URL for in-UI previews (Dashy logo when imageName is null). */
  imageDataUrl: string | null;
}

/** A project image surfaced in the image picker. */
export interface ProjectImage {
  name: string;
  dataUrl: string;
}

export type ShareMode = "navigate" | "copy";

export interface ShareFieldConfig {
  showTitle: boolean;
  showCaption: boolean;
  showTags: boolean;
  showImage: boolean;
}

export interface ShareAppConfig {
  id: ShareAppId;
  name: string;
  /** Brand accent (hex) — subtle tint over the DashyCore dark-glass theme. */
  accent: string;
  /** Softer badge tint (hex) for the header chip / app tile. */
  badge: string;
  ctaLabel: string;
  mode: ShareMode;
  /** Optional helper line shown under the CTA. */
  helper?: string;
  /** Secondary copy action label for copy-mode apps (IG/YT). */
  copyLabel?: string;
  /** Optional per-app char budget shown with a live counter. */
  charBudget?: number;
  fields: ShareFieldConfig;
}

/* ---------------------------------------------------------------------- */
/* App grid / composer config                                              */
/* ---------------------------------------------------------------------- */

export const SHARE_APPS: ShareAppConfig[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    accent: "#25D366",
    badge: "#25D366",
    ctaLabel: "Send on WhatsApp",
    mode: "navigate",
    fields: {
      showTitle: true,
      showCaption: true,
      showTags: true,
      showImage: true,
    },
  },
  {
    id: "facebook",
    name: "Facebook",
    accent: "#1877F2",
    badge: "#1877F2",
    ctaLabel: "Share on Facebook",
    mode: "navigate",
    helper: "Facebook pulls title & image from the link preview",
    fields: {
      showTitle: true,
      showCaption: true,
      showTags: true,
      showImage: true,
    },
  },
  {
    id: "x",
    name: "X (Twitter)",
    accent: "#1DA1F2",
    badge: "#1DA1F2",
    ctaLabel: "Post on X",
    mode: "navigate",
    charBudget: 280,
    fields: {
      showTitle: false,
      showCaption: true,
      showTags: true,
      showImage: true,
    },
  },
  {
    id: "telegram",
    name: "Telegram",
    accent: "#229ED9",
    badge: "#229ED9",
    ctaLabel: "Send on Telegram",
    mode: "navigate",
    fields: {
      showTitle: false,
      showCaption: true,
      showTags: true,
      showImage: true,
    },
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    accent: "#0A66C2",
    badge: "#0A66C2",
    ctaLabel: "Share on LinkedIn",
    mode: "navigate",
    helper: "LinkedIn reads the link — put your pitch in the caption",
    fields: {
      showTitle: false,
      showCaption: true,
      showTags: true,
      showImage: true,
    },
  },
  {
    id: "reddit",
    name: "Reddit",
    accent: "#FF4500",
    badge: "#FF4500",
    ctaLabel: "Submit to Reddit",
    mode: "navigate",
    fields: {
      showTitle: true,
      showCaption: true,
      showTags: false,
      showImage: false,
    },
  },
  {
    id: "email",
    name: "Email",
    accent: "#EA4335",
    badge: "#EA4335",
    ctaLabel: "Open Email App",
    mode: "navigate",
    fields: {
      showTitle: true,
      showCaption: true,
      showTags: true,
      showImage: false,
    },
  },
  {
    id: "instagram",
    name: "Instagram",
    accent: "#E1306C",
    badge: "#E1306C",
    ctaLabel: "Copy caption",
    copyLabel: "Open instagram.com",
    mode: "copy",
    helper:
      "Instagram has no web share intent. Copy the caption, paste it into a Story / post / DM, and attach the image manually.",
    fields: {
      showTitle: false,
      showCaption: true,
      showTags: true,
      showImage: true,
    },
  },
  {
    id: "youtube",
    name: "YouTube",
    accent: "#FF0000",
    badge: "#FF0000",
    ctaLabel: "Copy description",
    copyLabel: "Copy title",
    mode: "copy",
    helper:
      "No upload API — copy the title & description and paste them in YouTube Studio when you upload.",
    fields: {
      showTitle: true,
      showCaption: true,
      showTags: true,
      showImage: false,
    },
  },
];

export const SHARE_APP_MAP: Record<ShareAppId, ShareAppConfig> = SHARE_APPS.reduce(
  (acc, app) => {
    acc[app.id] = app;
    return acc;
  },
  {} as Record<ShareAppId, ShareAppConfig>
);

/* ---------------------------------------------------------------------- */
/* Tags                                                                   */
/* ---------------------------------------------------------------------- */

/** Normalises a raw tag into a `#slug` (letters/digits/underscore). */
export function tagSlug(raw: string): string {
  const clean = raw
    .trim()
    .replace(/^#/, "")
    .replace(/[^\w\d]/g, "");
  return clean ? `#${clean}` : "";
}

/** Renders stored tags as space-separated `#tag` strings. */
export function renderTags(tags: string[]): string {
  return tags.map(tagSlug).filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------------- */
/* Project image picker                                                    */
/* ---------------------------------------------------------------------- */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * Lists previewable image files from the project (read-only use of the D-Code
 * file payload — we never mutate Monaco state). SVG files are stored as plain
 * text, so they are wrapped into a data URL for <img> previews.
 */
export function collectProjectImages(
  files: Array<Pick<DCodeFile, "name" | "content">>
): ProjectImage[] {
  const out: ProjectImage[] = [];
  for (const file of files) {
    if (!IMAGE_EXT.test(file.name)) continue;
    const content = file.content ?? "";
    if (/\.svg$/i.test(file.name) && !content.startsWith("data:")) {
      // SVG is text in D-Code; encode it so the picker can render it.
      try {
        out.push({
          name: file.name,
          dataUrl: `data:image/svg+xml;base64,${btoa(
            unescape(encodeURIComponent(content))
          )}`,
        });
      } catch {
        // Skip un-encodable SVGs — they can't preview anyway.
      }
      continue;
    }
    if (content.startsWith("data:image/")) {
      out.push({ name: file.name, dataUrl: content });
    }
  }
  return out;
}

/** Smart defaults for a fresh composer: title/caption/tags/url/image. */
export function makeDefaultDraft(
  title: string,
  url: string,
  images: ProjectImage[]
): ShareDraft {
  const first = images[0] ?? null;
  return {
    title: title || "Untitled project",
    caption: "Built with DashyCore D-Code ⚡",
    tags: ["DashyCore", "DCode", "AI"],
    url,
    imageName: first?.name ?? null,
    imageDataUrl: first?.dataUrl ?? null,
  };
}

/* ---------------------------------------------------------------------- */
/* Content builders                                                        */
/* ---------------------------------------------------------------------- */

/** caption + tags + url (each on its own line when non-empty). */
export function composeBody(
  caption: string,
  tags: string[],
  url: string
): string {
  const parts = [caption.trim(), renderTags(tags), url];
  return parts.filter(Boolean).join("\n");
}

/** X/Twitter text, hard-truncated to stay at/under the char budget. */
export function buildXText(
  caption: string,
  tags: string[],
  url: string,
  budget = 280
): string {
  const text = composeBody(caption, tags, url);
  if (text.length <= budget) return text;
  return text.slice(0, Math.max(0, budget - 1)) + "…";
}

/** Instagram caption (title banner + caption + tags — no URL needed). */
export function buildInstagramCaption(draft: ShareDraft): string {
  const banner = draft.title.trim() ? `✨ ${draft.title.trim()}` : "";
  return [banner, draft.caption.trim(), renderTags(draft.tags)]
    .filter(Boolean)
    .join("\n");
}

export function buildYouTubeTitle(draft: ShareDraft): string {
  return draft.title.trim() || "DashyCore D-Code project";
}

export function buildYouTubeDescription(draft: ShareDraft): string {
  return [draft.caption.trim(), renderTags(draft.tags), draft.url]
    .filter(Boolean)
    .join("\n");
}

/* ---------------------------------------------------------------------- */
/* Share URL builders                                                      */
/* ---------------------------------------------------------------------- */

export function buildWhatsAppUrl(draft: ShareDraft): string {
  const text = [
    draft.title.trim(),
    draft.caption.trim(),
    renderTags(draft.tags),
    draft.url,
  ]
    .filter(Boolean)
    .join("\n");
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildXUrl(draft: ShareDraft): string {
  const text = buildXText(draft.caption, draft.tags, draft.url, 280);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function buildTelegramUrl(draft: ShareDraft): string {
  const params = new URLSearchParams({ url: draft.url });
  const text = [draft.caption.trim(), renderTags(draft.tags)]
    .filter(Boolean)
    .join(" ");
  if (text) params.set("text", text);
  return `https://t.me/share/url?${params.toString()}`;
}

export function buildLinkedInUrl(draft: ShareDraft): string {
  // LinkedIn's share-offsite intent only carries a URL; the caption stays in
  // the composer/copy so the user can paste it into the post composer.
  const params = new URLSearchParams({ url: draft.url });
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
}

export function buildRedditUrl(draft: ShareDraft): string {
  const params = new URLSearchParams({ url: draft.url, title: draft.title });
  return `https://www.reddit.com/submit?${params.toString()}`;
}

export function buildMailto(draft: ShareDraft): string {
  const params = new URLSearchParams({
    subject: draft.title,
    body: composeBody(draft.caption, draft.tags, draft.url),
  });
  return `mailto:?${params.toString()}`;
}

/**
 * facebook.com/sharer ONLY accepts a URL — title/description/image are pulled
 * from the Open Graph tags of the shared page. So we build a public share URL
 * carrying the draft as query params (`title`, `desc`, `img`, `v`); the share
 * page's `generateMetadata` turns those into OG tags that Facebook crawls.
 * See app/d-code/share/[share_slug]/page.tsx.
 */
export function buildFacebookShareUrl(ogUrl: string): string {
  const params = new URLSearchParams({ u: ogUrl });
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

/** Public share URL + draft params for Open Graph (used by FB + previews). */
export function buildOgShareUrl(
  baseUrl: string,
  opts: { title?: string; desc?: string; imageName?: string | null }
): string {
  const url = new URL(baseUrl);
  if (opts.title?.trim()) url.searchParams.set("title", opts.title.trim());
  if (opts.desc?.trim()) url.searchParams.set("desc", opts.desc.trim());
  if (opts.imageName) url.searchParams.set("img", opts.imageName);
  // Cache-bust so a re-share with new meta re-crawls instead of reusing old OG.
  url.searchParams.set("v", String(Date.now()));
  return url.toString();
}

/** Dashy logo used as the fallback preview/OG image. */
export const DASHY_LOGO = "/icon-512.png";
