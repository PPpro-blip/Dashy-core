/**
 * DashyCore v7 — Studio media library (`dashy.media.library` in localStorage).
 *
 * Every image generated in Dashy Studio is mirrored here so the Studio grid
 * and the Analytics dashboard can show honest, real counts without a network
 * round-trip. Storage access is always defensive: a corrupted/unavailable
 * store degrades to an empty library rather than crashing a page.
 */

export const MEDIA_LIBRARY_KEY = "dashy.media.library";
export const MEDIA_LIBRARY_EVENT = "dashy:media-library-updated";

export interface MediaAsset {
  id: string;
  /** Original (upstream) image URL. */
  url: string;
  /** Prompt used to generate the image — doubles as the share title. */
  prompt: string;
  createdAt: number;
  /** Populated once the asset has been shared to Supabase. */
  shareSlug?: string | null;
  isPublic?: boolean;
}

/** Proxied URL used for sharing / OpenGraph previews. */
export function proxiedImageUrl(url: string): string {
  return `/api/img-proxy?url=${encodeURIComponent(url)}`;
}

/** Underlying URL behind a proxied link (identity for plain URLs). */
export function unproxiedImageUrl(url: string): string {
  if (!url.startsWith("/api/img-proxy")) return url;
  const query = url.slice(url.indexOf("?") + 1);
  const raw = new URLSearchParams(query).get("url");
  return raw || url;
}

export function newAssetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAsset(value: unknown): value is MediaAsset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.url === "string";
}

/** Reads the library (newest first). Never throws. */
export function listMedia(): MediaAsset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MEDIA_LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAsset).map((asset) => ({
      ...asset,
      prompt: typeof asset.prompt === "string" ? asset.prompt : "Untitled",
      createdAt: typeof asset.createdAt === "number" ? asset.createdAt : 0,
    }));
  } catch {
    return [];
  }
}

/** Count of stored Studio assets — used by Analytics. Never throws. */
export function countMedia(): number {
  return listMedia().length;
}

function persist(assets: MediaAsset[]): MediaAsset[] {
  try {
    window.localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(assets));
  } catch {
    // Quota/private mode — the in-memory list still powers this session.
  }
  try {
    window.dispatchEvent(new CustomEvent(MEDIA_LIBRARY_EVENT));
  } catch {
    // Non-browser context.
  }
  return assets;
}

/** Adds an asset to the front of the library and returns the new list. */
export function addMedia(asset: MediaAsset): MediaAsset[] {
  const next = [asset, ...listMedia().filter((a) => a.id !== asset.id)].slice(0, 200);
  return persist(next);
}

/** Shallow-merges a patch into one asset and returns the new list. */
export function updateMedia(id: string, patch: Partial<MediaAsset>): MediaAsset[] {
  const next = listMedia().map((asset) =>
    asset.id === id ? { ...asset, ...patch, id: asset.id } : asset
  );
  return persist(next);
}

/** Removes one asset and returns the new list. */
export function removeMedia(id: string): MediaAsset[] {
  return persist(listMedia().filter((asset) => asset.id !== id));
}
