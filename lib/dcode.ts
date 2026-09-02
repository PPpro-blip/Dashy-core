/**
 * DashyCore v7 — D-Code project store (Supabase `dcode_projects`).
 *
 * Browser-side CRUD for the D-Code multi-file Monaco IDE. Every call goes
 * through the Supabase browser client; Row Level Security (see
 * supabase/migrations/20260829100000_create_dcode_projects.sql) enforces:
 *   - owner: full CRUD on their own projects
 *   - everyone (incl. anonymous): SELECT when is_public = true
 *
 * A project's files are stored as one jsonb array so loading a workspace
 * is a single round-trip:
 *   [{ id, name, language, content }, ...]
 */

import { createClient } from "@/lib/supabase/client";
import {
  cleanTextContent,
  isBlockedPath,
  MAX_FILE_CONTENT_CHARS,
  MAX_PATH_CHARS,
  sanitizeFiles,
  toSafeJsonPayload,
} from "@/lib/dcode-sanitize";
import { isBinaryPath, isDataUrl } from "@/lib/dcode-binary";

// Re-exported so D-Code UI code has one import site for every ingest guard.
export {
  BLOCKED_FILE_MESSAGE,
  MAX_FILE_CONTENT_CHARS,
  MAX_PATH_CHARS,
  MAX_PROJECT_FILES,
  cleanTextContent,
  containsBinaryMarkers,
  isBlockedPath,
  sanitizeFiles,
  toSafeJsonPayload,
} from "@/lib/dcode-sanitize";

// Re-exported binary helpers (Base64 data-URL assets) for the workspace UI.
export {
  BINARY_EXTS,
  bytesToDataUrl,
  dataUrlByteSize,
  extensionWithDot,
  formatBytes,
  isBinaryPath,
  isDataUrl,
  isImageDataUrl,
  isImagePath,
  isPreviewableImage,
  mimeForBinaryExt,
  readBlobAsDataUrl,
  readBlobAsText,
} from "@/lib/dcode-binary";

/* ---------------------------------------------------------------------- */
/* Types                                                                   */
/* ---------------------------------------------------------------------- */

export interface DCodeFile {
  id: string;
  name: string;
  /** Monaco language id (typescript, python, …). */
  language: string;
  content: string;
}

export interface DCodeProject {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  /** Primary language of the project (default file language). */
  language: string;
  files: DCodeFile[];
  isPublic: boolean;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Source Control repo binding (see migration 20260901000000). All three
   * are null until the user binds this project to a GitHub repository.
   */
  githubRepoFullName: string | null;
  githubDefaultBranch: string | null;
  githubLastSyncedSha: string | null;
  /**
   * Names of stored files that were dropped on read because they are
   * archives/executables/lockfiles or raw (non-encoded) binaries. Populated
   * so the UI can tell the user why a file they imported earlier is no
   * longer listed (and why the next save heals the row). Never persisted.
   */
  skippedFiles?: string[];
}

export interface DCodeProjectDraft {
  title: string;
  description?: string | null;
  language: string;
  files: DCodeFile[];
}

/** GitHub repo binding written to the project row (nullable columns). */
export interface DCodeGithubBind {
  fullName?: string | null;
  defaultBranch?: string | null;
  lastSyncedSha?: string | null;
}

/** Patch accepted by updateProject — only provided fields change. */
export interface DCodeProjectPatch {
  title?: string;
  description?: string | null;
  language?: string;
  files?: DCodeFile[];
  isPublic?: boolean;
  /** Source Control binding — only provided sub-fields change. */
  github?: DCodeGithubBind;
}

interface DCodeProjectRow {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  language: string | null;
  files: unknown;
  is_public: boolean;
  share_slug: string | null;
  github_repo_full_name: string | null;
  github_default_branch: string | null;
  github_last_synced_sha: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------------------------------------------------------------------- */
/* Small helpers                                                           */
/* ---------------------------------------------------------------------- */

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts.
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** URL-safe share token (12 lowercase alphanumeric chars). */
function newShareSlug(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  graphql: "graphql",
  gql: "graphql",
};

/** Maps a file name to a Monaco language id via its extension. */
export function languageFromFilename(name: string): string {
  const match = /\.([\w]+)$/.exec(name.trim().toLowerCase());
  if (!match) return "plaintext";
  return EXTENSION_LANGUAGES[match[1]] ?? "plaintext";
}

/** One-shot seed handed over from chat ("Open in D-Code"). */
export const DCODE_INCOMING_KEY = "dashycore:dcode-incoming:v1";

/** Sensible default file name for a Monaco language id (chat hand-off). */
export function filenameFromLanguage(language: string): string {
  const map: Record<string, string> = {
    typescript: "main.ts",
    javascript: "main.js",
    json: "data.json",
    markdown: "notes.md",
    css: "styles.css",
    scss: "styles.scss",
    html: "index.html",
    xml: "file.xml",
    python: "main.py",
    ruby: "main.rb",
    go: "main.go",
    rust: "main.rs",
    java: "Main.java",
    c: "main.c",
    cpp: "main.cpp",
    csharp: "Main.cs",
    php: "index.php",
    sql: "query.sql",
    shell: "script.sh",
    yaml: "config.yaml",
    ini: "config.ini",
    graphql: "schema.graphql",
  };
  return map[language] ?? "main.txt";
}

/** Normalizes a language tag coming from a fenced code block. */
export function normalizeLanguage(raw: string): string {
  const lang = raw.trim().toLowerCase();
  if (!lang) return "plaintext";
  const alias: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    node: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    python3: "python",
    rb: "ruby",
    golang: "go",
    rs: "rust",
    "c++": "cpp",
    "c#": "csharp",
    cs: "csharp",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    htm: "html",
    text: "plaintext",
    txt: "plaintext",
  };
  if (alias[lang]) return alias[lang];
  // Already a Monaco id?
  if (Object.values(EXTENSION_LANGUAGES).includes(lang)) return lang;
  return "plaintext";
}

/* ---------------------------------------------------------------------- */
/* Starter content                                                         */
/* ---------------------------------------------------------------------- */

const STARTER_TS = `// Welcome to D-Code — DashyCore's built-in editor.
// Write code here, or send "Open in D-Code" from any chat code block.

function greet(name: string): string {
  return \`Hello, \${name}! Welcome to D-Code.\`;
}

console.log(greet("Dashy"));
`;

export function starterFiles(language = "typescript"): DCodeFile[] {
  if (language === "typescript" || language === "javascript") {
    return [
      {
        id: newId(),
        name: "index.ts",
        language: "typescript",
        content: STARTER_TS,
      },
    ];
  }
  return [
    {
      id: newId(),
      name: filenameFromLanguage(language),
      language,
      content: `# ${filenameFromLanguage(language)}\n`,
    },
  ];
}

export function starterProjectDraft(language = "typescript"): DCodeProjectDraft {
  return {
    title: "Untitled project",
    description: null,
    language,
    files: starterFiles(language),
  };
}

/* ---------------------------------------------------------------------- */
/* Row mapping                                                             */
/* ---------------------------------------------------------------------- */

/**
 * Sanitizes a file array before it is persisted into the postgres jsonb
 * column: hard-blocks archive/executable/media paths, keeps binary assets
 * only when encoded as Base64 data URLs, strips NUL bytes, BOM, lone
 * surrogates and non-characters, applies per-file/project size caps and
 * finishes with a full JSON round-trip. A single bad character in an editor
 * buffer can therefore never poison the row.
 *
 * Implemented in `lib/dcode-sanitize` so the exact same gate is reused by
 * every import path in the workspace UI.
 */
function safeFilesPayload(files: DCodeFile[]): DCodeFile[] {
  return toSafeJsonPayload(sanitizeFiles(files));
}

/**
 * Normalizes the jsonb array into DCodeFile[]. Binary assets are kept when
 * stored as Base64 data URLs (images/fonts/PDFs) and skipped only when their
 * raw bytes would poison the column — alongside blocked paths (archives,
 * executables, lockfiles, generated output). Returns the kept files plus the
 * names that were dropped so the workspace can explain the removal.
 */
function coerceFiles(raw: unknown): { files: DCodeFile[]; skipped: string[] } {
  if (!Array.isArray(raw)) return { files: [], skipped: [] };
  const files: DCodeFile[] = [];
  const skipped: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const name =
      typeof f.name === "string" && f.name.trim() ? f.name : "untitled.txt";
    if (isBlockedPath(name)) {
      skipped.push(name);
      continue;
    }
    const content = typeof f.content === "string" ? f.content : "";
    // A binary-named file only survives as an encoded data URL — a raw
    // binary in the row would contain NULs and break the next save.
    if (isBinaryPath(name) && !isDataUrl(content)) {
      skipped.push(name);
      continue;
    }
    files.push({
      id: typeof f.id === "string" ? f.id : newId(),
      name: cleanTextContent(name).slice(0, MAX_PATH_CHARS),
      language:
        typeof f.language === "string" && f.language
          ? f.language
          : languageFromFilename(name),
      content: content.slice(0, MAX_FILE_CONTENT_CHARS),
    });
  }
  return { files, skipped };
}

function rowToProject(row: DCodeProjectRow): DCodeProject {
  const { files, skipped } = coerceFiles(row.files);
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? "Untitled project",
    description: row.description ?? null,
    language: row.language ?? "typescript",
    files,
    isPublic: row.is_public,
    shareSlug: row.share_slug ?? null,
    githubRepoFullName: row.github_repo_full_name ?? null,
    githubDefaultBranch: row.github_default_branch ?? null,
    githubLastSyncedSha: row.github_last_synced_sha ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(skipped.length > 0 ? { skippedFiles: skipped } : {}),
  };
}

/**
 * Error carrying enough of the Supabase/Postgres detail for the UI to tell a
 * dead session apart from a one-off payload/network failure (see
 * `describeSaveError` in lib/dcode-sanitize). `message` stays the raw driver
 * message so existing callers keep working unchanged.
 */
export class DCodeError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "DCodeError";
  }
}

function classError(error: { message?: string; code?: string } | null): Error {
  return new DCodeError(
    error?.message || "D-Code request failed",
    typeof error?.code === "string" ? error.code : undefined
  );
}

/** Cleans free-text columns (title/description) with the same text gate. */
function safeText(value: string | null | undefined, max = 200): string | null {
  if (value === null || value === undefined) return null;
  return cleanTextContent(value).slice(0, max);
}

/* ---------------------------------------------------------------------- */
/* CRUD                                                                    */
/* ---------------------------------------------------------------------- */

/** Lists the signed-in user's projects, most recently touched first. */
export async function listProjects(): Promise<DCodeProject[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dcode_projects")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw classError(error);
  return (data as DCodeProjectRow[]).map(rowToProject);
}

/** Fetches one owned project (RLS hides other users' rows → null). */
export async function getProject(id: string): Promise<DCodeProject | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dcode_projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw classError(error);
  return data ? rowToProject(data as DCodeProjectRow) : null;
}

/** Fetches a public project by its share slug (works for anonymous visitors). */
export async function getProjectByShareSlug(
  shareSlug: string
): Promise<DCodeProject | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dcode_projects")
    .select("*")
    .eq("share_slug", shareSlug)
    .eq("is_public", true)
    .maybeSingle();
  if (error) throw classError(error);
  return data ? rowToProject(data as DCodeProjectRow) : null;
}

/** Creates a project for the signed-in user and returns the stored row. */
export async function createProject(
  draft: DCodeProjectDraft
): Promise<DCodeProject> {
  const supabase = createClient();

  // Explicitly fetch the authenticated user and pass user_id directly in the
  // payload. RLS requires auth.uid() = user_id, so we never rely on a
  // database default (the column has none) or on the insert policy alone.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw classError(
      userError ?? { message: "You must be signed in to create a D-Code project." }
    );
  }

  const { data, error } = await supabase
    .from("dcode_projects")
    .insert({
      user_id: user.id,
      title: safeText(draft.title.trim(), 200) || "Untitled project",
      description: safeText(draft.description, 2000),
      language: draft.language,
      files: safeFilesPayload(draft.files),
    })
    .select("*")
    .single();
  if (error) throw classError(error);
  return rowToProject(data as DCodeProjectRow);
}

/** Applies a partial update and bumps updated_at. Returns the fresh row. */
export async function updateProject(
  id: string,
  patch: DCodeProjectPatch
): Promise<DCodeProject> {
  const supabase = createClient();

  // Explicitly resolve the authenticated user and pass user_id through so the
  // RLS `with check (auth.uid() = user_id)` always matches the session, even
  // when a stale browser row is being patched.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  // Only include user_id when we actually have it; never override ownership
  // with an unauthenticated/empty id.
  if (user?.id) payload.user_id = user.id;
  if (patch.title !== undefined)
    payload.title = safeText(patch.title.trim(), 200) || "Untitled project";
  if (patch.description !== undefined) payload.description = safeText(patch.description, 2000);
  if (patch.language !== undefined) payload.language = patch.language;
  if (patch.files !== undefined) payload.files = safeFilesPayload(patch.files);
  if (patch.isPublic !== undefined) payload.is_public = patch.isPublic;
  // Source Control binding — nullable columns, only sub-fields provided
  // are written (a null value is a real "unbind").
  if (patch.github !== undefined) {
    if (patch.github.fullName !== undefined)
      payload.github_repo_full_name = patch.github.fullName;
    if (patch.github.defaultBranch !== undefined)
      payload.github_default_branch = patch.github.defaultBranch;
    if (patch.github.lastSyncedSha !== undefined)
      payload.github_last_synced_sha = patch.github.lastSyncedSha;
  }

  const { data, error } = await supabase
    .from("dcode_projects")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw classError(error);
  return rowToProject(data as DCodeProjectRow);
}

/**
 * Toggles a project between private and public. Going public assigns a
 * share_slug once (unique; retried on the rare collision) and returns the
 * updated project — use shareSlug for the /d-code/share/<slug> link.
 */
export async function toggleProjectPublic(
  id: string,
  isPublic: boolean
): Promise<DCodeProject> {
  const supabase = createClient();

  if (!isPublic) {
    return updateProject(id, { isPublic: false });
  }

  // Going public: make sure a share slug exists. `update … select` returns
  // zero rows when the RLS-visible row didn't change? No — an update that
  // matches but only writes the slug always returns the row. A unique
  // violation on share_slug is retried with a fresh slug.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = newShareSlug();
    const { data, error } = await supabase
      .from("dcode_projects")
      .update({
        is_public: true,
        share_slug: slug,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (!error) return rowToProject(data as DCodeProjectRow);
    const message = error.message ?? "";
    if (!/duplicate key|unique constraint/i.test(message)) {
      throw classError(error);
    }
    // Slug collision — loop and try a new one.
  }
  throw new Error("Could not allocate a share slug — try again.");
}

/** Deletes a project (files live inline, so this is one call). */
export async function deleteProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("dcode_projects")
    .delete()
    .eq("id", id);
  if (error) throw classError(error);
}
