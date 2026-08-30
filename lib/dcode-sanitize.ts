/**
 * DashyCore v7 — D-Code ingest + JSONB safety guards.
 *
 * Postgres `jsonb` rejects any string containing a NUL byte (`\u0000`) with
 *
 *   "unsupported Unicode escape sequence"
 *
 * A single imported binary file (logo.png, favicon.ico, font.woff2, a source
 * map…) is enough to make the *entire* `dcode_projects.files` row unwritable,
 * because every file lives in that one jsonb column. This module is the only
 * gate between "anything the browser handed us" and that column:
 *
 *   1. `isBlockedPath`   — hard-block binaries/media/lockfiles at import time
 *                          so they never enter `files[]` in the first place.
 *   2. `cleanTextContent`— strip NULs, BOM, lone surrogates and non-characters
 *                          from any string that is about to be persisted.
 *   3. `sanitizeFiles`   — apply 1 + 2 plus per-file/project size caps to the
 *                          whole array immediately before insert/update.
 *   4. `toSafeJsonPayload` — final `JSON.parse(JSON.stringify())` round-trip.
 *
 * Nothing here touches the network; it is safe to import from client and
 * server components alike.
 */

/* ---------------------------------------------------------------------- */
/* Hard blocks                                                             */
/* ---------------------------------------------------------------------- */

/** Extensions that are binary or media — they cannot live in a jsonb string. */
export const BLOCKED_EXT = new Set<string>([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "svg",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "zip",
  "tar",
  "gz",
  "rar",
  "7z",
  "pdf",
  "exe",
  "dll",
  "so",
  "dylib",
  "map",
  "bin",
  "wasm",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "webm",
]);

/** Directory fragments that are always generated output or VCS internals. */
export const BLOCKED_PATH_PARTS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
];

/**
 * Lockfiles are valid text but routinely exceed the per-file cap and add
 * nothing to a D-Code workspace, so they are skipped by default too.
 */
export const BLOCKED_FILENAMES = new Set<string>([
  "package-lock.json",
  "pnpm-lock.yaml",
]);

/* ---------------------------------------------------------------------- */
/* Limits                                                                  */
/* ---------------------------------------------------------------------- */

/** Max characters kept from a file path/name. */
export const MAX_PATH_CHARS = 200;

/** Per-file content cap (characters). */
export const MAX_FILE_CONTENT_CHARS = 400_000;

/** Max files stored in one project row. */
export const MAX_PROJECT_FILES = 200;

/** User-facing reason shown when a file is refused. */
export const BLOCKED_FILE_MESSAGE =
  "Binary/media files can't be stored in D-Code yet.";

/* ---------------------------------------------------------------------- */
/* Path checks                                                             */
/* ---------------------------------------------------------------------- */

/** Lower-case file name (basename) for a possibly nested path. */
export function basenameOf(path: string): string {
  const normalized = String(path).replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

/** Extension (no dot, lower-cased) or "" when the name has none. */
export function extensionOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * True when a path must never enter `files[]`: a blocked directory, a
 * binary/media extension, or a skipped lockfile. Accepts both POSIX and
 * Windows-style separators and any nesting depth.
 */
export function isBlockedPath(path: string): boolean {
  if (typeof path !== "string") return true;
  const p = path.replace(/\\/g, "/").toLowerCase();
  if (!p.trim()) return true;
  if (BLOCKED_PATH_PARTS.some((part) => p.includes(part))) return true;
  if (BLOCKED_FILENAMES.has(basenameOf(p))) return true;
  return BLOCKED_EXT.has(extensionOf(p));
}

/* ---------------------------------------------------------------------- */
/* Text cleaning                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Nuclear text cleaner. Removes everything a `jsonb` string cannot hold:
 * NUL bytes, a leading BOM, lone (unpaired) UTF-16 surrogates and the
 * Unicode non-characters U+FFFE / U+FFFF. Any non-string input becomes "".
 */
export function cleanTextContent(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input;

  // Strip NULs — the direct cause of "unsupported Unicode escape sequence".
  s = s.replace(/\u0000/g, "");
  // Strip a leading BOM.
  s = s.replace(/^\uFEFF/, "");
  // Drop lone surrogates (JSON.stringify emits them as \udXXX, which jsonb
  // rejects just like \u0000).
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "");
  s = s.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

  // Remove remaining non-characters / stray surrogates by code point.
  s = Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0);
      if (c === undefined) return false;
      if (c === 0) return false;
      if (c === 0xfffe || c === 0xffff) return false;
      if (c >= 0xd800 && c <= 0xdfff) return false;
      return true;
    })
    .join("");

  return s;
}

/**
 * Heuristic sniff for binary payloads that slipped past the extension block
 * (renamed assets, extensionless blobs, mislabeled downloads).
 */
export function containsBinaryMarkers(text: string): boolean {
  if (typeof text !== "string") return false;
  if (text.includes("\u0000")) return true;
  if (text.length === 0) return false;
  // A burst of replacement characters means the bytes were not text at all.
  const sample = text.slice(0, 4096);
  const replacements = (sample.match(/\uFFFD/g) ?? []).length;
  return replacements / sample.length > 0.05;
}

/* ---------------------------------------------------------------------- */
/* File array sanitization                                                 */
/* ---------------------------------------------------------------------- */

/** Anything shaped like a stored D-Code file (`name` is the project path). */
export interface SanitizableFile {
  name: string;
  content: string;
}

/**
 * The single gate before an insert/update. Drops blocked files, cleans every
 * string, caps path + content length and caps the file count, so a hostile or
 * merely messy import can never poison the row. Extra fields (`id`,
 * `language`, …) are preserved via the spread.
 */
export function sanitizeFiles<T extends SanitizableFile>(files: readonly T[]): T[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter(
      (f): f is T =>
        Boolean(f) && typeof f?.name === "string" && !isBlockedPath(f.name)
    )
    .map((f) => ({
      ...f,
      name: cleanTextContent(f.name).slice(0, MAX_PATH_CHARS),
      content: cleanTextContent(f.content).slice(0, MAX_FILE_CONTENT_CHARS),
    }))
    .slice(0, MAX_PROJECT_FILES);
}

/**
 * Final safety net: a full JSON round-trip. Well-formed `JSON.stringify`
 * (ES2019+) escapes lone surrogates instead of emitting broken UTF-16, so
 * whatever survives `cleanTextContent` still cannot produce an invalid
 * jsonb document. Falls back to per-file rebuilding rather than throwing —
 * a save must never be blocked by the sanitizer itself.
 */
export function toSafeJsonPayload<T extends SanitizableFile>(files: T[]): T[] {
  try {
    return JSON.parse(JSON.stringify(files)) as T[];
  } catch {
    const rebuilt = files.map((f) => ({
      ...f,
      name: cleanTextContent(f.name).slice(0, MAX_PATH_CHARS),
      content: cleanTextContent(f.content).slice(0, MAX_FILE_CONTENT_CHARS),
    }));
    try {
      return JSON.parse(JSON.stringify(rebuilt)) as T[];
    } catch {
      return rebuilt;
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Save error reporting                                                    */
/* ---------------------------------------------------------------------- */

const PAYLOAD_ERROR_RE =
  /unsupported unicode escape|null byte|\\u0000|jsonb|invalid input syntax|value too long|22023|22p05|54000/i;

const AUTH_ERROR_RE =
  /jwt expired|jwt_expired|token expired|session expired|signed in|sign in|permission denied|row-level security|42501|pgrst301|\b401\b|\b403\b/i;

export interface SaveErrorInfo {
  /** Short, user-facing message (never a raw stack trace). */
  message: string;
  /** True when re-authentication is genuinely required. */
  isAuth: boolean;
  /** True when the payload itself (binaries/size) is the likely cause. */
  isPayload: boolean;
  /** Message plus the remediation tip when the payload is at fault. */
  withTip: string;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Please try again.";
}

/**
 * Turns a Supabase/Postgres error into something short and actionable.
 * The header pill uses `isAuth` to decide whether the failure is sticky:
 * a one-off payload or network failure must not park the workspace in a
 * permanent "offline" state, but a dead session should stay visible.
 */
export function describeSaveError(error: unknown): SaveErrorInfo {
  const full = rawMessage(error);
  const firstLine = full.split("\n")[0] ?? full;
  const shortened =
    firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;

  const isAuth = AUTH_ERROR_RE.test(full);
  const isPayload = PAYLOAD_ERROR_RE.test(full);
  const withTip = isPayload
    ? `${shortened} Tip: remove .png/.lock/binary files.`
    : shortened;

  return { message: shortened, isAuth, isPayload, withTip };
}
