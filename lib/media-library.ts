/**
 * DashyCore v7 — Studio media library (localStorage, zero backend).
 *
 * Images generated in /studio (the same zero-cost pollinations <IMG> engine
 * used by chat's "Create AI art" action) are kept here so the gallery
 * survives reloads without needing a database table for the images
 * themselves. Sharing a card promotes it to a real Supabase row (see
 * lib/share.ts) — the local library only tracks *this browser's* creations.
 *
 * Storage key is intentionally the literal `dashy.media.library` so the
 * Analytics page can count real Studio assets directly.
 */

export const MEDIA_LIBRARY_KEY = "dashy.media.library";
export const MEDIA_LIBRARY_UPDATED_EVENT = "dashy:media-library-updated";

export interface MediaAsset {
  id: string;
  prompt: string;
  imageUrl: string;
  createdAt: number;
  /** Populated once the card has been shared via the Share Hub. */
  shareSlug?: string;
  shareUrl?: string;
  isPublic?: boolean;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function readAll(): MediaAsset[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(MEDIA_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is MediaAsset =>
        item && typeof item === "object" && typeof item.id === "string"
    );
  } catch {
    return [];
  }
}

function writeAll(assets: MediaAsset[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(assets));
  } catch {
    // Storage full / unavailable — the in-memory state (React) still works
    // for the current session.
  }
  window.dispatchEvent(new CustomEvent(MEDIA_LIBRARY_UPDATED_EVENT));
}

/** Lists media, newest first. */
export function listMedia(): MediaAsset[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

/** Real local count — used by Analytics ("Studio assets"). */
export function countMedia(): number {
  return readAll().length;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Adds a freshly generated image to the library. */
export function addMedia(input: { prompt: string; imageUrl: string }): MediaAsset {
  const asset: MediaAsset = {
    id: newId(),
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    createdAt: Date.now(),
  };
  const all = readAll();
  all.unshift(asset);
  writeAll(all.slice(0, 200));
  return asset;
}

/** Merges a partial patch (e.g. share info) into one asset. */
export function updateMedia(id: string, patch: Partial<MediaAsset>): void {
  const all = readAll();
  const next = all.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset));
  writeAll(next);
}

export function removeMedia(id: string): void {
  writeAll(readAll().filter((asset) => asset.id !== id));
}
