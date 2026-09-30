"use client";

/**
 * Dashy Studio — shared Media Library tile store (localStorage-backed).
 *
 * Extracted from app/studio/page.tsx so the Generate tab (/studio) and the
 * Library tab (/studio/library) read and write the SAME `dashy.media.library`
 * store without duplicating the sanitizer. lib/studio.ts (Supabase share
 * persistence for /s/<slug> links) coerces the same entries — asset ids stay
 * identical across Studio, the Library and the Share Hub.
 */

import { STUDIO_MEDIA_UPDATED_EVENT } from "@/lib/studio";

export interface Tile {
  id: string;
  prompt: string;
  url?: string;
  status: "generating" | "ready" | "error";
  createdAt: number;
  /** Generation width/height in px — baked into the direct Pollinations URL. */
  width: number;
  height: number;
  seed?: string | number;
  /** True when the displayed URL is a same-origin /api/img-proxy render. */
  viaProxy?: boolean;
}

/** localStorage-backed Media Library (survives reloads). */
export const LIBRARY_KEY = "dashy.media.library";
export const LIBRARY_LIMIT = 60;

export const ASPECT_OPTIONS = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
} as const;
export type AspectKey = keyof typeof ASPECT_OPTIONS;

/**
 * Fast single-model Turbo URL. The endpoint answers with raw image bytes
 * (JPEG/PNG), never JSON — perfect for a plain browser `Image()` preload.
 */
export function buildDirectUrl(
  prompt: string,
  seed: number,
  width: number,
  height: number
): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=turbo`;
}

/**
 * Restores one stored entry into a Tile. Tolerates legacy media-library
 * shapes from older Studio builds (string ids, video assets, missing
 * dimensions, legacy `loading` status).
 *
 * SANITIZER: only a stored `ready` status with a usable URL restores as
 * ready. Anything stuck in `generating` / `pending` / `loading` (or without
 * a URL) becomes a retryable `error` tile so legacy hung jobs never hang the
 * library again.
 */
export function normalizeStoredTile(entry: unknown): Tile | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown>;
  // Older libraries also stored video assets — images only here.
  if (item.type === "video") return null;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  if (!prompt) return null;

  const storedUrl = typeof item.url === "string" ? item.url : "";
  const storedStatus = typeof item.status === "string" ? item.status : "";
  const ready = Boolean(storedUrl) && storedStatus === "ready";
  const url = ready ? storedUrl : undefined;

  return {
    id:
      typeof item.id === "string" || typeof item.id === "number"
        ? String(item.id)
        : `${typeof item.createdAt === "number" ? item.createdAt : Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
    prompt,
    url,
    status: ready ? "ready" : "error",
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    width:
      typeof item.width === "number" && item.width > 0 ? item.width : 1024,
    height:
      typeof item.height === "number" && item.height > 0 ? item.height : 1024,
    seed:
      typeof item.seed === "number" || typeof item.seed === "string"
        ? item.seed
        : undefined,
    viaProxy: ready ? url!.startsWith("/api/img-proxy") : undefined,
  };
}

/** Loads the Media Library from localStorage (best effort, sanitized). */
export function loadLibrary(): Tile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tiles: Tile[] = [];
    for (const entry of parsed) {
      const tile = normalizeStoredTile(entry);
      if (tile) tiles.push(tile);
    }
    return tiles.slice(0, LIBRARY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Persists finished tiles (ready/error). Optimistic `generating` tiles stay
 * transient — a refresh mid-generation simply drops them, and the mount
 * sanitizer converts any legacy stuck entries to `error`.
 */
export function saveLibrary(tiles: Tile[]): void {
  if (typeof window === "undefined") return;
  try {
    const persistable = tiles
      .filter((tile) => tile.status !== "generating")
      .slice(0, LIBRARY_LIMIT);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(persistable));
    window.dispatchEvent(new CustomEvent(STUDIO_MEDIA_UPDATED_EVENT));
  } catch {
    // Storage quota exceeded — best effort.
  }
}

/** Maps a tile back to its aspect key (remix preserves the tile's shape). */
export function aspectForTile(tile: Tile): AspectKey {
  for (const [key, size] of Object.entries(ASPECT_OPTIONS) as Array<
    [AspectKey, { width: number; height: number }]
  >) {
    if (size.width === tile.width && size.height === tile.height) return key;
  }
  return "1:1";
}

/** Triggers a browser download for a rendered tile. */
export function downloadTileImage(url: string, promptText: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = `dashy-studio-${promptText.slice(0, 24).replace(/[^a-z0-9]/gi, "-").toLowerCase() || "image"}.png`;
  a.target = "_blank";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
