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
}

export interface DCodeProjectDraft {
  title: string;
  description?: string | null;
  language: string;
  files: DCodeFile[];
}

/** Patch accepted by updateProject — only provided fields change. */
export interface DCodeProjectPatch {
  title?: string;
  description?: string | null;
  language?: string;
  files?: DCodeFile[];
  isPublic?: boolean;
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

function coerceFiles(raw: unknown): DCodeFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({
      id: typeof f.id === "string" ? f.id : newId(),
      name: typeof f.name === "string" && f.name.trim() ? f.name : "untitled.txt",
      language:
        typeof f.language === "string" && f.language
          ? f.language
          : languageFromFilename(typeof f.name === "string" ? f.name : ""),
      content: typeof f.content === "string" ? f.content : "",
    }));
}

function rowToProject(row: DCodeProjectRow): DCodeProject {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? "Untitled project",
    description: row.description ?? null,
    language: row.language ?? "typescript",
    files: coerceFiles(row.files),
    isPublic: row.is_public,
    shareSlug: row.share_slug ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function classError(error: { message?: string } | null): Error {
  return new Error(error?.message || "D-Code request failed");
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
  const { data, error } = await supabase
    .from("dcode_projects")
    .insert({
      title: draft.title.trim() || "Untitled project",
      description: draft.description ?? null,
      language: draft.language,
      files: draft.files,
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
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) payload.title = patch.title.trim() || "Untitled project";
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.language !== undefined) payload.language = patch.language;
  if (patch.files !== undefined) payload.files = patch.files;
  if (patch.isPublic !== undefined) payload.is_public = patch.isPublic;

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
