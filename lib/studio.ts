/**
 * DashyCore v7 — Studio asset store.
 *
 * Studio is a thin creative workspace built on the image generator that
 * already ships in DashyCore: the zero-cost Pollinations <IMG> engine used
 * by the chat composer. This module is the ONE place that builds a
 * generation URL, so chat and Studio can never drift apart.
 *
 * Persistence (V1): browser localStorage.
 *
 *   The repository has no verified server-side asset storage (no Supabase
 *   table, no bucket, no worker endpoint for generated media), and this is
 *   a UI/IA task — so Studio assets are deliberately local to the browser.
 *   Cross-device libraries and public asset URLs (needed for real media
 *   attachments on social platforms) require a server-side storage layer
 *   that does not exist yet.
 */

const ASSETS_KEY = "dashycore:studio-assets:v1";
export const STUDIO_ASSETS_EVENT = "dashy:studio-assets-changed";

/** Hand-off key: "Open in Studio" from a chat image. */
export const STUDIO_INCOMING_KEY = "dashycore:studio-incoming:v1";

export const STUDIO_MAX_ASSETS = 60;

export interface StudioAsset {
  id: string;
  prompt: string;
  url: string;
  width: number;
  height: number;
  /** Where the generation was triggered from. */
  origin: "studio" | "chat";
  createdAt: number;
}

export interface StudioSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const STUDIO_SIZES: StudioSize[] = [
  { id: "square", label: "Square · 1:1", width: 1024, height: 1024 },
  { id: "portrait", label: "Portrait · 4:5", width: 1024, height: 1280 },
  { id: "story", label: "Story · 9:16", width: 1080, height: 1920 },
  { id: "landscape", label: "Landscape · 16:9", width: 1280, height: 720 },
];

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `studio-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Builds a Pollinations image URL — the exact engine the chat <IMG> button
 * has always used. Kept here so there is a single implementation.
 */
export function buildImageUrl(
  prompt: string,
  options: { width?: number; height?: number; seed?: number } = {}
): string {
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const seed = options.seed ?? Math.floor(Math.random() * 100_000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
}

/* ---------------------------------------------------------------------- */
/* Library (localStorage)                                                  */
/* ---------------------------------------------------------------------- */

function emitChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STUDIO_ASSETS_EVENT));
}

export function listStudioAssets(): StudioAsset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ASSETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is StudioAsset =>
          !!item &&
          typeof item === "object" &&
          typeof (item as StudioAsset).id === "string" &&
          typeof (item as StudioAsset).url === "string"
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function getStudioAsset(id: string): StudioAsset | null {
  return listStudioAssets().find((asset) => asset.id === id) ?? null;
}

function writeAssets(assets: StudioAsset[]): void {
  try {
    window.localStorage.setItem(
      ASSETS_KEY,
      JSON.stringify(assets.slice(0, STUDIO_MAX_ASSETS))
    );
  } catch {
    // Quota or private mode — the asset simply is not remembered.
  }
  emitChange();
}

/** Saves a generated image into the local Studio library. */
export function saveStudioAsset(
  input: Omit<StudioAsset, "id" | "createdAt"> & { id?: string; createdAt?: number }
): StudioAsset {
  const asset: StudioAsset = {
    id: input.id ?? newId(),
    prompt: input.prompt,
    url: input.url,
    width: input.width,
    height: input.height,
    origin: input.origin,
    createdAt: input.createdAt ?? Date.now(),
  };
  const existing = listStudioAssets().filter(
    (a) => a.id !== asset.id && a.url !== asset.url
  );
  writeAssets([asset, ...existing]);
  return asset;
}

export function deleteStudioAsset(id: string): void {
  writeAssets(listStudioAssets().filter((asset) => asset.id !== id));
}

export function clearStudioAssets(): void {
  writeAssets([]);
}
