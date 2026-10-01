/**
 * DashyCore v7 — dynamic Open Graph metadata for public D-Code share links.
 *
 * Shared by both public routes:
 *   - app/s/[slug]              the short link every Share Hub action copies
 *   - app/d-code/share/[slug]   the canonical read-only viewer
 *
 * Field precedence (title, description, image):
 *   1. The owner's composer draft, carried as `?title=&desc=&img=` query
 *      params (lib/share-intents#buildOgShareUrl) — Facebook's sharer only
 *      takes a URL, so this is how a customised preview reaches it.
 *   2. The project row itself: title, description, a file/language summary,
 *      and its largest raster image (served by the /og-image route).
 *   3. Branded defaults (/share-card.png).
 *
 * Privacy: middleware answers private or missing projects with a static 403
 * before any page renders. This lookup additionally mirrors /api/share/[key]
 * — a cookie-bound read where RLS applies, then a service-role read
 * HARD-FILTERED to `is_public = true` — so metadata can never describe a
 * project the requester is not allowed to open.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isLinkPreviewUserAgent } from "@/lib/link-preview-bots.mjs";

export type ShareSearchParams = Record<string, string | string[] | undefined>;

/** What the metadata needs from a project row (never file contents). */
export interface ShareOgProject {
  title: string;
  description: string | null;
  shareSlug: string | null;
  fileCount: number;
  /** Display names, most-used first. */
  languages: string[];
  /** Largest raster image in the project, if one is usable as a preview. */
  imageName: string | null;
}

export interface ResolvedShareOg {
  title: string;
  description: string;
  /** Absolute image URL for og:image / twitter:image. */
  imageUrl: string;
  /** False when falling back to the branded 1200×630 share card. */
  isProjectImage: boolean;
  /** Absolute URL of the link being shared (og:url). */
  url: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT_COLUMNS = "title, description, files, share_slug";
const RASTER_IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
/** Skip favicons / sprites — a preview image should have some substance. */
const MIN_PREVIEW_IMAGE_BYTES = 3 * 1024;
/** Mirrors MAX_IMAGE_BYTES in the /og-image route (larger files 404 there). */
const MAX_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;
/** Composer params echoed into og:url so re-scrapes see the same draft. */
const OVERRIDE_PARAMS = ["title", "desc", "img", "v"] as const;

const DEFAULT_TITLE = "A shared D-Code project";
const DEFAULT_DESCRIPTION = "Built with DashyCore D-Code ⚡ — view, copy and remix it.";

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  typescriptreact: "TSX",
  javascriptreact: "JSX",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  json: "JSON",
  markdown: "Markdown",
  python: "Python",
  java: "Java",
  csharp: "C#",
  cpp: "C++",
  c: "C",
  go: "Go",
  rust: "Rust",
  php: "PHP",
  ruby: "Ruby",
  sql: "SQL",
  shell: "Shell",
  yaml: "YAML",
  xml: "XML",
};

/* ---------------------------------------------------------------------- */
/* Request helpers                                                         */
/* ---------------------------------------------------------------------- */

export function firstParam(params: ShareSearchParams, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Absolute origin of the current request (dev = localhost, prod = real host). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host =
    (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  return `${forwardedProto || (local ? "http" : "https")}://${host}`;
}

/** True when the current request comes from a social/chat link unfurler. */
export async function isLinkPreviewRequest(): Promise<boolean> {
  const h = await headers();
  return isLinkPreviewUserAgent(h.get("user-agent") ?? "");
}

/** Query string (with leading `?`) preserving every param, repeated ones too. */
export function toQueryString(params: ShareSearchParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) qs.append(key, item);
    } else if (value !== undefined) {
      qs.set(key, value);
    }
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
}

/* ---------------------------------------------------------------------- */
/* Project lookup                                                          */
/* ---------------------------------------------------------------------- */

interface ProjectRow {
  title: string | null;
  description: string | null;
  files: unknown;
  share_slug: string | null;
}

function languageLabel(id: string): string {
  return LANGUAGE_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Approximate decoded size of a base64 data URL. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? 0 : Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

function summarizeProject(row: ProjectRow): ShareOgProject {
  const files = Array.isArray(row.files) ? row.files : [];
  const languageCounts = new Map<string, number>();
  let fileCount = 0;
  let image: { name: string; bytes: number } | null = null;

  for (const item of files) {
    if (!item || typeof item !== "object") continue;
    const { name, language, content } = item as {
      name?: unknown;
      language?: unknown;
      content?: unknown;
    };
    if (typeof name !== "string" || !name) continue;
    fileCount += 1;
    const text = typeof content === "string" ? content : "";

    if (RASTER_IMAGE_RE.test(name) && text.startsWith("data:image/")) {
      const bytes = dataUrlBytes(text);
      if (
        bytes >= MIN_PREVIEW_IMAGE_BYTES &&
        bytes <= MAX_PREVIEW_IMAGE_BYTES &&
        (!image || bytes > image.bytes)
      ) {
        image = { name, bytes };
      }
      continue;
    }
    if (typeof language === "string" && language && language !== "plaintext") {
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    }
  }

  return {
    title: row.title?.trim() || "Untitled project",
    description: row.description?.trim() || null,
    shareSlug: row.share_slug,
    fileCount,
    languages: [...languageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => languageLabel(id)),
    imageName: image?.name ?? null,
  };
}

/**
 * Loads the project a share key (12-char slug or project uuid) points at.
 * Memoised per request, so generateMetadata and the page share one read.
 */
export const lookupShareProject = cache(
  async (rawKey: string): Promise<ShareOgProject | null> => {
    const key = rawKey.trim();
    if (!key || key.length > 64) return null;
    const byId = UUID_RE.test(key);

    // Lane 1 — cookie-bound client: RLS applies (owners see their own rows).
    try {
      const supabase = await createClient();
      let query = supabase.from("dcode_projects").select(SELECT_COLUMNS);
      query = byId ? query.eq("id", key) : query.eq("share_slug", key.toLowerCase());
      const { data, error } = await query.maybeSingle();
      if (!error && data) return summarizeProject(data as ProjectRow);
    } catch {
      // A dead session or missing policy must not break a public link.
    }

    // Lane 2 — service role, PUBLIC rows only (filter is in the query itself).
    const service = createServiceClient();
    if (service) {
      try {
        let query = service
          .from("dcode_projects")
          .select(SELECT_COLUMNS)
          .eq("is_public", true);
        query = byId ? query.eq("id", key) : query.eq("share_slug", key.toLowerCase());
        const { data, error } = await query.maybeSingle();
        if (!error && data) return summarizeProject(data as ProjectRow);
      } catch {
        // Treated as not found.
      }
    }
    return null;
  }
);

/* ---------------------------------------------------------------------- */
/* Metadata                                                                */
/* ---------------------------------------------------------------------- */

function describeProject(project: ShareOgProject | null): string | null {
  if (!project || project.fileCount === 0) return null;
  const files = `${project.fileCount} file${project.fileCount === 1 ? "" : "s"}`;
  const languages = project.languages.slice(0, 3).join(", ");
  return `${files}${languages ? ` · ${languages}` : ""} — built with DashyCore D-Code ⚡`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Resolves title / description / image / url for one share request. */
export function resolveShareOg(input: {
  origin: string;
  /** The key exactly as it appears in the URL (slug or uuid). */
  shareKey: string;
  /** Path of the page being rendered, e.g. `/s/<key>`. */
  pagePath: string;
  searchParams: ShareSearchParams;
  project: ShareOgProject | null;
}): ResolvedShareOg {
  const { origin, shareKey, pagePath, searchParams, project } = input;
  const titleParam = firstParam(searchParams, "title").trim();
  const descParam = firstParam(searchParams, "desc").trim();
  const imgParam = firstParam(searchParams, "img").trim();

  const title = clip(titleParam || project?.title || DEFAULT_TITLE, 200);
  const description = clip(
    descParam || project?.description || describeProject(project) || DEFAULT_DESCRIPTION,
    500
  );

  // The /og-image route resolves projects by share slug (public rows only).
  const imageSlug = project?.shareSlug ?? (UUID_RE.test(shareKey) ? null : shareKey);
  const imageName = imgParam || project?.imageName || null;
  const isProjectImage = Boolean(imageName && imageSlug);
  const imageUrl = isProjectImage
    ? `${origin}/d-code/share/${encodeURIComponent(imageSlug ?? "")}/og-image?file=${encodeURIComponent(
        imageName ?? ""
      )}`
    : `${origin}/share-card.png`;

  const url = new URL(pagePath, origin);
  for (const key of OVERRIDE_PARAMS) {
    const value = firstParam(searchParams, key);
    if (value) url.searchParams.set(key, value);
  }

  return { title, description, imageUrl, isProjectImage, url: url.toString() };
}

/** Next.js Metadata (Open Graph + Twitter card) for a resolved share. */
export function shareOgMetadata(og: ResolvedShareOg): Metadata {
  // Project images have unknown dimensions — let crawlers measure them.
  const image = og.isProjectImage
    ? { url: og.imageUrl, alt: og.title }
    : { url: og.imageUrl, width: 1200, height: 630, alt: og.title };
  return {
    title: og.title,
    description: og.description,
    openGraph: {
      title: og.title,
      description: og.description,
      url: og.url,
      type: "website",
      siteName: "DashyCore",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: og.title,
      description: og.description,
      images: [og.imageUrl],
    },
  };
}
