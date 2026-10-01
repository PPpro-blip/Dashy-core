/**
 * DashyCore — Studio share links (`/m/<slug>`).
 *
 * Studio images live in the browser's Media Library (localStorage), not in
 * the database, so a share link has to carry everything needed to rebuild
 * the image. The slug is a base64url-encoded JSON payload of the exact
 * prompt-mode /api/img-proxy parameters behind the tile:
 *
 *   { p: prompt, s: seed, w: width, h: height, t: turbo }
 *
 * The server decodes it and rebuilds the SAME proxied URL the Studio card
 * shows (`asset.url`), then uses it as og:image / twitter:image. Pollinations
 * renders deterministically for (prompt, seed, size, model), so crawlers get
 * the very image the user shared.
 *
 * Pure + isomorphic: no DOM, no Node APIs (TextEncoder/atob/btoa exist in
 * browsers, Node 18+ and the Edge runtime).
 */

import { proxyPromptUrlFor, proxyPromptUrlFromDirect } from "@/lib/img-engine";

/** Mirrors MAX_PROMPT_CHARS in app/api/img-proxy/route.ts. */
export const STUDIO_SHARE_MAX_PROMPT = 2000;
const MIN_SIDE = 64;
const MAX_SIDE = 2048;

export interface StudioShareAsset {
  prompt: string;
  seed: string;
  width: number;
  height: number;
  turbo: boolean;
}

interface WirePayload {
  p: string;
  s: string;
  w: number;
  h: number;
  t?: 0 | 1;
}

/* ------------------------------ base64url -------------------------------- */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(slug: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  try {
    const padded = slug.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function clampSide(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n)));
}

function cleanSeed(value: unknown): string | null {
  const seed = String(value ?? "").trim();
  // Engine seeds are digits or `{Date.now()}_{random}` — keep it tight.
  return /^[A-Za-z0-9_-]{1,64}$/.test(seed) ? seed : null;
}

/* ------------------------------ asset <-> URL ---------------------------- */

/**
 * Derives the share asset from a Studio tile's displayed URL. Accepts both
 * lanes the Studio can finish on:
 *   - proxy lane  `/api/img-proxy?prompt=&seed=&width=&height=&turbo=`
 *   - direct lane `https://image.pollinations.ai/prompt/...` (upgraded to
 *     the proxy form so the share always points at the image engine)
 * Falls back to the tile's own prompt/seed/size when the URL lacks them.
 */
export function studioAssetFromTile(tile: {
  url?: string;
  prompt: string;
  seed?: string | number;
  width: number;
  height: number;
}): StudioShareAsset | null {
  let params: URLSearchParams | null = null;
  const raw = tile.url?.trim() ?? "";
  if (raw.startsWith("/api/img-proxy?")) {
    params = new URLSearchParams(raw.slice(raw.indexOf("?") + 1));
  } else if (raw) {
    const upgraded = proxyPromptUrlFromDirect(raw);
    if (upgraded) params = new URLSearchParams(upgraded.slice(upgraded.indexOf("?") + 1));
  }

  const prompt = (params?.get("prompt") ?? tile.prompt ?? "").trim().slice(0, STUDIO_SHARE_MAX_PROMPT);
  const seed = cleanSeed(params?.get("seed") ?? tile.seed);
  const width = clampSide(params?.get("width") ?? tile.width);
  const height = clampSide(params?.get("height") ?? tile.height);
  if (!prompt || !seed || !width || !height) return null;
  return { prompt, seed, width, height, turbo: (params?.get("turbo") ?? "true") !== "false" };
}

/** Same-origin proxied image path for an asset (identical to the Studio's asset.url). */
export function studioProxyPath(asset: StudioShareAsset): string {
  return proxyPromptUrlFor({
    prompt: asset.prompt,
    seed: asset.seed,
    width: asset.width,
    height: asset.height,
    turbo: asset.turbo,
  });
}

/* ------------------------------ slug codec ------------------------------- */

export function encodeStudioShareSlug(asset: StudioShareAsset): string {
  const wire: WirePayload = {
    p: asset.prompt.slice(0, STUDIO_SHARE_MAX_PROMPT),
    s: asset.seed,
    w: asset.width,
    h: asset.height,
  };
  if (!asset.turbo) wire.t = 0;
  return toBase64Url(JSON.stringify(wire));
}

/** Strict decode + validation — returns null for anything malformed. */
export function decodeStudioShareSlug(slug: string): StudioShareAsset | null {
  if (!slug || slug.length > 4096) return null;
  const json = fromBase64Url(slug);
  if (!json) return null;
  let wire: Partial<WirePayload>;
  try {
    wire = JSON.parse(json) as Partial<WirePayload>;
  } catch {
    return null;
  }
  if (!wire || typeof wire !== "object") return null;
  const prompt = typeof wire.p === "string" ? wire.p.trim().slice(0, STUDIO_SHARE_MAX_PROMPT) : "";
  const seed = cleanSeed(wire.s);
  const width = clampSide(wire.w);
  const height = clampSide(wire.h);
  if (!prompt || !seed || !width || !height) return null;
  return { prompt, seed, width, height, turbo: wire.t !== 0 };
}

/** Public share page URL for an asset. */
export function buildStudioShareUrl(origin: string, asset: StudioShareAsset): string {
  return `${origin}/m/${encodeStudioShareSlug(asset)}`;
}

/** Short human title for previews ("A neon cyberpunk desk…"). */
export function studioShareTitle(prompt: string, max = 90): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  const text = clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "A Dashy Studio creation";
}
