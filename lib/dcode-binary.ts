/**
 * DashyCore v7 — D-Code binary asset handling (Base64 data URLs).
 *
 * Postgres `jsonb` cannot hold NUL bytes (`\u0000`), so a raw imported
 * logo.png used to make the whole `dcode_projects.files` row unwritable.
 * Instead of blocking binary assets, D-Code now stores them as Base64 data
 * URLs (`data:image/png;base64,iVBOR…`): pure ASCII, zero NUL bytes, safe
 * for jsonb, and directly renderable by the editor preview pane.
 *
 * Everything in this module is pure/string-level except the FileReader
 * helpers, which are only ever invoked from client components.
 */

/** Extensions that are imported as Base64 data URLs rather than text. */
export const BINARY_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
] as const;

/** Subset of BINARY_EXTS (plus .svg, which is text) rendered as an <img>. */
export const IMAGE_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".svg",
];

const BINARY_EXT_SET = new Set<string>(BINARY_EXTS);
const IMAGE_EXT_SET = new Set<string>(IMAGE_EXTS);

/** MIME type used when encoding a binary blob into a data URL. */
const BINARY_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
};

/** Lower-cased extension *with* dot (".png"), or "" for extensionless. */
export function extensionWithDot(path: string): string {
  const base = String(path)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** True when a path points at an asset we store as a Base64 data URL. */
export function isBinaryPath(path: string): boolean {
  return BINARY_EXT_SET.has(extensionWithDot(path));
}

/** True when a path points at a raster image or SVG (editor preview pane). */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT_SET.has(extensionWithDot(path));
}

/** True for `data:...` URL strings (any MIME). */
export function isDataUrl(content: unknown): content is string {
  return (
    typeof content === "string" &&
    content.startsWith("data:") &&
    content.includes(";base64,")
  );
}

/** True for `data:image/...;base64,...` strings. */
export function isImageDataUrl(content: unknown): boolean {
  return isDataUrl(content) && content.slice(5, 11) === "image/";
}

/**
 * Whether the editor should render the image preview pane instead of
 * Monaco: a raster asset stored as a data URL, or an SVG (stored as text).
 */
export function isPreviewableImage(name: string, content: string): boolean {
  if (isImageDataUrl(content)) return true;
  // SVGs are imported as text (they are XML) but render as images.
  return extensionWithDot(name) === ".svg" && !isDataUrl(content);
}

/** MIME for a binary extension, falling back to octet-stream. */
export function mimeForBinaryExt(ext: string): string {
  return BINARY_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Encodes raw bytes into a `data:<mime>;base64,…` URL (browser-safe). */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length))
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Reads a browser File/Blob into a Base64 data URL. */
export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(blob);
  });
}

/** Reads a browser File/Blob as UTF-8 text. */
export function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsText(blob);
  });
}

/** Decoded byte length of a base64 data URL (approximation for display). */
export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1).replace(/=+$/, "");
  return Math.floor((b64.length * 3) / 4);
}

/** Human-readable byte size ("42.1 KiB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
