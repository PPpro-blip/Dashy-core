/**
 * DashyCore v7 — Studio Share Hub store (Supabase `shared_assets`).
 *
 * Schema-safe by design: every call is wrapped so a missing table (schema
 * cache miss on a fresh project), an RLS refusal, or an offline client can
 * never crash the Studio UI. Writes degrade to a local-only share record and
 * reads degrade to `null` / `0`.
 */

import { createClient } from "@/lib/supabase/client";

export const SHARE_BASE_URL = "https://dashy-core.vercel.app";
export const SHARED_ASSETS_TABLE = "shared_assets";

export interface SharedAsset {
  id: string;
  slug: string;
  imageUrl: string;
  title: string;
  isPublic: boolean;
  createdAt: string | null;
}

export interface ShareResult {
  asset: SharedAsset;
  /** False when the row could not be written (table missing / signed out). */
  persisted: boolean;
  /** Human-readable reason when `persisted` is false. */
  reason?: string;
}

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generates a 12-char url-safe share slug. */
export function newShareSlug(): string {
  let slug = "";
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  } else {
    while (slug.length < 12) slug += Math.random().toString(36).slice(2);
    slug = slug.slice(0, 12);
  }
  return slug;
}

/** Public URL for a share slug. */
export function shareUrlFor(slug: string): string {
  return `${SHARE_BASE_URL}/s/${slug}`;
}

interface SharedAssetRow {
  id?: string | null;
  slug?: string | null;
  image_url?: string | null;
  title?: string | null;
  is_public?: boolean | null;
  created_at?: string | null;
}

function rowToAsset(row: SharedAssetRow, fallbackSlug: string): SharedAsset {
  return {
    id: row.id ?? fallbackSlug,
    slug: row.slug ?? fallbackSlug,
    imageUrl: row.image_url ?? "",
    title: row.title ?? "Dashy Studio image",
    isPublic: row.is_public ?? true,
    createdAt: row.created_at ?? null,
  };
}

export interface ShareDraft {
  /** Proxied image URL (`/api/img-proxy?url=…`). */
  imageUrl: string;
  title: string;
  isPublic?: boolean;
  /** Reuse an existing slug to update instead of creating a new share. */
  slug?: string | null;
}

/**
 * Creates (or upserts) a public share row and returns the share record.
 * Never throws — on failure the returned asset is still usable locally.
 */
export async function shareAsset(draft: ShareDraft): Promise<ShareResult> {
  const slug = draft.slug?.trim() || newShareSlug();
  const isPublic = draft.isPublic ?? true;
  const fallback: SharedAsset = {
    id: slug,
    slug,
    imageUrl: draft.imageUrl,
    title: draft.title || "Dashy Studio image",
    isPublic,
    createdAt: new Date().toISOString(),
  };

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = {
      slug,
      user_id: user?.id ?? null,
      image_url: draft.imageUrl,
      title: fallback.title.slice(0, 200),
      is_public: isPublic,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from(SHARED_ASSETS_TABLE)
      .upsert(payload, { onConflict: "slug" })
      .select("*")
      .maybeSingle();

    if (error) {
      return { asset: fallback, persisted: false, reason: error.message };
    }
    return {
      asset: data ? rowToAsset(data as SharedAssetRow, slug) : fallback,
      persisted: true,
    };
  } catch (error) {
    return {
      asset: fallback,
      persisted: false,
      reason: error instanceof Error ? error.message : "Share store unavailable",
    };
  }
}

/** Flips the public/private toggle for a share. Never throws. */
export async function setSharePublic(
  slug: string,
  isPublic: boolean
): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from(SHARED_ASSETS_TABLE)
      .update({ is_public: isPublic, updated_at: new Date().toISOString() })
      .eq("slug", slug);
    return !error;
  } catch {
    return false;
  }
}

/** Fetches one public share by slug (anonymous-safe). Never throws. */
export async function getSharedAsset(slug: string): Promise<SharedAsset | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(SHARED_ASSETS_TABLE)
      .select("*")
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle();
    if (error || !data) return null;
    return rowToAsset(data as SharedAssetRow, slug);
  } catch {
    return null;
  }
}

/** Lists the signed-in user's shares (newest first). Never throws. */
export async function listSharedAssets(limit = 50): Promise<SharedAsset[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(SHARED_ASSETS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as SharedAssetRow[]).map((row) => rowToAsset(row, row.slug ?? ""));
  } catch {
    return [];
  }
}
