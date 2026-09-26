/**
 * DashyCore v7 — Studio Share Hub (Supabase `shared_assets`, RLS-scoped).
 *
 * Sharing a Studio card upserts a row into the public `shared_assets` table
 * (see supabase/migrations/20260926000000_create_shared_assets.sql) so
 * anyone can open `/s/<slug>` and see an OpenGraph-ready preview — no
 * sign-in required, same pattern as D-Code's `/d-code/share/<slug>`.
 *
 * Schema safety: if the table isn't migrated yet on a given Supabase
 * project (or any other transient error happens), sharing NEVER throws to
 * the UI. It degrades to a local-only share record (this browser only) so
 * the Share Hub still opens with a working link and copy-to-clipboard,
 * instead of a crash.
 */

import { createClient } from "@/lib/supabase/client";

/** Both the browser and server Supabase factories return this same client type. */
type SupabaseLikeClient = ReturnType<typeof createClient>;

const LOCAL_SHARES_KEY = "dashycore:local-shares:v1";
const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export interface SharedAsset {
  slug: string;
  title: string;
  imageUrl: string;
  isPublic: boolean;
  createdAt: string;
}

export interface ShareResult {
  slug: string;
  url: string;
  /** true when the row is really in Supabase (works cross-device/for crawlers). */
  persisted: boolean;
}

function newSlug(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
  }
  return Array.from({ length: 10 }, () =>
    SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)]
  ).join("");
}

function siteOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://dashy-core.vercel.app";
}

/* ---------------------------------------------------------------------- */
/* Local (browser-only) fallback store                                     */
/* ---------------------------------------------------------------------- */

function readLocalShares(): Record<string, SharedAsset> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_SHARES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SharedAsset>) : {};
  } catch {
    return {};
  }
}

function writeLocalShare(asset: SharedAsset): void {
  if (typeof window === "undefined") return;
  try {
    const all = readLocalShares();
    all[asset.slug] = asset;
    window.localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(all));
  } catch {
    // Best-effort only — the Share Hub link still works for this session.
  }
}

export function getLocalShare(slug: string): SharedAsset | null {
  return readLocalShares()[slug] ?? null;
}

/* ---------------------------------------------------------------------- */
/* Public API                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Shares an image: tries a real Supabase `shared_assets` row first, and
 * ALWAYS falls back to a local-only record on any failure so the Share Hub
 * never breaks. Returns the public `/s/<slug>` URL either way.
 */
export async function shareAsset(input: {
  imageUrl: string;
  title: string;
}): Promise<ShareResult> {
  const slug = newSlug();
  const title = input.title.trim().slice(0, 200) || "A Dashy Studio creation";

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("shared_assets").insert({
      slug,
      title,
      image_url: input.imageUrl,
      is_public: true,
      user_id: user?.id ?? null,
    });

    if (error) throw error;

    return { slug, url: `${siteOrigin()}/s/${slug}`, persisted: true };
  } catch {
    // Table missing from the schema cache, RLS rejection, offline, etc. —
    // degrade to a local-only share instead of crashing the Share Hub.
    writeLocalShare({
      slug,
      title,
      imageUrl: input.imageUrl,
      isPublic: true,
      createdAt: new Date().toISOString(),
    });
    return { slug, url: `${siteOrigin()}/s/${slug}`, persisted: false };
  }
}

/** Toggles public/private on a previously shared asset (best-effort). */
export async function setSharePublic(slug: string, isPublic: boolean): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("shared_assets")
      .update({ is_public: isPublic })
      .eq("slug", slug);
    if (error) throw error;
    return true;
  } catch {
    const local = getLocalShare(slug);
    if (local) writeLocalShare({ ...local, isPublic });
    return false;
  }
}

/**
 * Fetches a shared asset by slug — Supabase first, local fallback second.
 * Accepts an optional pre-built client so server components (e.g. the
 * `/s/[slug]` OpenGraph metadata generator) can pass a server-side client
 * instead of the browser one.
 */
export async function getSharedAsset(
  slug: string,
  client?: SupabaseLikeClient
): Promise<SharedAsset | null> {
  try {
    const supabase = client ?? createClient();
    const { data, error } = await supabase
      .from("shared_assets")
      .select("slug, title, image_url, is_public, created_at")
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        slug: data.slug as string,
        title: (data.title as string) ?? "A Dashy Studio creation",
        imageUrl: data.image_url as string,
        isPublic: Boolean(data.is_public),
        createdAt: (data.created_at as string) ?? new Date().toISOString(),
      };
    }
  } catch {
    // Fall through to the local store below.
  }
  return getLocalShare(slug);
}

/** Counts this user's shared assets (Analytics). Never throws — 0 on error. */
export async function countMySharedAssets(): Promise<number> {
  try {
    const supabase = createClient();
    const { count, error } = await supabase
      .from("shared_assets")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}
