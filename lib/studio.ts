"use client";

/**
 * Studio media library + public share persistence.
 *
 * Generated media stays local to the browser in `dashy.media.library`; public
 * shares are deliberately persisted in Supabase so the resulting `/s/<slug>`
 * URL is available outside the owner's browser and session.
 */

import { createClient } from "@/lib/supabase/client";

export const STUDIO_MEDIA_LIBRARY_KEY = "dashy.media.library";
export const STUDIO_MEDIA_UPDATED_EVENT = "dashy:studio-media-updated";
export const SHARE_ORIGIN = "https://dashy-core.vercel.app";

export interface StudioMediaAsset {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string;
  createdAt: string;
  shareSlug?: string | null;
}

export interface SharedStudioAsset {
  id: string;
  slug: string;
  ownerId: string;
  sourceAssetId: string;
  title: string;
  prompt: string;
  imageUrl: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SharedStudioAssetRow {
  id: string;
  slug: string;
  owner_id: string;
  source_asset_id: string;
  title: string | null;
  prompt: string | null;
  image_url: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function coerceAsset(value: unknown): StudioMediaAsset | null {
  if (!value || typeof value !== "object") return null;
  const asset = value as Record<string, unknown>;
  const imageUrl =
    typeof asset.imageUrl === "string"
      ? asset.imageUrl
      : typeof asset.url === "string" && asset.status === "ready"
        ? asset.url
        : "";
  const prompt = typeof asset.prompt === "string" ? asset.prompt : "";
  const rawCreatedAt = asset.createdAt;
  const createdAt =
    typeof rawCreatedAt === "number"
      ? new Date(rawCreatedAt).toISOString()
      : typeof rawCreatedAt === "string" && !Number.isNaN(Date.parse(rawCreatedAt))
        ? rawCreatedAt
        : "";
  const id = typeof asset.id === "string" || typeof asset.id === "number" ? String(asset.id) : "";
  if (!id || !prompt || !imageUrl || !createdAt) return null;
  return {
    id,
    title: typeof asset.title === "string" && asset.title.trim() ? asset.title : prompt.slice(0, 64),
    prompt,
    imageUrl,
    createdAt,
    shareSlug: typeof asset.shareSlug === "string" ? asset.shareSlug : null,
  };
}

/** Read only genuinely generated Studio items; malformed old values are ignored. */
export function listStudioMedia(): StudioMediaAsset[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STUDIO_MEDIA_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(coerceAsset)
      .filter((asset): asset is StudioMediaAsset => asset !== null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export function saveStudioMedia(assets: StudioMediaAsset[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STUDIO_MEDIA_LIBRARY_KEY, JSON.stringify(assets));
    window.dispatchEvent(new CustomEvent(STUDIO_MEDIA_UPDATED_EVENT));
  } catch {
    // A full or disabled localStorage must not make the Studio unusable.
  }
}

export function makeStudioAssetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function makeShareSlug(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return `s_img_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
  }
  return `s_img_${Math.random().toString(36).slice(2, 16)}`;
}

function rowToSharedAsset(row: SharedStudioAssetRow): SharedStudioAsset {
  return {
    id: row.id,
    slug: row.slug,
    ownerId: row.owner_id,
    sourceAssetId: row.source_asset_id,
    title: row.title?.trim() || "Untitled Studio image",
    prompt: row.prompt ?? "",
    imageUrl: row.image_url,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanImageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("This image does not have a valid shareable URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https image URLs can be shared.");
  }
  return url.toString();
}

/**
 * Makes a Studio item public. An existing source item keeps its slug so a
 * second Share click updates the real record without breaking any old link.
 */
export async function shareStudioMedia(asset: StudioMediaAsset): Promise<SharedStudioAsset> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("You must be signed in to share a Studio image.");
  }

  const payload = {
    title: cleanText(asset.title, 200) || "Untitled Studio image",
    prompt: cleanText(asset.prompt, 4_000),
    image_url: cleanImageUrl(asset.imageUrl),
    is_public: true,
    updated_at: new Date().toISOString(),
  };

  // This owner/source pair is unique in the migration. Look for it first so
  // re-sharing preserves the public URL instead of creating a fake new one.
  const { data: existing, error: existingError } = await supabase
    .from("shared_assets")
    .select("*")
    .eq("owner_id", user.id)
    .eq("source_asset_id", asset.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const { data, error } = await supabase
      .from("shared_assets")
      .update(payload)
      .eq("id", (existing as SharedStudioAssetRow).id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToSharedAsset(data as SharedStudioAssetRow);
  }

  // `slug` is unique. A collision is exceptionally unlikely but retried so
  // the URL copied to the user is always backed by a real database row.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("shared_assets")
      .insert({
        owner_id: user.id,
        source_asset_id: asset.id,
        slug: makeShareSlug(),
        ...payload,
      })
      .select("*")
      .single();

    if (!error) return rowToSharedAsset(data as SharedStudioAssetRow);
    if (!/duplicate key|unique constraint/i.test(error.message ?? "")) {
      throw new Error(error.message);
    }
  }

  throw new Error("Could not allocate a unique share link. Please try again.");
}

/** Fetches only public rows; this is safe for an anonymous `/s/<slug>` page. */
export async function getPublicStudioShare(slug: string): Promise<SharedStudioAsset | null> {
  if (!/^s_img_[a-z0-9_-]{6,80}$/i.test(slug)) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shared_assets")
    .select("*")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToSharedAsset(data as SharedStudioAssetRow) : null;
}

export function studioShareUrl(slug: string): string {
  return `${SHARE_ORIGIN}/s/${slug}`;
}
