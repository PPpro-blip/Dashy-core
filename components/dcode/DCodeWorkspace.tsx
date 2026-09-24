"use client";

/**
 * DashyCore v7 — D-Code workspace (Monaco multi-file editor shell).
 *
 * Layout:
 *   ┌────────┬──────────────────────────────────────────┐
 *   │ files  │ tabs                                     │
 *   │ tree   ├──────────────────────────────────────────┤
 *   │ +new   │ MonacoEditor (active file)               │
 *   └────────┴──────────────────────────────────────────┘
 *
 * Modes:
 *   - Existing project  → autosave (1.2s debounce) to Supabase, share button
 *   - Draft (no id yet) → edits are local; first save creates the project
 *   - readOnly          → public share view (no editing, no tree actions)
 *
 * All Supabase access goes through lib/dcode (RLS enforced server-side).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createProject,
  languageFromFilename,
  newId,
  regenerateShareSlug,
  revokeShareLink,
  toggleProjectPublic,
  updateProject,
  type DCodeFile,
  type DCodeProject,
} from "@/lib/dcode";
import {
  BLOCKED_FILE_MESSAGE,
  cleanTextContent,
  containsBinaryMarkers,
  describeSaveError,
  isBlockedPath,
  MAX_FILE_CONTENT_CHARS,
  sanitizeFiles,
} from "@/lib/dcode-sanitize";
import {
  bytesToDataUrl,
  dataUrlByteSize,
  extensionWithDot,
  formatBytes,
  isBinaryPath,
  isDataUrl,
  isImagePath,
  isPreviewableImage,
  mimeForBinaryExt,
  readBlobAsDataUrl,
  readBlobAsText,
} from "@/lib/dcode-binary";
import { DCodeTerminal } from "@/components/dcode/DCodeTerminal";
import {
  MonacoEditor,
  type DCodeMonacoEditor,
} from "@/components/dcode/MonacoEditor";
import { ExtensionsPanel } from "@/components/dcode/ExtensionsPanel";
import { ShareHub } from "@/components/share/ShareHub";
import {
  BUILTIN_EXTENSIONS,
  DEFAULT_DISABLED_IDS,
} from "@/lib/dcode/extensions/registry";
import {
  activateEnabledExtensions,
  deactivateAllExtensions,
  onMonacoEditorReady,
  setExtensionEnabled,
  type DCodeExtensionUiApi,
} from "@/lib/dcode/extensions/runtime";
import {
  getEnabledExtensionIds,
  getFormatOnSave,
  getStoredTheme,
  setExtensionEnabledState,
  setStoredTheme,
} from "@/lib/dcode/extensions/storage";
import { DEFAULT_DCODE_THEME_ID } from "@/lib/dcode/extensions/themes";
import { formatText } from "@/lib/dcode/extensions/format";
import type {
  DCodeMonacoNamespace,
  DCodeWorkspaceApi,
} from "@/lib/dcode/extensions/types";
import { buildShortShareUrl } from "@/lib/share-intents";
import { useToast } from "@/components/Toast";
import {
  AlertIcon,
  BellIcon,
  BracesIcon,
  BranchIcon,
  CheckIcon,
  ChevronRightIcon,
  CodeIcon,
  ExtensionsIcon,
  FileTextIcon,
  FolderIcon,
  GithubIcon,
  GlobeIcon,
  ImageIcon,
  LockIcon,
  LoaderIcon,
  PaperclipIcon,
  PenIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  TerminalIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface DCodeWorkspaceDraft {
  title: string;
  language: string;
  files: DCodeFile[];
}

export interface DCodeWorkspaceProps {
  /** Existing project → edit + autosave. Omit for a fresh scratch project. */
  project?: DCodeProject | null;
  /** Seed content for a scratch project (e.g. "Open in D-Code" from chat). */
  draft?: DCodeWorkspaceDraft | null;
  /** Public read-only view (share page). */
  readOnly?: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 1200;

/** Allowed D-Code file names: alphanumeric, underscore, hyphen, dot. */
const VALID_FILENAME = /^[a-zA-Z0-9_\-\.]+$/;

/** All known built-in extension ids (toggle seeding + storage reads). */
const BUILTIN_EXTENSION_IDS = BUILTIN_EXTENSIONS.map((m) => m.manifest.id);

/** First-run enabled set (everything except the default-disabled ids). */
function defaultEnabledExtensionIds(): string[] {
  return BUILTIN_EXTENSION_IDS.filter(
    (id) => !DEFAULT_DISABLED_IDS.includes(id)
  );
}

/** Compact status-bar labels for enabled extensions. */
const EXTENSION_SHORT_LABELS: Record<string, string> = {
  "dashy.cline": "Cline",
  "dashy.roo": "Roo",
  "dashy.tailwind": "Tailwind",
  "dashy.prettier": "Prettier",
  "dashy.gitlens": "GitLens",
  "dashy.ai": "AI",
  "dashy.themes": "Themes",
  "dashy.autocomplete": "Ghost",
  "dashy.snippets": "Snippets",
  "dashy.markdown-preview": "MD",
};

function extensionShortLabel(id: string): string {
  if (EXTENSION_SHORT_LABELS[id]) return EXTENSION_SHORT_LABELS[id];
  const found = BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id);
  return found?.manifest.name ?? id;
}

function extensionFullName(id: string): string {
  const found = BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id);
  return found?.manifest.name ?? id;
}

/** Emoji glyph for a status-bar badge (manifest icon; none for unknown ids). */
function extensionGlyph(id: string): string | undefined {
  return BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id)?.manifest.icon;
}

interface GithubRepo {
  full_name: string;
  clone_url: string;
  html_url?: string;
  description?: string | null;
}

/** File-tree icon + accent based on the file type. */
function fileIconFor(
  name: string
): { Icon: ComponentType<{ className?: string }>; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "ico", "webp", "bmp", "svg"].includes(ext)) {
    return { Icon: ImageIcon, color: "text-fuchsia-300" };
  }
  if (["woff", "woff2", "ttf", "otf", "eot", "pdf"].includes(ext)) {
    return { Icon: FileTextIcon, color: "text-amber-300" };
  }
  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    return { Icon: CodeIcon, color: "text-cyan-400" };
  }
  if (["css", "json"].includes(ext)) {
    return { Icon: BracesIcon, color: "text-cyan-300" };
  }
  if (["html", "htm"].includes(ext)) {
    return { Icon: GlobeIcon, color: "text-cyan-400" };
  }
  return { Icon: FileTextIcon, color: "text-zinc-400" };
}

/**
 * Import caps. Files live inline in one jsonb row, so a repo import stays
 * within a safe envelope: a file cap, a per-text-file cap (sanitizer), and
 * a tighter per-BINARY cap because Base64 inflates ~33%.
 */
const MAX_IMPORT_FILES = 120;
const MAX_BINARY_BYTES = 350 * 1024; // ~350 KB raw → ~467 KB data URL

function parseGithubRepo(input: string): { owner: string; repo: string } | null {
  const value = input.trim().replace(/\/$/, "").replace(/\.git$/, "");
  const urlMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  const shortMatch = value.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

/**
 * Resolves the GitHub OAuth provider token for the current Supabase session,
 * when present. Used to raise the GitHub API rate limit (60/hr anonymous)
 * and to authorize `/user/repos`.
 */
async function githubProviderToken(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = (session as { provider_token?: string | null } | null)
    ?.provider_token;
  return typeof token === "string" && token ? token : null;
}

function githubHeaders(providerToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (providerToken) headers.Authorization = `Bearer ${providerToken}`;
  return headers;
}

/**
 * Lists the signed-in user's GitHub repositories. When authenticated via
 * GitHub OAuth the provider token authorizes `/user/repos`; otherwise the
 * anonymous call 401s and the modal falls back to a public-repo URL input.
 */
async function listGitHubRepos(): Promise<GithubRepo[]> {
  const providerToken = await githubProviderToken();
  const res = await fetch(
    "https://api.github.com/user/repos?sort=updated&per_page=30&affiliation=owner,collaborator",
    { headers: githubHeaders(providerToken), cache: "no-store" }
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      providerToken
        ? "GitHub token was rejected — re-connect GitHub or paste a repo URL to import."
        : "GitHub repo listing needs a GitHub sign-in — paste any public repo URL to import instead."
    );
  }
  if (res.status === 429) {
    throw new Error(
      "GitHub rate limit reached. Wait a moment or paste a repo URL to import."
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}.`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as GithubRepo[]) : [];
}

/** Result of a repo import: kept files + how many were skipped. */
interface GithubImportResult {
  files: DCodeFile[];
  /** Archives, lockfiles, generated output and oversize files skipped. */
  skipped: number;
  /** Binary assets encoded as Base64 data URLs (previews). */
  binaries: number;
  /** Repo display name ("owner/repo") for the project title on fresh drafts. */
  repoName: string;
}

/**
 * Repository importer: resolves a public GitHub repo, walks its default
 * branch tree and pulls source files into D-Code.
 *
 * Text files come in as-is; binary assets (png/jpg/gif/ico/webp/bmp/woff/
 * woff2/ttf/otf/eot/pdf) are fetched as bytes and encoded as Base64 data
 * URLs — pure ASCII, zero NUL bytes, jsonb-safe, and rendered by the editor
 * preview pane. Archives, executables, audio/video, lockfiles and generated
 * output are skipped (`isBlockedPath`).
 */
async function importGitHubRepository(
  url: string
): Promise<GithubImportResult> {
  const parsed = parseGithubRepo(url);
  if (!parsed) {
    throw new Error(
      "Enter a valid GitHub repo URL (e.g. https://github.com/owner/repo)."
    );
  }
  const { owner, repo } = parsed;
  const providerToken = await githubProviderToken();

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(providerToken),
  });
  if (!repoRes.ok) {
    throw new Error(
      repoRes.status === 404
        ? `GitHub repo "${owner}/${repo}" not found. Check the URL.`
        : `GitHub repo not accessible (HTTP ${repoRes.status}).`
    );
  }
  const repoInfo = (await repoRes.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch ?? "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: githubHeaders(providerToken) }
  );
  if (!treeRes.ok) {
    throw new Error(
      `Could not list GitHub repository contents (HTTP ${treeRes.status}).`
    );
  }
  const tree = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };

  const blobs = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path)
    .map((entry) => ({
      path: entry.path as string,
      size: typeof entry.size === "number" ? entry.size : 0,
    }))
    // Sanitize path characters and collapse to the file basename — D-Code
    // files are a flat list (project has no nested folders).
    .filter(({ path }) => /^[a-zA-Z0-9_@\-\.\(\)\[\]\/]+$/.test(path))
    .slice(0, MAX_IMPORT_FILES * 2);

  let skipped = 0;
  let binaries = 0;
  const seenNames = new Set<string>();
  const files: DCodeFile[] = [];

  for (const { path, size } of blobs) {
    if (files.length >= MAX_IMPORT_FILES) break;
    const name = path.split("/").pop() ?? path;
    const lower = name.toLowerCase();
    // Generated output / VCS / archives / lockfiles never enter files[].
    if (isBlockedPath(path)) {
      skipped += 1;
      continue;
    }
    if (seenNames.has(lower)) {
      skipped += 1;
      continue;
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

    if (isBinaryPath(name)) {
      // Skip oversized binaries before downloading — Base64 inflates ~33%.
      if (size && size > MAX_BINARY_BYTES) {
        skipped += 1;
        continue;
      }
      const blobRes = await fetch(rawUrl);
      if (!blobRes.ok) continue;
      const bytes = new Uint8Array(await blobRes.arrayBuffer());
      if (bytes.length > MAX_BINARY_BYTES) {
        skipped += 1;
        continue;
      }
      seenNames.add(lower);
      binaries += 1;
      files.push({
        id: newId(),
        name,
        language: languageFromFilename(name),
        content: bytesToDataUrl(
          bytes,
          mimeForBinaryExt(extensionWithDot(name))
        ),
      });
      continue;
    }

    const rawRes = await fetch(rawUrl);
    if (!rawRes.ok) continue;
    const content = await rawRes.text();
    // Content sniff catches mislabeled / renamed binaries (NUL bytes).
    if (containsBinaryMarkers(content)) {
      skipped += 1;
      continue;
    }
    if (content.length > MAX_FILE_CONTENT_CHARS) {
      skipped += 1;
      continue;
    }
    seenNames.add(lower);
    files.push({
      id: newId(),
      name,
      language: languageFromFilename(name),
      content: cleanTextContent(content),
    });
  }

  if (files.length === 0) {
    throw new Error(
      skipped > 0
        ? "No importable files found — this repository only contains archives, generated output or oversized media."
        : "No importable source files found in this repository."
    );
  }
  return { files, skipped, binaries, repoName: repo };
}

/**
 * Editor-area preview for binary assets. Raster images render in a sleek
 * centered frame with live dimensions + file size; SVGs (stored as text)
 * render through a blob data URL; other binary assets (fonts, PDFs) show a
 * download card with the encoded size.
 */
function BinaryAssetPreview({ file }: { file: DCodeFile }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const size = file.content.startsWith("data:")
    ? dataUrlByteSize(file.content)
    : file.content.length;
  const isImage = isImagePath(file.name) || file.content.startsWith("data:image/");
  const svgBlobSrc = useMemo(() => {
    if (!file.name.toLowerCase().endsWith(".svg") || file.content.startsWith("data:")) {
      return null;
    }
    try {
      return URL.createObjectURL(
        new Blob([file.content], { type: "image/svg+xml" })
      );
    } catch {
      return null;
    }
  }, [file.name, file.content]);
  useEffect(() => {
    if (!svgBlobSrc) return;
    return () => URL.revokeObjectURL(svgBlobSrc);
  }, [svgBlobSrc]);

  const imgSrc = file.content.startsWith("data:image/")
    ? file.content
    : svgBlobSrc;

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center overflow-auto p-6"
      style={{
        backgroundImage:
          "linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%), linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.03) 75%)",
        backgroundSize: "24px 24px",
        backgroundPosition: "0 0, 12px 12px",
      }}
    >
      {isImage && imgSrc ? (
        <>
          <div className="flex max-h-[70%] max-w-full items-center justify-center rounded-xl border border-white/[0.08] bg-[#0a0e1a]/80 p-4 shadow-2xl shadow-black/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt={file.name}
              onLoad={(e) =>
                setDims({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              className="max-h-[60vh] max-w-full object-contain"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#0d1220]/90 px-4 py-2 font-mono text-[11px] text-zinc-400">
            <ImageIcon className="h-3.5 w-3.5 text-fuchsia-300" />
            <span className="text-zinc-200">{file.name}</span>
            {dims && (
              <span className="text-zinc-500">
                · {dims.w}×{dims.h}
              </span>
            )}
            <span className="text-zinc-500">· {formatBytes(size)}</span>
            <span className="rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300">
              Base64
            </span>
          </div>
        </>
      ) : (
        <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0d1220] p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10">
            <FileTextIcon className="h-7 w-7 text-amber-300" />
          </div>
          <h3 className="mt-4 break-all font-mono text-sm font-semibold text-white">
            {file.name}
          </h3>
          <p className="mt-1.5 font-mono text-[11px] text-zinc-500">
            Binary asset · {formatBytes(size)} · Base64 encoded
          </p>
          {file.content.startsWith("data:") && (
            <a
              href={file.content}
              download={file.name}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
            >
              Download asset
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function DCodeWorkspace({ project, draft, readOnly = false }: DCodeWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();

  /* ------------------------------ core state ----------------------------- */

  const [projectId, setProjectId] = useState<string | null>(project?.id ?? null);
  const [title, setTitle] = useState(
    project?.title ?? draft?.title ?? "Untitled project"
  );
  const [files, setFiles] = useState<DCodeFile[]>(
    project?.files ?? draft?.files ?? []
  );
  const [activeFileId, setActiveFileId] = useState<string>(
    files[0]?.id ?? ""
  );
  const [isPublic, setIsPublic] = useState(project?.isPublic ?? false);
  const [shareSlug, setShareSlug] = useState<string | null>(
    project?.shareSlug ?? null
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    project ? new Date(project.updatedAt) : null
  );
  const [savingShare, setSavingShare] = useState(false);
  const [shareHubOpen, setShareHubOpen] = useState(false);
  const [hubBusy, setHubBusy] = useState<
    "toggle" | "regenerate" | "revoke" | "opening" | null
  >(null);
  const [newFileName, setNewFileName] = useState("");
  const [addingFile, setAddingFile] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  const [githubConnected, setGithubConnected] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [listingRepos, setListingRepos] = useState(false);
  const [importingRepo, setImportingRepo] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  /* ------------------------- VS Code chrome state ------------------------ */

  /** Activity bar selection: which side panel is visible. */
  const [activityView, setActivityView] = useState<
    "explorer" | "search" | "extensions"
  >("explorer");
  /** Search panel query (file names + text contents). */
  const [searchQuery, setSearchQuery] = useState("");
  /** Open editor tabs (VS Code: tabs are a subset of explorer files). */
  const [openFileIds, setOpenFileIds] = useState<string[]>(() =>
    files[0]?.id ? [files[0].id] : []
  );
  /** Bottom panel tab: Terminal / Output / Problems. */
  const [bottomTab, setBottomTab] = useState<
    "terminal" | "output" | "problems"
  >("terminal");
  /** Live cursor position for the status bar. */
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  /**
   * Enabled Dashy Extension ids. Pure-default first render (hydration-safe),
   * then the persisted `dashy.dcode.extensions` set after mount.
   */
  const [enabledExtensions, setEnabledExtensions] = useState<string[]>(
    defaultEnabledExtensionIds
  );
  /** Active Monaco theme id (persisted by the Theme Pack). */
  const [themeId, setThemeId] = useState<string>(DEFAULT_DCODE_THEME_ID);
  /** Output channel lines (saves, imports, failures). */
  const [outputLines, setOutputLines] = useState<string[]>([
    "[D-Code] Output channel ready — saves, imports and errors log here.",
  ]);

  const appendOutput = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setOutputLines((prev) => [...prev.slice(-99), `[${stamp}] ${line}`]);
  }, []);

  /**
   * Latest content seen from the Monaco editor for the ACTIVE file. Monaco
   * reports changes asynchronously; keeping the newest buffer here lets us
   * flush it into `files` state deterministically on tab switch and on save,
   * so an edit is never lost by switching files before a save.
   */
  const editorBufferRef = useRef<{ fileId: string; content: string } | null>(null);

  /** Live editor handles + selection/cursor mirrors for the extensions host. */
  const editorRef = useRef<DCodeMonacoEditor | null>(null);
  const monacoRef = useRef<DCodeMonacoNamespace | null>(null);
  const selectionRef = useRef<string>("");
  const cursorRef = useRef<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });
  /** Buffered DashyAI output chunks (flushed to the Output channel). */
  const aiOutputRef = useRef<{ title: string; chunks: string[] } | null>(null);

  /* Load persisted extension + theme prefs after mount (client-only). */
  useEffect(() => {
    setEnabledExtensions(
      getEnabledExtensionIds(BUILTIN_EXTENSION_IDS, DEFAULT_DISABLED_IDS)
    );
    setThemeId(getStoredTheme());
  }, []);

  /** Latest values for debounced/keyboard saves + the extensions host. */
  const latestRef = useRef({ projectId, title, files, activeFileId });
  useEffect(() => {
    latestRef.current = { projectId, title, files, activeFileId };
  }, [projectId, title, files, activeFileId]);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? files[0] ?? null,
    [files, activeFileId]
  );

  /** Tabs rendered in the tab bar (open ids resolved against live files). */
  const openFiles = useMemo(
    () =>
      openFileIds
        .map((id) => files.find((f) => f.id === id))
        .filter((f): f is DCodeFile => Boolean(f)),
    [files, openFileIds]
  );

  /** Search panel results (names + non-binary contents, capped at 50). */
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return files
      .filter(
        (file) =>
          file.name.toLowerCase().includes(query) ||
          (!file.content.startsWith("data:") &&
            file.content.toLowerCase().includes(query))
      )
      .slice(0, 50);
  }, [files, searchQuery]);

  /** Problems panel: skipped/unsupported files surface as warnings. */
  const problems = useMemo(
    () =>
      (project?.skippedFiles ?? []).map((name) => ({
        file: name,
        message: "Skipped — unsupported or oversize file",
        severity: "warning" as const,
      })),
    // project is a stable seed prop; skippedFiles only change per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.skippedFiles]
  );

  /* The active file always has a tab (imports and deletes repair the list). */
  useEffect(() => {
    if (!activeFileId) return;
    setOpenFileIds((prev) =>
      prev.includes(activeFileId) ? prev : [...prev, activeFileId]
    );
  }, [activeFileId]);

  const handleCursorPosition = useCallback((line: number, column: number) => {
    cursorRef.current = { line, column };
    setCursor({ line, column });
  }, []);

  /**
   * Ingest guard for seed state (chat hand-off, an old project row, a draft
   * built elsewhere). Anything blocked — or a binary-named file whose
   * content was never encoded as a data URL — is dropped from `files[]`
   * before it can reach a save, and the user is told what was removed
   * instead of watching a mystery save failure.
   */
  useEffect(() => {
    const isBad = (f: DCodeFile) =>
      isBlockedPath(f.name) || (isBinaryPath(f.name) && !isDataUrl(f.content));
    const blocked = files.filter(isBad);
    if (blocked.length > 0) {
      setFiles((prev) => prev.filter((f) => !isBad(f)));
      toast.show({
        type: "info",
        title: `${blocked.length} file${blocked.length === 1 ? "" : "s"} skipped`,
        message: BLOCKED_FILE_MESSAGE,
      });
      return;
    }
    const stored = project?.skippedFiles ?? [];
    if (stored.length > 0) {
      toast.show({
        type: "info",
        title: `${stored.length} stored file${
          stored.length === 1 ? "" : "s"
        } not loaded`,
        message: `${stored.slice(0, 3).join(", ")}${
          stored.length > 3 ? "…" : ""
        } — ${BLOCKED_FILE_MESSAGE}`,
      });
    }
    // Runs once per project/draft seed — the toast must not repeat on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* ------------------------------- persistence --------------------------- */

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Timer that un-sticks the header pill after a non-auth save failure. */
  const saveErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Late-bound reference so the retry timer can call the newest `persist`. */
  const persistRef = useRef<(mode: "autosave" | "manual") => Promise<void>>(
    async () => {}
  );

  const clearSaveErrorTimer = useCallback(() => {
    if (saveErrorTimerRef.current) {
      clearTimeout(saveErrorTimerRef.current);
      saveErrorTimerRef.current = null;
    }
  }, []);

  /**
   * Reports a failed save with the *real* driver error, shortened, plus a
   * remediation tip when the payload (binaries/lockfiles/size) is at fault.
   *
   * Only a genuinely dead session stays sticky. Any other failure (payload,
   * network, 5xx) falls back to "Unsaved changes" after a moment and is
   * retried by the next autosave, so one bad save never parks the header in a
   * permanent offline/failed state.
   */
  const handleSaveFailure = useCallback(
    (error: unknown, mode: "autosave" | "manual") => {
      const info = describeSaveError(error);
      clearSaveErrorTimer();
      appendOutput(`Save failed (${mode}): ${info.message}`);

      if (info.isAuth) {
        // Auth really is gone — keep the failure visible until re-sign-in.
        setSaveState("error");
        toast.show({
          type: "error",
          title: "Save failed — sign in again",
          message: info.withTip,
          duration: 8000,
        });
        return;
      }

      setSaveState("error");
      toast.show({
        type: "error",
        title: mode === "manual" ? "Save failed" : "Autosave failed",
        message: info.withTip,
      });

      saveErrorTimerRef.current = setTimeout(() => {
        saveErrorTimerRef.current = null;
        setSaveState("dirty");
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          void persistRef.current("autosave");
        }, AUTOSAVE_DEBOUNCE_MS);
      }, 6000);
    },
    [appendOutput, clearSaveErrorTimer, toast]
  );

  const persist = useCallback(
    async (mode: "autosave" | "manual"): Promise<void> => {
      const { projectId: id, title: t, files: rawFiles } = latestRef.current;
      if (readOnly) return;

      // Flush any pending Monaco buffer into the snapshot being persisted so
      // an edit made in the last few milliseconds is never dropped.
      const buffer = editorBufferRef.current;
      const fs = buffer
        ? rawFiles.map((f) =>
            f.id === buffer.fileId ? { ...f, content: buffer.content } : f
          )
        : rawFiles;

      // Prettier Auto-Formatter: when the extension is enabled and
      // format-on-save is on, beautify text files before persisting.
      let toSave = fs;
      try {
        const enabledNow = getEnabledExtensionIds(
          BUILTIN_EXTENSION_IDS,
          DEFAULT_DISABLED_IDS
        );
        if (enabledNow.includes("dashy.prettier") && getFormatOnSave()) {
          const formatted = await Promise.all(
            fs.map(async (f) => {
              if (f.content.startsWith("data:")) return f;
              const result = await formatText(f.name, f.content);
              return result.ok && result.text !== undefined
                ? { ...f, content: result.text }
                : f;
            })
          );
          // Sync state to what is saved — but never clobber keystrokes typed
          // while Prettier was running (the live buffer wins in state and
          // persists on the next save).
          const liveBuffer = editorBufferRef.current;
          setFiles(
            formatted.map((f) =>
              liveBuffer && f.id === liveBuffer.fileId
                ? { ...f, content: liveBuffer.content }
                : f
            )
          );
          toSave = formatted;
        }
      } catch {
        // Formatting is best-effort — save the snapshot as-is on failure.
      }

      // Draft without a row yet → only an explicit save creates it.
      if (!id) {
        if (mode !== "manual") return;
        setSaveState("saving");
        try {
          const created = await createProject({
            title: t,
            language: toSave[0]?.language ?? "typescript",
            files: toSave,
          });
          setProjectId(created.id);
          latestRef.current.projectId = created.id;
          clearSaveErrorTimer();
          setSaveState("saved");
          setLastSavedAt(new Date(created.updatedAt));
          appendOutput(`Project created — "${t}" (${toSave.length} file${toSave.length === 1 ? "" : "s"}).`);
          toast.show({
            type: "success",
            title: "Project created",
            message: "Saved to your D-Code workspace.",
          });
          // Swap the URL to the canonical editor route (remount is safe —
          // everything is already persisted).
          router.replace(`/d-code/${created.id}`);
        } catch (error) {
          handleSaveFailure(error, "manual");
        }
        return;
      }

      setSaveState("saving");
      try {
        const updated = await updateProject(id, { title: t, files: fs });
        // Success always clears a lingering "Save failed" pill.
        clearSaveErrorTimer();
        setSaveState("saved");
        setLastSavedAt(new Date(updated.updatedAt));
        appendOutput(`Saved "${t}" — ${fs.length} file${fs.length === 1 ? "" : "s"} (${mode}).`);
        if (mode === "manual") {
          toast.show({
            type: "success",
            title: "Saved ✓",
            message: "Your changes are saved to D-Code.",
          });
        }
      } catch (error) {
        handleSaveFailure(error, mode);
      }
    },
    [appendOutput, clearSaveErrorTimer, handleSaveFailure, readOnly, router, toast]
  );

  /* Keep the retry timer pointed at the freshest persist implementation. */
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  /** Marks state dirty and schedules the debounced autosave. */
  const markDirty = useCallback(() => {
    if (readOnly) return;
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist("autosave");
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [persist, readOnly]);

  /* Cmd/Ctrl+S flushes immediately. */
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        void persist("manual");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [persist, readOnly]);

  /* Ctrl + ` toggles the mock terminal drawer. */
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "`" || event.code === "Backquote")
      ) {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly]);

  /* Load the authenticated user's email for the terminal `whoami`. */
  useEffect(() => {
    let cancelled = false;
    async function loadEmail() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled || !user?.email) return;
        setUserEmail(user.email);
      } catch {
        // Email is best-effort; whoami falls back to "(signed out)".
      }
    }
    void loadEmail();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Warn before leaving with unsaved changes (best-effort). */
  useEffect(() => {
    if (readOnly) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [readOnly, saveState]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (saveErrorTimerRef.current) clearTimeout(saveErrorTimerRef.current);
    };
  }, []);

  /* ------------------------------ github state ---------------------------- */

  useEffect(() => {
    let cancelled = false;
    async function detectGithub() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled || !user) return;
        const provider = (user.app_metadata?.provider as string | undefined) ?? "";
        const viaIdentity =
          user.identities?.some((identity) => identity.provider === "github") ??
          false;
        setGithubConnected(provider === "github" || viaIdentity);
      } catch {
        // Auth is best-effort — the GitHub prompt simply won't highlight.
      }
    }
    void detectGithub();
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------------------------------- file ops ------------------------------ */

  const updateActiveContent = useCallback(
    (content: string | undefined) => {
      const next = content ?? "";
      // Remember the latest Monaco buffer for the active file so a tab switch
      // or save can never lose it (Monaco delivers changes asynchronously).
      editorBufferRef.current = { fileId: activeFile?.id ?? "", content: next };
      setFiles((prev) =>
        prev.map((f) => (f.id === activeFile?.id ? { ...f, content: next } : f))
      );
      markDirty();
    },
    [activeFile?.id, markDirty]
  );

  /**
   * Writes any pending Monaco buffer for the active file into `files` state.
   * Called before switching tabs / saving so an in-flight edit is flushed
   * deterministically and never lost.
   */
  const flushActiveBuffer = useCallback(() => {
    const buffer = editorBufferRef.current;
    if (!buffer || !buffer.fileId) return;
    setFiles((prev) =>
      prev.map((f) =>
        f.id === buffer.fileId && f.content !== buffer.content
          ? { ...f, content: buffer.content }
          : f
      )
    );
  }, []);

  /**
   * Switches the active file. Flushes the current Monaco buffer to state FIRST
   * so editing file A then switching to B always preserves A's content.
   */
  const handleSelectFile = useCallback(
    (fileId: string) => {
      const target = latestRef.current.files.find((f) => f.id === fileId);
      if (target && isBlockedPath(target.name)) {
        toast.show({
          type: "error",
          title: "Can't open this file",
          message: BLOCKED_FILE_MESSAGE,
        });
        return;
      }
      flushActiveBuffer();
      setOpenFileIds((prev) =>
        prev.includes(fileId) ? prev : [...prev, fileId]
      );
      setActiveFileId(fileId);
    },
    [flushActiveBuffer, toast]
  );

  /**
   * Closes an editor tab (VS Code: the file stays in the explorer).
   * The last tab stays pinned — a workspace always shows one file.
   */
  const handleCloseTab = useCallback(
    (fileId: string) => {
      flushActiveBuffer();
      if (openFileIds.length <= 1) return;
      const index = openFileIds.indexOf(fileId);
      const remaining = openFileIds.filter((id) => id !== fileId);
      setOpenFileIds(remaining);
      if (fileId === activeFileId) {
        const next =
          remaining[Math.min(Math.max(index - 1, 0), remaining.length - 1)];
        if (next) setActiveFileId(next);
      }
    },
    [activeFileId, flushActiveBuffer, openFileIds]
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      markDirty();
    },
    [markDirty]
  );

  const validateFileName = useCallback(
    (name: string): boolean => {
      const isValid =
        /^[a-zA-Z0-9_\-\.]+$/.test(name) && name.length > 0 && name.length <= 60;
      if (isValid) return true;
      toast.show({
        type: "error",
        title: "Invalid file name",
        message:
          "Invalid file name. Use letters, numbers, dashes, underscores, dots. Max 60 chars.",
      });
      return false;
    },
    [toast]
  );

  const handleAddFile = useCallback(() => {
    const name = newFileName.trim();
    if (!name) return;
    if (!validateFileName(name)) return;
    if (isBlockedPath(name)) {
      toast.show({ type: "error", title: "Unsupported file", message: BLOCKED_FILE_MESSAGE });
      return;
    }
    if (isBinaryPath(name)) {
      toast.show({
        type: "error",
        title: "Binary files can't be created by hand",
        message: "Import images/fonts via “Upload” or “Connect GitHub” — they’re stored as Base64 previews.",
      });
      return;
    }
    if (files.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast.show({
        type: "error",
        title: "File already exists",
        message: `“${name}” is already in this project.`,
      });
      return;
    }
    const file: DCodeFile = {
      id: newId(),
      name,
      language: languageFromFilename(name),
      content: "",
    };
    setFiles((prev) => [...prev, file]);
    setActiveFileId(file.id);
    setNewFileName("");
    setAddingFile(false);
    markDirty();
  }, [files, markDirty, newFileName, toast, validateFileName]);

  const startRename = useCallback((file: DCodeFile) => {
    setRenamingFileId(file.id);
    setRenamingName(file.name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingFileId(null);
    setRenamingName("");
  }, []);

  const handleRenameFile = useCallback(() => {
    const id = renamingFileId;
    const name = renamingName.trim();
    if (!id) return;
    if (!name) {
      cancelRename();
      return;
    }
    if (!validateFileName(name)) return;
    if (isBlockedPath(name)) {
      toast.show({ type: "error", title: "Unsupported file", message: BLOCKED_FILE_MESSAGE });
      return;
    }

    const target = files.find((f) => f.id === id);
    if (!target) {
      cancelRename();
      return;
    }
    if (isBinaryPath(name) && !isBinaryPath(target.name)) {
      toast.show({
        type: "error",
        title: "Binary files can't be created by hand",
        message: "Images/fonts are imported via “Upload” or “Connect GitHub” as Base64 previews.",
      });
      return;
    }
    if (name.toLowerCase() === target.name.toLowerCase()) {
      cancelRename();
      return;
    }
    if (files.some((f) => f.id !== id && f.name.toLowerCase() === name.toLowerCase())) {
      toast.show({
        type: "error",
        title: "File already exists",
        message: `“${name}” is already in this project.`,
      });
      return;
    }

    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, name, language: languageFromFilename(name) }
          : f
      )
    );
    setRenamingFileId(null);
    setRenamingName("");
    markDirty();
  }, [cancelRename, files, markDirty, renamingFileId, renamingName, toast, validateFileName]);

  const handleDeleteFile = useCallback(
    (id: string) => {
      if (files.length <= 1) {
        toast.show({
          type: "error",
          title: "Cannot delete file",
          message: "A project needs at least one file.",
        });
        return;
      }
      setDeletingFileId(id);
      // No confirm dialog in MVP — the file is recoverable via undo of your
      // own edits only; keep it snappy but guard the last file (above).
      window.setTimeout(() => {
        setFiles((prev) => {
          const index = prev.findIndex((f) => f.id === id);
          const next = prev.filter((f) => f.id !== id);
          if (id === activeFileId && next.length > 0) {
            setActiveFileId(next[Math.min(index, next.length - 1)].id);
          }
          return next;
        });
        // Drop the deleted file's tab (the active-tab effect re-opens the
        // neighbor if the tab list would otherwise go empty).
        setOpenFileIds((prev) => prev.filter((openId) => openId !== id));
        setDeletingFileId(null);
        markDirty();
      }, 200);
    },
    [activeFileId, files.length, markDirty, toast]
  );

  /* ----------------------------- file / folder upload --------------------- */

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  /**
   * Reads files picked from disk (single files or an entire folder upload)
   * into D-Code. Text files are read as UTF-8; binary assets are encoded as
   * Base64 data URLs so images/fonts/PDFs import safely and preview in the
   * editor. Archives/executables and generated output are skipped.
   */
  const handleImportFiles = useCallback(
    async (picked: FileList | File[]) => {
      const list = Array.from(picked);
      if (list.length === 0) return;
      setUploadingFiles(true);
      try {
        const added: DCodeFile[] = [];
        let skipped = 0;
        let binaries = 0;
        for (const file of list) {
          if (added.length >= MAX_IMPORT_FILES) {
            skipped += 1;
            continue;
          }
          // Folder uploads carry a relative path; flat files have just a name.
          const relPath =
            (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name;
          const name = relPath.split("/").pop() ?? file.name;
          if (isBlockedPath(relPath) || isBlockedPath(name)) {
            skipped += 1;
            continue;
          }
          if (isBinaryPath(name)) {
            if (file.size > MAX_BINARY_BYTES) {
              skipped += 1;
              continue;
            }
            const dataUrl = await readBlobAsDataUrl(file);
            added.push({
              id: newId(),
              name,
              language: languageFromFilename(name),
              content: dataUrl,
            });
            binaries += 1;
          } else {
            if (file.size > MAX_FILE_CONTENT_CHARS) {
              skipped += 1;
              continue;
            }
            const text = await readBlobAsText(file);
            if (containsBinaryMarkers(text)) {
              skipped += 1;
              continue;
            }
            added.push({
              id: newId(),
              name,
              language: languageFromFilename(name),
              content: cleanTextContent(text),
            });
          }
        }

        // Final gate before the files touch state: same sanitizer as on save.
        const imported = sanitizeFiles(added);
        if (imported.length === 0) {
          toast.show({
            type: "error",
            title: "Nothing to import",
            message: skipped > 0
              ? `${skipped} file${skipped === 1 ? "" : "s"} skipped (unsupported or too large).`
              : "No readable files were found in that selection.",
          });
          return;
        }
        setFiles((prev) => {
          const existing = new Set(prev.map((f) => f.name.toLowerCase()));
          const next = [...prev];
          for (const file of imported) {
            if (!existing.has(file.name.toLowerCase())) {
              next.push(file);
              existing.add(file.name.toLowerCase());
            } else {
              skipped += 1;
            }
          }
          return next;
        });
        setActiveFileId(imported[0]?.id ?? "");
        markDirty();
        const notes = [
          `${imported.length} file${imported.length === 1 ? "" : "s"} imported`,
          binaries > 0 ? `${binaries} as Base64 image${binaries === 1 ? "" : "s"}` : "",
          skipped > 0 ? `${skipped} skipped` : "",
        ].filter(Boolean);
        toast.show({
          type: "success",
          title: "Files added to project",
          message: notes.join(" · ") + ".",
        });
      } catch (error) {
        toast.show({
          type: "error",
          title: "Upload failed",
          message: error instanceof Error ? error.message : "Could not read those files.",
        });
      } finally {
        setUploadingFiles(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [markDirty, toast]
  );

  /* --------------------------------- share -------------------------------- */

  const shareUrl = useMemo(() => {
    if (!shareSlug || typeof window === "undefined") return null;
    return `${window.location.origin}/d-code/share/${shareSlug}`;
  }, [shareSlug]);

  /** Canonical short link handed to the Share Hub (null until a slug exists). */
  const hubShareUrl = useMemo(() => {
    if (!shareSlug || typeof window === "undefined") return null;
    return buildShortShareUrl(window.location.origin, shareSlug);
  }, [shareSlug]);

  /**
   * Opens the Share Hub (link card, preview, composers, privacy, link
   * management). A draft without a row is persisted first so the hub
   * always manages a real project id.
   */
  const openShareHub = useCallback(async () => {
    if (hubBusy) return;
    if (!latestRef.current.projectId) {
      setHubBusy("opening");
      try {
        await persist("manual");
      } finally {
        setHubBusy(null);
      }
      if (!latestRef.current.projectId) {
        toast.show({
          type: "error",
          title: "Save the project before sharing.",
        });
        return;
      }
    }
    setShareHubOpen(true);
  }, [hubBusy, persist, toast]);

  /** Share Hub privacy toggle — updates the DB in real time. */
  const handleHubTogglePublic = useCallback(
    async (next: boolean) => {
      const id = latestRef.current.projectId;
      if (!id || hubBusy) return;
      setHubBusy("toggle");
      try {
        if (next) {
          // Re-sharing a project that still has a slug keeps the SAME link;
          // a first-time (or post-revoke) share mints a fresh slug.
          const updated = shareSlug
            ? await updateProject(id, { isPublic: true })
            : await toggleProjectPublic(id, true);
          if (!updated.shareSlug) {
            throw new Error("Sharing succeeded but no link was assigned.");
          }
          setIsPublic(true);
          setShareSlug(updated.shareSlug);
          toast.show({
            type: "success",
            title: "Project is public 🎉",
            message: "Anyone with the link can view it — no login needed.",
          });
        } else {
          // Going private keeps the slug so re-enabling restores the link.
          // (True revocation — killing the slug — is the Revoke action.)
          await updateProject(id, { isPublic: false });
          setIsPublic(false);
          toast.show({
            type: "info",
            title: "Project is private",
            message: "The share link no longer works.",
          });
        }
      } catch (error) {
        toast.show({
          type: "error",
          title: "Could not update sharing",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setHubBusy(null);
      }
    },
    [hubBusy, shareSlug, toast]
  );

  /** Share Hub "Regenerate slug" — new link, stays public. */
  const handleHubRegenerate = useCallback(async () => {
    const id = latestRef.current.projectId;
    if (!id || hubBusy) return;
    setHubBusy("regenerate");
    try {
      const updated = await regenerateShareSlug(id);
      setIsPublic(true);
      setShareSlug(updated.shareSlug);
      toast.show({
        type: "success",
        title: "New share link generated",
        message: "The old link stopped working immediately.",
      });
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not regenerate the link",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setHubBusy(null);
    }
  }, [hubBusy, toast]);

  /** Share Hub "Revoke link" — private + slug wiped, irreversible. */
  const handleHubRevoke = useCallback(async () => {
    const id = latestRef.current.projectId;
    if (!id || hubBusy) return;
    setHubBusy("revoke");
    try {
      await revokeShareLink(id);
      setIsPublic(false);
      setShareSlug(null);
      toast.show({
        type: "info",
        title: "Share link revoked",
        message: "The project is private and the old link can never work again.",
      });
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not revoke the link",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setHubBusy(null);
    }
  }, [hubBusy, toast]);

  const handleUnshare = useCallback(async () => {
    if (!projectId || savingShare) return;
    setSavingShare(true);
    try {
      await toggleProjectPublic(projectId, false);
      setIsPublic(false);
      toast.show({
        type: "info",
        title: "Project is private",
        message: "The share link no longer works.",
      });
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not update sharing",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSavingShare(false);
    }
  }, [projectId, savingShare, toast]);

  /* --------------------------------- github ------------------------------- */

  const openGitHubModal = useCallback(() => {
    setGithubError(null);
    setGithubRepoUrl("");
    setGithubRepos([]);
    setGithubModalOpen(true);
    // Signed in via GitHub? Fetch the repo browser immediately so the modal
    // opens on a populated list instead of a bare URL field.
    void (async () => {
      setListingRepos(true);
      try {
        const repos = await listGitHubRepos();
        setGithubRepos(repos);
      } catch {
        // Listing is optional — the public-URL import path always works.
      } finally {
        setListingRepos(false);
      }
    })();
  }, []);

  const closeGitHubModal = useCallback(() => {
    setGithubModalOpen(false);
    setGithubError(null);
    setGithubRepoUrl("");
    setGithubRepos([]);
  }, []);

  const handleListRepos = useCallback(async () => {
    setListingRepos(true);
    setGithubError(null);
    try {
      const repos = await listGitHubRepos();
      setGithubRepos(repos);
    } catch (error) {
      setGithubError(
        error instanceof Error
          ? error.message
          : "Could not list GitHub repositories."
      );
    } finally {
      setListingRepos(false);
    }
  }, []);

  const handleImportRepo = useCallback(
    async (repoUrl: string) => {
      if (importingRepo) return;
      setImportingRepo(true);
      setGithubError(null);
      try {
        const result = await importGitHubRepository(repoUrl);
        // Final gate before the files touch state: same sanitizer that runs
        // on save, so nothing un-storable can slip in through any import path
        // (binaries survive only as Base64 data URLs).
        const imported = sanitizeFiles(result.files);

        // Merge deterministically (outside setState) so the same snapshot can
        // be persisted straight away for a fresh draft.
        const current = latestRef.current;
        const merged = [...current.files];
        const existing = new Set(merged.map((f) => f.name.toLowerCase()));
        let duplicates = 0;
        for (const file of imported) {
          if (existing.has(file.name.toLowerCase())) {
            duplicates += 1;
          } else {
            merged.push(file);
            existing.add(file.name.toLowerCase());
          }
        }
        const firstAdded =
          imported.find((f) => !current.files.some((g) => g.id === f.id)) ??
          imported[0];

        const isDraft = !current.projectId;
        const newTitle = isDraft
          ? result.repoName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          : current.title;

        setFiles(merged);
        setActiveFileId(firstAdded?.id ?? "");
        if (isDraft) setTitle(newTitle);
        // Keep the debounce/ref snapshot in sync so an immediate persist
        // (below) writes exactly what the user sees.
        latestRef.current = {
          projectId: current.projectId,
          title: isDraft ? newTitle : current.title,
          files: merged,
          activeFileId: firstAdded?.id ?? current.activeFileId,
        };

        const notes = [
          `${imported.length - duplicates} file${
            imported.length - duplicates === 1 ? "" : "s"
          } added`,
          result.binaries > 0
            ? `${result.binaries} image/asset${result.binaries === 1 ? "" : "s"} as Base64`
            : "",
          result.skipped + duplicates > 0
            ? `${result.skipped + duplicates} skipped`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        toast.show({
          type: "success",
          title: isDraft ? `Imported ${result.repoName}` : "GitHub repo imported",
          message: `${notes}.`,
        });
        closeGitHubModal();

        // A fresh scratch workspace becomes a real D-Code project right away;
        // an existing project picks the change up via autosave.
        if (isDraft) {
          await persist("manual");
        } else {
          markDirty();
        }
      } catch (error) {
        setGithubError(
          error instanceof Error
            ? error.message
            : "Could not import the repository."
        );
      } finally {
        setImportingRepo(false);
      }
    },
    [closeGitHubModal, importingRepo, markDirty, persist, toast]
  );

  /* ---------------------------- extensions host --------------------------- */

  /**
   * DCodeWorkspaceApi adapter — the entire surface Dashy Extensions may
   * touch. Stable across renders (refs + stable callbacks only) so the
   * extension host activates exactly once.
   */
  const workspaceApi = useMemo<DCodeWorkspaceApi>(
    () => ({
      getActiveFile: () => {
        const { files: all, activeFileId: activeId } = latestRef.current;
        return all.find((f) => f.id === activeId) ?? all[0] ?? null;
      },
      getFiles: () => latestRef.current.files,
      getSelectedText: () => {
        const text = selectionRef.current;
        return text ? text : null;
      },
      getCursorPosition: () => ({ ...cursorRef.current }),
      openFile: (fileId: string) => handleSelectFile(fileId),
      applyTheme: (id: string) => {
        setStoredTheme(id);
        setThemeId(id);
      },
      formatActiveFile: async () => {
        const { files: all, activeFileId: activeId } = latestRef.current;
        const file = all.find((f) => f.id === activeId) ?? all[0];
        if (!file || file.content.startsWith("data:")) {
          toast.info("Format Document needs an active text file.");
          return false;
        }
        const result = await formatText(file.name, file.content);
        if (!result.ok || result.text === undefined) {
          toast.error(
            "Format failed",
            result.error ?? "Could not format this file."
          );
          return false;
        }
        if (result.text === file.content) {
          toast.info("Already formatted — no changes.");
          return true;
        }
        const next = result.text;
        editorBufferRef.current = { fileId: file.id, content: next };
        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, content: next } : f))
        );
        markDirty();
        return true;
      },
      getUserId: async () => {
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getUser();
          return data.user?.id ?? null;
        } catch {
          return null;
        }
      },
      // The AI Output drawer streams into the Output channel (bottom panel).
      showAiOutput: (title: string) => {
        aiOutputRef.current = { title, chunks: [] };
        setBottomTab("output");
        setTerminalOpen(true);
        appendOutput(`── ${title} ──`);
      },
      appendAiOutput: (text: string) => {
        aiOutputRef.current?.chunks.push(text);
      },
      finishAiOutput: () => {
        const pending = aiOutputRef.current;
        aiOutputRef.current = null;
        if (!pending) return;
        for (const line of pending.chunks.join("").split("\n")) {
          appendOutput(line);
        }
        appendOutput("── done ──");
      },
      saveActiveFile: async () => {
        flushActiveBuffer();
        await persistRef.current("manual");
      },
      writeFile: (name: string, content: string, language?: string) => {
        const clean = name.trim();
        if (!clean || !VALID_FILENAME.test(clean) || clean.length > 60) {
          toast.error(
            "Invalid file name",
            "Use letters, numbers, dashes, underscores, dots. Max 60 chars."
          );
          return "";
        }
        if (isBlockedPath(clean)) {
          toast.error("Unsupported file", BLOCKED_FILE_MESSAGE);
          return "";
        }
        if (isBinaryPath(clean)) {
          toast.error(
            "Binary files can't be created by extensions",
            "Images/fonts import via “Upload” as Base64 previews."
          );
          return "";
        }
        const existing = latestRef.current.files.find(
          (f) => f.name.toLowerCase() === clean.toLowerCase()
        );
        const id = existing?.id ?? newId();
        const lang = language ?? languageFromFilename(clean);
        setFiles((prev) => {
          const found = prev.some((f) => f.id === id);
          if (found) {
            return prev.map((f) =>
              f.id === id ? { ...f, name: clean, language: lang, content } : f
            );
          }
          return [...prev, { id, name: clean, language: lang, content }];
        });
        setActiveFileId(id);
        editorBufferRef.current = { fileId: id, content };
        markDirty();
        return id;
      },
      replaceSelection: (text: string) => {
        const editor = editorRef.current;
        if (!editor) return false;
        const selection = editor.getSelection();
        if (!selection) return false;
        editor.executeEdits("dashy-extension", [
          { range: selection, text, forceMoveMarkers: true },
        ]);
        editor.focus();
        return true;
      },
      setActiveFileContent: (content: string) => {
        const activeId = latestRef.current.activeFileId;
        editorBufferRef.current = { fileId: activeId, content };
        setFiles((prev) =>
          prev.map((f) => (f.id === activeId ? { ...f, content } : f))
        );
        markDirty();
      },
      getMonaco: () => monacoRef.current,
      getEditor: () => editorRef.current,
    }),
    [appendOutput, flushActiveBuffer, handleSelectFile, markDirty, toast]
  );

  const extensionUi = useMemo<DCodeExtensionUiApi>(
    () => ({
      showQuickPick: async (items, title) => {
        appendOutput(
          `[extensions] quick pick requested (“${title ?? "options"}”, ${items.length} items) — no picker UI mounted`
        );
        toast.info(
          title ?? "Pick an option",
          "The quick-pick UI isn't mounted in this workspace yet."
        );
        return null;
      },
      notify: (message: string) => {
        toast.info(message);
      },
      showView: (viewId: string) => {
        appendOutput(`[extensions] view requested: ${viewId}`);
        toast.info(
          "Extension view",
          `The “${viewId}” panel isn't mounted in this workspace yet.`
        );
      },
    }),
    [appendOutput, toast]
  );

  /* Activate enabled extensions once (skipped in read-only share views). */
  useEffect(() => {
    if (readOnly) return;
    void activateEnabledExtensions(workspaceApi, extensionUi);
    return () => {
      void deactivateAllExtensions();
    };
  }, [extensionUi, readOnly, workspaceApi]);

  /** Live editor refs for extensions + re-activation of Monaco providers. */
  const handleEditorReady = useCallback(
    (editor: DCodeMonacoEditor, monaco: DCodeMonacoNamespace) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      if (!readOnly) void onMonacoEditorReady(workspaceApi, extensionUi);
    },
    [extensionUi, readOnly, workspaceApi]
  );

  const handleSelectionChange = useCallback((selectedText: string) => {
    selectionRef.current = selectedText;
  }, []);

  /** Reliable enable/disable: persists + activates/deactivates live. */
  const handleExtensionToggle = useCallback(
    (id: string, enabled: boolean) => {
      setEnabledExtensions((prev) =>
        enabled
          ? prev.includes(id)
            ? prev
            : [...prev, id]
          : prev.filter((x) => x !== id)
      );
      if (readOnly) {
        setExtensionEnabledState(
          id,
          enabled,
          BUILTIN_EXTENSION_IDS,
          DEFAULT_DISABLED_IDS
        );
        return;
      }
      void setExtensionEnabled(id, enabled, workspaceApi, extensionUi);
    },
    [extensionUi, readOnly, workspaceApi]
  );

  /* ------------------------------ save status ----------------------------- */

  const statusLabel = () => {
    if (readOnly) {
      return (
        <>
          <GlobeIcon className="h-3 w-3 text-cyan-400" />
          Read-only view
        </>
      );
    }
    switch (saveState) {
      case "saving":
        return (
          <>
            <LoaderIcon className="h-3 w-3 animate-spin text-cyan-400" />
            Saving…
          </>
        );
      case "saved":
        return (
          <>
            <CheckIcon className="h-3 w-3 text-emerald-400" />
            Saved
            {lastSavedAt
              ? ` ${lastSavedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </>
        );
      case "error":
        return (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Save failed — press ⌘S to retry
          </>
        );
      case "dirty":
        return (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {projectId ? "Unsaved changes" : "Draft — press ⌘S to save"}
          </>
        );
      default:
        return projectId ? (
          <>
            <CheckIcon className="h-3 w-3 text-emerald-400" />
            All changes saved
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            New project
          </>
        );
    }
  };

  /* --------------------------------- render ------------------------------- */

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-[#0b0f19]">
      {/* VS Code-style application menu */}
      <nav aria-label="Editor menu" className="flex flex-shrink-0 items-center gap-5 border-b border-white/[0.06] bg-[#111827] px-4 py-1.5 text-[11px] text-zinc-400">
        <span className="mr-2 font-semibold text-cyan-300">D-Code</span>
        {['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'].map((item) => <button key={item} type="button" className="transition-colors hover:text-white">{item}</button>)}
      </nav>
      {/* Top bar: editable title + save status + share */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/[0.06] bg-navy/60 px-4 py-2.5">
        {readOnly ? (
          <h1 className="min-w-0 truncate text-sm font-semibold text-white">{title}</h1>
        ) : (
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Project title"
            aria-label="Project title"
            spellCheck={false}
            className="min-w-0 max-w-xs flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-white outline-none transition-colors hover:border-white/[0.08] hover:bg-white/[0.03] focus:border-cyan-400/40 focus:bg-white/[0.03]"
          />
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400">
            {statusLabel()}
          </span>

          {!readOnly && !projectId && (
            <button
              type="button"
              onClick={() => void persist("manual")}
              disabled={saveState === "saving"}
              title="Save this project to your workspace (⌘S)"
              className="flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20 disabled:opacity-50"
            >
              Save
            </button>
          )}

          {readOnly ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300">
              <GlobeIcon className="h-3 w-3" />
              Shared read-only
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTerminalOpen((open) => !open)}
                title="Toggle bottom panel (Ctrl + `)"
                aria-label="Toggle bottom panel"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  terminalOpen
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-cyan-400/40 hover:text-cyan-300"
                }`}
              >
                <TerminalIcon className="h-3.5 w-3.5" />
                Terminal
              </button>
              <button
                type="button"
                onClick={openGitHubModal}
                title="Connect GitHub — import or link a repository"
                aria-label="Connect GitHub"
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
              >
                <GithubIcon
                  className={`h-3.5 w-3.5 ${
                    githubConnected ? "text-cyan-300" : "text-zinc-500"
                  }`}
                />
                Connect GitHub
              </button>
              {isPublic && (
                <button
                  type="button"
                  onClick={() => void handleUnshare()}
                  disabled={savingShare}
                  title="Make private (revokes the share link)"
                  aria-label="Make private"
                  className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
                >
                  {savingShare ? (
                    <LoaderIcon className="h-3 w-3 animate-spin" />
                  ) : (
                    <LockIcon className="h-3 w-3" />
                  )}
                  Make private
                </button>
              )}
              <button
                type="button"
                onClick={() => void openShareHub()}
                disabled={hubBusy !== null}
                title="Open the Share Hub — link, preview, composers & privacy"
                aria-label="Open share hub"
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-2.5 py-1.5 text-[11px] font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
              >
                {hubBusy === "opening" ? (
                  <LoaderIcon className="h-3 w-3 animate-spin" />
                ) : isPublic ? (
                  <GlobeIcon className="h-3 w-3" />
                ) : (
                  <ShareIcon className="h-3 w-3" />
                )}
                Share
              </button>
            </>
          )}
        </div>
      </div>

      {/* VS Code body: activity bar + side panel + editor column */}
      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav
          aria-label="Activity bar"
          className="flex w-12 flex-shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0a0e1a]/80 py-2"
        >
          {(
            [
              { id: "explorer", label: "Explorer", Icon: FolderIcon },
              { id: "search", label: "Search", Icon: SearchIcon },
              { id: "extensions", label: "Extensions", Icon: ExtensionsIcon },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={activityView === id}
              onClick={() => setActivityView(id)}
              className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                activityView === id
                  ? "bg-cyan-500/10 text-cyan-300"
                  : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
            >
              {activityView === id && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cyan-400" />
              )}
              <Icon className="h-5 w-5" />
            </button>
          ))}
          <div className="mt-auto">
            <button
              type="button"
              title="Settings"
              aria-label="Settings"
              onClick={() => router.push("/settings")}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
            >
              <SettingsIcon className="h-5 w-5" />
            </button>
          </div>
        </nav>

        {/* Side panel — Explorer (file tree) */}
        {activityView === "explorer" && (
        <aside className="flex min-h-0 w-52 flex-shrink-0 flex-col border-r border-white/[0.06] bg-navy/40">
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Files
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2">
            {files.map((file) => {
              const isActive = activeFile?.id === file.id;
              const { Icon: FileIcon, color: fileColor } = fileIconFor(file.name);
              const isRenaming = renamingFileId === file.id;
              return (
                <li key={file.id} className="group relative">
                  {isRenaming ? (
                    <div className="space-y-1.5 rounded-lg border border-cyan-400/40 bg-white/[0.03] p-1.5">
                      <input
                        type="text"
                        value={renamingName}
                        autoFocus
                        onChange={(e) => setRenamingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameFile();
                          if (e.key === "Escape") cancelRename();
                        }}
                        placeholder="e.g. utils.ts"
                        aria-label="Rename file"
                        spellCheck={false}
                        className="h-8 w-full rounded-md bg-transparent px-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={handleRenameFile}
                          className="flex-1 rounded-md bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          className="flex-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSelectFile(file.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                          isActive
                            ? "bg-cyan-500/10 text-cyan-300"
                            : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                        }`}
                      >
                        <FileIcon
                          className={`h-3.5 w-3.5 flex-shrink-0 ${fileColor}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      </button>
                      {!readOnly && (
                        <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-[#0d1020]/90 p-0.5 group-hover:flex">
                          <button
                            type="button"
                            aria-label={`Rename ${file.name}`}
                            title={`Rename ${file.name}`}
                            onClick={() => startRename(file)}
                            className="rounded-md p-1 text-zinc-500 transition-colors hover:text-cyan-300"
                          >
                            <PenIcon className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${file.name}`}
                            title={`Delete ${file.name}`}
                            onClick={() => handleDeleteFile(file.id)}
                            disabled={deletingFileId !== null}
                            className="rounded-md p-1 text-zinc-500 transition-colors hover:text-red-400 disabled:opacity-50"
                          >
                            {deletingFileId === file.id ? (
                              <LoaderIcon className="h-3 w-3 animate-spin" />
                            ) : (
                              <TrashIcon className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {/* New file */}
          {!readOnly && (
            <div className="flex-shrink-0 border-t border-white/[0.06] p-2">
              {addingFile ? (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={newFileName}
                    autoFocus
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddFile();
                      if (e.key === "Escape") {
                        setAddingFile(false);
                        setNewFileName("");
                      }
                    }}
                    placeholder="e.g. utils.ts"
                    aria-label="New file name"
                    spellCheck={false}
                    className="h-8 w-full rounded-lg border border-cyan-400/40 bg-white/[0.03] px-2 text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleAddFile}
                      className="flex-1 rounded-lg bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingFile(false);
                        setNewFileName("");
                      }}
                      className="flex-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setAddingFile(true)}
                    className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/[0.10] px-2.5 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    New file
                  </button>
                  {!readOnly && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFiles}
                        title="Upload files — images import as Base64 previews"
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] px-2 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
                      >
                        {uploadingFiles ? (
                          <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PaperclipIcon className="h-3.5 w-3.5" />
                        )}
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => folderInputRef.current?.click()}
                        disabled={uploadingFiles}
                        title="Upload an entire folder (images, fonts and source files)"
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] px-2 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
                      >
                        <FolderIcon className="h-3.5 w-3.5" />
                        Folder
                      </button>
                    </div>
                  )}
                  {/* Hidden inputs: multiple files, or a whole folder. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) void handleImportFiles(e.target.files);
                    }}
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    hidden
                    {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                    onChange={(e) => {
                      if (e.target.files) void handleImportFiles(e.target.files);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </aside>
        )}

        {/* Side panel — Search */}
        {activityView === "search" && (
          <aside className="flex min-h-0 w-52 flex-shrink-0 flex-col border-r border-white/[0.06] bg-navy/40">
            <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Search
            </p>
            <div className="flex-shrink-0 px-2 pb-2">
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search files…"
                  aria-label="Search files"
                  spellCheck={false}
                  className="h-8 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-8 pr-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/40"
                />
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {searchResults.map((file) => {
                const { Icon: FileIcon, color: fileColor } = fileIconFor(file.name);
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectFile(file.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                        activeFile?.id === file.id
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                      }`}
                    >
                      <FileIcon className={`h-3.5 w-3.5 flex-shrink-0 ${fileColor}`} />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    </button>
                  </li>
                );
              })}
              {searchResults.length === 0 && (
                <li className="px-2 py-6 text-center text-xs leading-relaxed text-zinc-600">
                  {searchQuery.trim()
                    ? "No matching files."
                    : "Type to search file names and contents."}
                </li>
              )}
            </ul>
          </aside>
        )}

        {/* Side panel — Extensions (real Discover + Installed, web-safe) */}
        {activityView === "extensions" && (
          <aside className="flex min-h-0 w-72 flex-shrink-0 flex-col border-r border-white/[0.06] bg-navy/40">
            <ExtensionsPanel
              enabled={enabledExtensions}
              onToggle={handleExtensionToggle}
            />
          </aside>
        )}

        {/* Editor column */}
        <div className="flex min-w-0 flex-1 flex-col">
     
          {/* Tab bar (VS Code chrome) */}
          <div
            role="tablist"
            aria-label="Open files"
            className="flex flex-shrink-0 items-end gap-0.5 overflow-x-auto border-b border-white/[0.06] bg-[#0d1220]/60 px-2 pt-1.5"
          >
            {openFiles.map((file) => {
              const isActive = activeFile?.id === file.id;
              const { Icon: TabIcon, color: tabColor } = fileIconFor(file.name);
              return (
                <div
                  key={file.id}
                  role="tab"
                  aria-selected={isActive}
                  className={`group flex flex-shrink-0 items-center gap-1 rounded-t-lg border-x border-t px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                    isActive
                      ? "border-white/[0.08] bg-[#0a0e1a] text-zinc-100"
                      : "border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectFile(file.id)}
                    className="flex items-center gap-1.5"
                    aria-label={`Open ${file.name}`}
                  >
                    <TabIcon className={`h-3.5 w-3.5 ${tabColor}`} />
                    {file.name}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(file.id);
                    }}
                    aria-label={`Close ${file.name}`}
                    title={`Close ${file.name}`}
                    className={`rounded p-0.5 transition-all hover:bg-white/10 hover:text-zinc-100 ${
                      isActive
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Breadcrumbs (VS Code chrome) */}
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#0a0e1a]/60 px-3 py-1 text-[11px]">
            <span className="max-w-[12rem] truncate font-medium text-zinc-400">
              {title.trim() || "Untitled project"}
            </span>
            <ChevronRightIcon className="h-3 w-3 flex-shrink-0 text-zinc-600" />
            {activeFile ? (
              <span className="flex min-w-0 items-center gap-1 truncate text-zinc-200">
                {(() => {
                  const { Icon: CrumbIcon, color: crumbColor } = fileIconFor(
                    activeFile.name
                  );
                  return (
                    <CrumbIcon
                      className={`h-3 w-3 flex-shrink-0 ${crumbColor}`}
                    />
                  );
                })()}
                <span className="truncate">{activeFile.name}</span>
              </span>
            ) : (
              <span className="text-zinc-600">no file open</span>
            )}
          </div>

          {/* Monaco (or binary asset preview for images/fonts) */}
          <div className="min-h-0 flex-1">
            {activeFile ? (
              isPreviewableImage(activeFile.name, activeFile.content) ? (
                <BinaryAssetPreview file={activeFile} />
              ) : (
                <MonacoEditor
                  key={`${activeFile.id}:${activeFile.language}`}
                  value={activeFile.content}
                  language={activeFile.language}
                  onChange={readOnly ? undefined : updateActiveContent}
                  readOnly={readOnly}
                  theme={themeId}
                  onEditorReady={handleEditorReady}
                  onSelectionChange={handleSelectionChange}
                  onCursorPosition={handleCursorPosition}
                />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-400/10 shadow-2xl shadow-cyan-500/10">
                  <CodeIcon className="h-8 w-8 text-cyan-400" />
                </div>
                <h2 className="mt-6 text-xl font-semibold tracking-tight text-white">
                  Welcome to D-Code Workspace
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                  Create a source file to start coding, or open one of your
                  existing projects.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAddingFile(true)}
                    className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Create New File
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/projects")}
                    className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                  >
                    <FolderIcon className="h-4 w-4" />
                    Open Project
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>

      {/* Bottom panel — Terminal / Output / Problems (VS Code chrome) */}
      {terminalOpen && (
        <div
          className="flex h-64 flex-shrink-0 flex-col border-t border-white/[0.06]"
          style={{ backgroundColor: "#05070d" }}
        >
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#0a0e1a] px-2 py-1">
            {(
              [
                { id: "terminal", label: "Terminal" },
                { id: "output", label: "Output" },
                {
                  id: "problems",
                  label: `Problems${problems.length > 0 ? ` (${problems.length})` : ""}`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBottomTab(tab.id)}
                aria-pressed={bottomTab === tab.id}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  bottomTab === tab.id
                    ? "bg-white/[0.06] text-cyan-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <span className="ml-1 hidden font-mono text-[10px] text-zinc-600 sm:inline">
              Ctrl + `
            </span>
            <button
              type="button"
              onClick={() => setTerminalOpen(false)}
              aria-label="Close panel"
              title="Close panel (Ctrl + `)"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {bottomTab === "terminal" ? (
              <DCodeTerminal
                bare
                files={files}
                projectTitle={title}
                userEmail={userEmail}
                onOpenFile={handleSelectFile}
                onClose={() => setTerminalOpen(false)}
              />
            ) : bottomTab === "output" ? (
              <div className="h-full overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
                {outputLines.map((line, index) => (
                  <div
                    key={index}
                    className="whitespace-pre-wrap text-zinc-300"
                  >
                    {line || " "}
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full overflow-y-auto px-3 py-2 text-[12px]">
                {problems.length === 0 ? (
                  <div className="flex h-full items-center justify-center gap-2 text-zinc-500">
                    <CheckIcon className="h-4 w-4 text-emerald-400" />
                    <span>No problems detected in this workspace.</span>
                  </div>
                ) : (
                  problems.map((problem, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 border-b border-white/[0.04] py-1.5"
                    >
                      <AlertIcon className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                      <span className="font-mono text-zinc-200">
                        {problem.file}
                      </span>
                      <span className="truncate text-zinc-500">
                        {problem.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status bar (VS Code chrome) */}
      <footer className="flex h-7 flex-shrink-0 items-center gap-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3 text-[11px] font-medium text-white">
        <span
          className="flex items-center gap-1.5"
          title={isPublic ? "Public project" : "Private project"}
        >
          <BranchIcon className="h-3 w-3" />
          main{saveState === "dirty" || saveState === "saving" ? "*" : ""}
        </span>
        <button
          type="button"
          onClick={() => {
            setBottomTab("problems");
            setTerminalOpen(true);
          }}
          title="Show problems"
          className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-white/15"
        >
          <AlertIcon className="h-3 w-3" />
          {problems.length}
        </button>
        <button
          type="button"
          onClick={() => setActivityView("extensions")}
          title={`${enabledExtensions.length} extensions enabled — open Extensions`}
          className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-white/15"
        >
          <ExtensionsIcon className="h-3 w-3" />
          {enabledExtensions.length}
        </button>
        <span className="hidden items-center gap-1 md:flex">
          {enabledExtensions.slice(0, 3).map((id) => (
            <span
              key={id}
              title={`${extensionFullName(id)} — active`}
              className="flex items-center gap-1 rounded bg-white/15 px-1.5 py-px text-[10px] font-semibold"
            >
              {extensionGlyph(id) ? (
                <span aria-hidden="true">{extensionGlyph(id)}</span>
              ) : null}
              {extensionShortLabel(id)}
            </span>
          ))}
          {enabledExtensions.length > 3 && (
            <span
              className="text-[10px] opacity-80"
              title={enabledExtensions
                .slice(3)
                .map(extensionFullName)
                .join(", ")}
            >
              +{enabledExtensions.length - 3}
            </span>
          )}
        </span>
        <span className="hidden items-center gap-1.5 opacity-90 sm:flex">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "dirty"
              ? projectId
                ? "Unsaved changes"
                : "Draft — press ⌘S to save"
              : saveState === "error"
                ? "Save failed"
                : "Saved"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span>
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span className="hidden sm:inline">Spaces: 2</span>
          <span className="hidden sm:inline">UTF-8</span>
          <span className="hidden capitalize md:inline">
            {activeFile?.language ?? "plaintext"}
          </span>
          <button
            type="button"
            onClick={() => setTerminalOpen((open) => !open)}
            title="Toggle panel (Ctrl + `)"
            aria-label="Toggle panel"
            className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-white/15"
          >
            <TerminalIcon className="h-3 w-3" />
          </button>
          <BellIcon className="hidden h-3 w-3 opacity-80 sm:block" />
        </div>
      </footer>

      {/* GitHub connect / import modal */}
      {githubModalOpen && (
        <>
          <button
            type="button"
            aria-label="Close GitHub connect dialog"
            className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-sm"
            onClick={closeGitHubModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Connect GitHub"
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d1220] shadow-2xl shadow-black/80"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#24292f] text-white">
                <GithubIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-white">Connect GitHub</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Import a repository or fetch raw files into this project.
                </p>
              </div>
              <button
                type="button"
                onClick={closeGitHubModal}
                aria-label="Close"
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label
                  htmlFor="github-repo-url"
                  className="mb-1.5 block text-xs font-medium text-zinc-400"
                >
                  GitHub repo URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="github-repo-url"
                    type="text"
                    value={githubRepoUrl}
                    onChange={(e) => setGithubRepoUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && githubRepoUrl.trim()) {
                        void handleImportRepo(githubRepoUrl);
                      }
                    }}
                    placeholder="https://github.com/owner/repo"
                    spellCheck={false}
                    className="h-9 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-400/50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleImportRepo(githubRepoUrl)}
                    disabled={!githubRepoUrl.trim() || importingRepo}
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-[#06202a] transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {importingRepo ? (
                      <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlusIcon className="h-3.5 w-3.5" />
                    )}
                    Import
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-600">
                  Paste any public repo (e.g. https://github.com/PPpro-blip/Dashy-core).
                  Source files plus up to {MAX_IMPORT_FILES} — images and fonts come in as
                  Base64 previews.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">
                  or
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-zinc-400">
                    Your repositories
                    {githubConnected ? "" : " — sign in with GitHub to list"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleListRepos()}
                    disabled={listingRepos || importingRepo}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
                  >
                    {listingRepos ? "Loading…" : "List repos"}
                  </button>
                </div>

                {listingRepos && githubRepos.length === 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-xs text-zinc-500">
                    <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    Fetching your repositories from GitHub…
                  </div>
                )}

                {githubRepos.length > 0 && (
                  <ul className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20">
                    {githubRepos.map((repo) => (
                      <li key={repo.full_name}>
                        <button
                          type="button"
                          onClick={() => void handleImportRepo(repo.clone_url)}
                          disabled={importingRepo}
                          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-50"
                        >
                          <GithubIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs text-zinc-200">
                              {repo.full_name}
                            </span>
                            {repo.description && (
                              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                {repo.description}
                              </span>
                            )}
                          </span>
                          <PlusIcon className="h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {githubError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300"
                >
                  {githubError}
                </p>
              )}

              {githubConnected && (
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Signed in with GitHub — repo listing uses your provider token.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Share Hub — owner-only (visitors get it via the public share page). */}
      {shareHubOpen && !readOnly && (
        <ShareHub
          key={shareSlug ?? "private"}
          project={
            projectId ? { id: projectId, title, files } : null
          }
          shareUrl={hubShareUrl}
          privacy={{
            isPublic,
            busy: hubBusy === "toggle",
            onToggle: (next) => void handleHubTogglePublic(next),
          }}
          management={{
            busy: hubBusy === "regenerate" || hubBusy === "revoke" ? hubBusy : null,
            canManage: isPublic || shareSlug !== null,
            onRegenerate: () => void handleHubRegenerate(),
            onRevoke: () => void handleHubRevoke(),
          }}
          onClose={() => setShareHubOpen(false)}
        />
      )}
    </div>
  );
}
