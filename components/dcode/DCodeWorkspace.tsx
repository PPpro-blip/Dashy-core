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
  ensureProjectShareSlug,
  languageFromFilename,
  newId,
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
import {
  DCodeTerminal,
  type DCodeProblem,
  type TerminalPanelTab,
} from "@/components/dcode/DCodeTerminal";
import { MonacoEditor } from "@/components/dcode/MonacoEditor";
import { ShareHub } from "@/components/ShareHub";
import { useToast } from "@/components/Toast";
import { DEFAULT_MODEL_ID, getModelById } from "@/lib/models";
import { getStoredModel, MODEL_CHANGED_EVENT } from "@/lib/preferences";
import {
  BracesIcon,
  CheckIcon,
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
type SidePanel = "explorer" | "search" | "extensions" | "settings";

interface FileSearchResult {
  file: DCodeFile;
  line: number | null;
  excerpt: string;
}

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

interface GithubRepo {
  full_name: string;
  clone_url: string;
  html_url?: string;
  description?: string | null;
}

/** File-tree icon + accent based on the file type. */
function fileIconFor(name: string): {
  Icon: ComponentType<{ className?: string }>;
  color: string;
} {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (
    ["png", "jpg", "jpeg", "gif", "ico", "webp", "bmp", "svg"].includes(ext)
  ) {
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

/** VS Code-like, distinct file-type glyphs in the tree, tabs and breadcrumbs. */
function FileKindIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = ["ts", "tsx", "mts", "cts"].includes(ext)
    ? "TS"
    : ["js", "jsx", "mjs", "cjs"].includes(ext)
      ? "JS"
      : ["css", "scss", "less"].includes(ext)
        ? "CSS"
        : null;
  if (kind) {
    const color = {
      TS: "border-blue-400/35 bg-blue-400/15 text-blue-300",
      JS: "border-amber-300/35 bg-amber-300/15 text-amber-200",
      CSS: "border-violet-400/35 bg-violet-400/15 text-violet-300",
    }[kind];
    return (
      <span
        aria-hidden="true"
        className={`inline-flex h-[18px] w-[23px] flex-shrink-0 items-center justify-center rounded-[3px] border font-mono text-[8px] font-extrabold tracking-tight ${color}`}
      >
        {kind}
      </span>
    );
  }
  const { Icon, color } = fileIconFor(name);
  return <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${color}`} />;
}

/**
 * Import caps. Files live inline in one jsonb row, so a repo import stays
 * within a safe envelope: a file cap, a per-text-file cap (sanitizer), and
 * a tighter per-BINARY cap because Base64 inflates ~33%.
 */
const MAX_IMPORT_FILES = 120;
const MAX_BINARY_BYTES = 350 * 1024; // ~350 KB raw → ~467 KB data URL

function parseGithubRepo(
  input: string,
): { owner: string; repo: string } | null {
  const value = input
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
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
    { headers: githubHeaders(providerToken), cache: "no-store" },
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      providerToken
        ? "GitHub token was rejected — re-connect GitHub or paste a repo URL to import."
        : "GitHub repo listing needs a GitHub sign-in — paste any public repo URL to import instead.",
    );
  }
  if (res.status === 429) {
    throw new Error(
      "GitHub rate limit reached. Wait a moment or paste a repo URL to import.",
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
  url: string,
): Promise<GithubImportResult> {
  const parsed = parseGithubRepo(url);
  if (!parsed) {
    throw new Error(
      "Enter a valid GitHub repo URL (e.g. https://github.com/owner/repo).",
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
        : `GitHub repo not accessible (HTTP ${repoRes.status}).`,
    );
  }
  const repoInfo = (await repoRes.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch ?? "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: githubHeaders(providerToken) },
  );
  if (!treeRes.ok) {
    throw new Error(
      `Could not list GitHub repository contents (HTTP ${treeRes.status}).`,
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
          mimeForBinaryExt(extensionWithDot(name)),
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
        : "No importable source files found in this repository.",
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
  const isImage =
    isImagePath(file.name) || file.content.startsWith("data:image/");
  const svgBlobSrc = useMemo(() => {
    if (
      !file.name.toLowerCase().endsWith(".svg") ||
      file.content.startsWith("data:")
    ) {
      return null;
    }
    try {
      return URL.createObjectURL(
        new Blob([file.content], { type: "image/svg+xml" }),
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

export function DCodeWorkspace({
  project,
  draft,
  readOnly = false,
}: DCodeWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();

  /* ------------------------------ core state ----------------------------- */

  const [projectId, setProjectId] = useState<string | null>(
    project?.id ?? null,
  );
  const [title, setTitle] = useState(
    project?.title ?? draft?.title ?? "Untitled project",
  );
  const [files, setFiles] = useState<DCodeFile[]>(
    project?.files ?? draft?.files ?? [],
  );
  const [activeFileId, setActiveFileId] = useState<string>(files[0]?.id ?? "");
  const [openFileIds, setOpenFileIds] = useState<string[]>(
    files[0] ? [files[0].id] : [],
  );
  const [sidePanel, setSidePanel] = useState<SidePanel | null>("explorer");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [minimapEnabled, setMinimapEnabled] = useState(true);
  const [wordWrapEnabled, setWordWrapEnabled] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [diagnostics, setDiagnostics] = useState<
    Record<string, DCodeProblem[]>
  >({});
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [isPublic, setIsPublic] = useState(project?.isPublic ?? false);
  const [shareSlug, setShareSlug] = useState<string | null>(
    project?.shareSlug ?? null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    project ? new Date(project.updatedAt) : null,
  );
  const [savingShare, setSavingShare] = useState(false);
  const [shareHubOpen, setShareHubOpen] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareOperationRef = useRef(false);
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

  const [terminalOpen, setTerminalOpen] = useState(!readOnly);
  const [terminalTab, setTerminalTab] = useState<TerminalPanelTab>("terminal");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  /**
   * Latest content seen from the Monaco editor for the ACTIVE file. Monaco
   * reports changes asynchronously; keeping the newest buffer here lets us
   * flush it into `files` state deterministically on tab switch and on save,
   * so an edit is never lost by switching files before a save.
   */
  const editorBufferRef = useRef<{ fileId: string; content: string } | null>(
    null,
  );

  /** Latest values and edit revision for debounced/keyboard saves. */
  const latestRef = useRef({ projectId, title, files });
  const editRevisionRef = useRef(0);
  useEffect(() => {
    latestRef.current = { projectId, title, files };
  }, [projectId, title, files]);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? null,
    [files, activeFileId],
  );
  const openFiles = useMemo(
    () => openFileIds.flatMap((id) => files.filter((file) => file.id === id)),
    [files, openFileIds],
  );
  const problems = useMemo(
    () => files.flatMap((file) => diagnostics[file.id] ?? []),
    [diagnostics, files],
  );
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const results: FileSearchResult[] = [];
    for (const file of files) {
      const nameMatch = file.name.toLowerCase().includes(query);
      // Binary data URLs aren't searchable text, and searches are capped so
      // large imported projects remain responsive on every keystroke.
      const content = isBinaryPath(file.name)
        ? ""
        : file.content.slice(0, 100_000);
      const offset = content.toLowerCase().indexOf(query);
      if (!nameMatch && offset === -1) continue;
      const line =
        offset === -1 ? null : content.slice(0, offset).split("\n").length;
      const start = offset === -1 ? 0 : content.lastIndexOf("\n", offset) + 1;
      const end = offset === -1 ? 0 : content.indexOf("\n", offset);
      results.push({
        file,
        line,
        excerpt:
          offset === -1
            ? ""
            : content
                .slice(
                  start,
                  end === -1 ? start + 100 : Math.min(end, start + 100),
                )
                .trim(),
      });
      if (results.length >= 40) break;
    }
    return results;
  }, [files, searchQuery]);
  const activeModel = getModelById(modelId);
  const outputLines = [
    `Project: ${title || "Untitled project"}`,
    `Files in workspace: ${files.length}`,
    `Save status: ${readOnly ? "Read-only" : saveState === "idle" ? "Ready" : saveState}`,
    `Last saved: ${lastSavedAt ? lastSavedAt.toLocaleString() : "Not saved yet"}`,
  ];

  useEffect(() => {
    setModelId(getStoredModel());
    const onModelChanged = (event: Event) => {
      const next = (event as CustomEvent<{ model?: string }>).detail?.model;
      if (next) setModelId(next);
    };
    window.addEventListener(MODEL_CHANGED_EVENT, onModelChanged);
    return () =>
      window.removeEventListener(MODEL_CHANGED_EVENT, onModelChanged);
  }, []);

  useEffect(() => {
    if (sidePanel === "search") searchInputRef.current?.focus();
  }, [sidePanel]);

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
  const persistRef = useRef<
    (mode: "autosave" | "manual") => Promise<string | null>
  >(async () => null);

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
    [clearSaveErrorTimer, toast],
  );

  /** Serialize saves so a pending autosave cannot overwrite a fresh share. */
  const saveInFlightRef = useRef<Promise<string | null> | null>(null);

  const persist = useCallback(
    async (
      mode: "autosave" | "manual",
      options?: { forShare?: boolean },
    ): Promise<string | null> => {
      while (saveInFlightRef.current) await saveInFlightRef.current;
      if (readOnly) return null;

      const task = (async () => {
        const { projectId: id, title: t, files: rawFiles } = latestRef.current;
        const savedRevision = editRevisionRef.current;
        // Flush the newest Monaco buffer before taking the save snapshot.
        const buffer = editorBufferRef.current;
        const fs = buffer
          ? rawFiles.map((f) =>
              f.id === buffer.fileId ? { ...f, content: buffer.content } : f,
            )
          : rawFiles;

        // Draft without a row yet → only an explicit save creates it.
        if (!id) {
          if (mode !== "manual") return null;
          setSaveState("saving");
          try {
            const created = await createProject({
              title: t,
              language: fs[0]?.language ?? "typescript",
              files: fs,
            });
            setProjectId(created.id);
            latestRef.current.projectId = created.id;
            clearSaveErrorTimer();
            setSaveState(
              editRevisionRef.current === savedRevision ? "saved" : "dirty",
            );
            setLastSavedAt(new Date(created.updatedAt));
            if (options?.forShare) {
              // router.replace remounts a scratch project and would close the
              // Share Hub. Next's native History API keeps the editor mounted
              // while setting its canonical, reload-safe URL.
              window.history.replaceState(null, "", `/d-code/${created.id}`);
            } else {
              toast.show({
                type: "success",
                title: "Project created",
                message: "Saved to your D-Code workspace.",
              });
              router.replace(`/d-code/${created.id}`);
            }
            return created.id;
          } catch (error) {
            handleSaveFailure(error, "manual");
            return null;
          }
        }

        setSaveState("saving");
        try {
          const updated = await updateProject(id, { title: t, files: fs });
          clearSaveErrorTimer();
          setSaveState(
            editRevisionRef.current === savedRevision ? "saved" : "dirty",
          );
          setLastSavedAt(new Date(updated.updatedAt));
          if (mode === "manual" && !options?.forShare) {
            toast.show({
              type: "success",
              title: "Saved ✓",
              message: "Your changes are saved to D-Code.",
            });
          }
          return updated.id;
        } catch (error) {
          handleSaveFailure(error, mode);
          return null;
        }
      })();

      saveInFlightRef.current = task;
      try {
        return await task;
      } finally {
        if (saveInFlightRef.current === task) saveInFlightRef.current = null;
      }
    },
    [clearSaveErrorTimer, handleSaveFailure, readOnly, router, toast],
  );

  /* Keep the retry timer pointed at the freshest persist implementation. */
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  /** Marks state dirty and schedules the debounced autosave. */
  const markDirty = useCallback(() => {
    if (readOnly) return;
    editRevisionRef.current += 1;
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
        const provider =
          (user.app_metadata?.provider as string | undefined) ?? "";
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
        prev.map((f) =>
          f.id === activeFile?.id ? { ...f, content: next } : f,
        ),
      );
      markDirty();
    },
    [activeFile?.id, markDirty],
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
          : f,
      ),
    );
  }, []);

  /**
   * Switches the active file. Flushes the current Monaco buffer to state FIRST
   * so editing file A then switching to B always preserves A's content.
   */
  const handleSelectFile = useCallback(
    (fileId: string) => {
      const target = latestRef.current.files.find((f) => f.id === fileId);
      if (!target) return;
      if (isBlockedPath(target.name)) {
        toast.show({
          type: "error",
          title: "Can't open this file",
          message: BLOCKED_FILE_MESSAGE,
        });
        return;
      }
      flushActiveBuffer();
      setOpenFileIds((prev) =>
        prev.includes(fileId) ? prev : [...prev, fileId],
      );
      setActiveFileId(fileId);
      setCursorPosition({ line: 1, column: 1 });
    },
    [flushActiveBuffer, toast],
  );

  /** Closing a tab never deletes the underlying project file. */
  const handleCloseTab = useCallback(
    (fileId: string) => {
      flushActiveBuffer();
      const index = openFileIds.indexOf(fileId);
      const remaining = openFileIds.filter((id) => id !== fileId);
      setOpenFileIds(remaining);
      if (activeFileId === fileId) {
        setActiveFileId(remaining[Math.min(index, remaining.length - 1)] ?? "");
        setCursorPosition({ line: 1, column: 1 });
      }
    },
    [activeFileId, flushActiveBuffer, openFileIds],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      markDirty();
    },
    [markDirty],
  );

  const validateFileName = useCallback(
    (name: string): boolean => {
      const isValid =
        /^[a-zA-Z0-9_\-\.]+$/.test(name) &&
        name.length > 0 &&
        name.length <= 60;
      if (isValid) return true;
      toast.show({
        type: "error",
        title: "Invalid file name",
        message:
          "Invalid file name. Use letters, numbers, dashes, underscores, dots. Max 60 chars.",
      });
      return false;
    },
    [toast],
  );

  const handleAddFile = useCallback(() => {
    const name = newFileName.trim();
    if (!name) return;
    if (!validateFileName(name)) return;
    if (isBlockedPath(name)) {
      toast.show({
        type: "error",
        title: "Unsupported file",
        message: BLOCKED_FILE_MESSAGE,
      });
      return;
    }
    if (isBinaryPath(name)) {
      toast.show({
        type: "error",
        title: "Binary files can't be created by hand",
        message:
          "Import images/fonts via “Upload” or “Connect GitHub” — they’re stored as Base64 previews.",
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
    setOpenFileIds((prev) => [...prev, file.id]);
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
      toast.show({
        type: "error",
        title: "Unsupported file",
        message: BLOCKED_FILE_MESSAGE,
      });
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
        message:
          "Images/fonts are imported via “Upload” or “Connect GitHub” as Base64 previews.",
      });
      return;
    }
    if (name.toLowerCase() === target.name.toLowerCase()) {
      cancelRename();
      return;
    }
    if (
      files.some(
        (f) => f.id !== id && f.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      toast.show({
        type: "error",
        title: "File already exists",
        message: `“${name}” is already in this project.`,
      });
      return;
    }

    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, name, language: languageFromFilename(name) } : f,
      ),
    );
    setRenamingFileId(null);
    setRenamingName("");
    markDirty();
  }, [
    cancelRename,
    files,
    markDirty,
    renamingFileId,
    renamingName,
    toast,
    validateFileName,
  ]);

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
      const remainingFiles = files.filter((file) => file.id !== id);
      const remainingTabs = openFileIds.filter((tabId) => tabId !== id);
      const nextActive =
        remainingTabs[
          Math.min(openFileIds.indexOf(id), remainingTabs.length - 1)
        ] ??
        remainingFiles[0]?.id ??
        "";
      window.setTimeout(() => {
        setFiles((prev) => prev.filter((file) => file.id !== id));
        setOpenFileIds((prev) => {
          const next = prev.filter((tabId) => tabId !== id);
          return next.length ? next : nextActive ? [nextActive] : [];
        });
        setActiveFileId((current) => (current === id ? nextActive : current));
        setDiagnostics((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setDeletingFileId(null);
        markDirty();
      }, 200);
    },
    [files, markDirty, openFileIds, toast],
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
        for (const file of list) {
          if (added.length >= MAX_IMPORT_FILES) {
            skipped += 1;
            continue;
          }
          // Folder uploads carry a relative path; flat files have just a name.
          const relPath =
            (file as File & { webkitRelativePath?: string })
              .webkitRelativePath || file.name;
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
            message:
              skipped > 0
                ? `${skipped} file${skipped === 1 ? "" : "s"} skipped (unsupported or too large).`
                : "No readable files were found in that selection.",
          });
          return;
        }
        const presentNames = new Set(
          latestRef.current.files.map((f) => f.name.toLowerCase()),
        );
        const newFiles = imported.filter((file) => {
          const name = file.name.toLowerCase();
          if (presentNames.has(name)) {
            skipped += 1;
            return false;
          }
          presentNames.add(name);
          return true;
        });
        if (newFiles.length === 0) {
          toast.show({
            type: "info",
            title: "No new files",
            message: "These files are already in your project.",
          });
          return;
        }
        setFiles((prev) => [...prev, ...newFiles]);
        if (newFiles[0]) {
          setOpenFileIds((prev) =>
            prev.includes(newFiles[0].id) ? prev : [...prev, newFiles[0].id],
          );
          setActiveFileId(newFiles[0].id);
        }
        markDirty();
        const notes = [
          `${newFiles.length} file${newFiles.length === 1 ? "" : "s"} imported`,
          newFiles.some((file) => isBinaryPath(file.name))
            ? `${newFiles.filter((file) => isBinaryPath(file.name)).length} as Base64 assets`
            : "",
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
          message:
            error instanceof Error
              ? error.message
              : "Could not read those files.",
        });
      } finally {
        setUploadingFiles(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [markDirty, toast],
  );

  /* --------------------------------- share -------------------------------- */

  const closeShareHub = useCallback(() => setShareHubOpen(false), []);

  const shareUrl = useMemo(() => {
    if (!shareSlug || typeof window === "undefined") return null;
    return `${window.location.origin}/s/${shareSlug}`;
  }, [shareSlug]);

  const prepareShareHub = useCallback(async () => {
    if (shareOperationRef.current) return;
    shareOperationRef.current = true;
    setSavingShare(true);
    setShareError(null);
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Creating a draft or flushing pending edits must finish before a link
      // can point at it. Opening the modal itself never publishes or copies.
      const id = await persist("manual", { forShare: true });
      if (!id)
        throw new Error(
          "Could not save this project. Resolve the save error and retry.",
        );
      const slug = shareSlug ?? (await ensureProjectShareSlug(id));
      setShareSlug(slug);
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : "Could not prepare the share link.",
      );
    } finally {
      shareOperationRef.current = false;
      setSavingShare(false);
    }
  }, [persist, shareSlug]);

  const handleShare = useCallback(() => {
    setShareError(null);
    setShareHubOpen(true);
    if (
      !projectId ||
      !shareSlug ||
      saveState === "dirty" ||
      saveState === "saving" ||
      saveState === "error"
    ) {
      void prepareShareHub();
    }
  }, [prepareShareHub, projectId, saveState, shareSlug]);

  const handleVisibilityChange = useCallback(
    async (publicAccess: boolean) => {
      if (!projectId || shareOperationRef.current) return;
      shareOperationRef.current = true;
      setSavingShare(true);
      setShareError(null);
      try {
        if (
          publicAccess &&
          (saveState === "dirty" ||
            saveState === "saving" ||
            saveState === "error")
        ) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          const saved = await persist("manual", { forShare: true });
          if (!saved)
            throw new Error(
              "Save the latest changes before enabling Public Access.",
            );
        }
        const updated = await toggleProjectPublic(projectId, publicAccess);
        setIsPublic(updated.isPublic);
        setShareSlug(updated.shareSlug);
      } catch (error) {
        setShareError(
          error instanceof Error
            ? error.message
            : "Could not change Public Access.",
        );
      } finally {
        shareOperationRef.current = false;
        setSavingShare(false);
      }
    },
    [persist, projectId, saveState],
  );

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
          : "Could not list GitHub repositories.",
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
        const added: DCodeFile[] = [];
        const existing = new Set(merged.map((f) => f.name.toLowerCase()));
        let duplicates = 0;
        for (const file of imported) {
          if (existing.has(file.name.toLowerCase())) {
            duplicates += 1;
          } else {
            merged.push(file);
            added.push(file);
            existing.add(file.name.toLowerCase());
          }
        }
        const firstAdded = added[0];

        const isDraft = !current.projectId;
        const newTitle = isDraft
          ? result.repoName
              .replace(/[-_]+/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase())
          : current.title;

        setFiles(merged);
        if (firstAdded) {
          setOpenFileIds((prev) =>
            prev.includes(firstAdded.id) ? prev : [...prev, firstAdded.id],
          );
          setActiveFileId(firstAdded.id);
        }
        if (isDraft) setTitle(newTitle);
        // Keep the debounce/ref snapshot in sync so an immediate persist
        // (below) writes exactly what the user sees.
        latestRef.current = {
          projectId: current.projectId,
          title: isDraft ? newTitle : current.title,
          files: merged,
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
          title: isDraft
            ? `Imported ${result.repoName}`
            : "GitHub repo imported",
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
            : "Could not import the repository.",
        );
      } finally {
        setImportingRepo(false);
      }
    },
    [closeGitHubModal, importingRepo, markDirty, persist, toast],
  );

  /* ------------------------------ save status ----------------------------- */

  const statusLabel = () => {
    if (readOnly) {
      return (
        <>
          {isPublic ? (
            <GlobeIcon className="h-3 w-3 text-cyan-400" />
          ) : (
            <LockIcon className="h-3 w-3 text-violet-400" />
          )}
          {isPublic ? "Read-only view" : "Private preview"}
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
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Top bar: editable title + save status + share */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/[0.06] bg-navy/60 px-4 py-2.5">
        {readOnly ? (
          <h1 className="min-w-0 truncate text-sm font-semibold text-white">
            {title}
          </h1>
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
              {isPublic ? (
                <GlobeIcon className="h-3 w-3" />
              ) : (
                <LockIcon className="h-3 w-3" />
              )}
              {isPublic ? "Shared read-only" : "Owner-only preview"}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTerminalOpen((open) => !open)}
                title="Toggle terminal (Ctrl + `)"
                aria-label="Toggle terminal"
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
              <button
                type="button"
                onClick={handleShare}
                title="Open Share Hub"
                aria-label="Share project"
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
              >
                <ShareIcon className="h-3.5 w-3.5" />
                Share
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 bg-[#0a0e1a]">
        {/* Activity bar always stays at the far left of the workstation. */}
        <nav
          aria-label="D-Code activity bar"
          className="flex w-12 flex-shrink-0 flex-col border-r border-white/[0.07] bg-[#0c1322] py-2"
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
              aria-pressed={sidePanel === id}
              onClick={() =>
                setSidePanel((current) => (current === id ? null : id))
              }
              className={`flex h-11 w-full items-center justify-center border-l-2 transition-colors ${sidePanel === id ? "border-cyan-400 bg-cyan-400/[0.07] text-cyan-300" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
          <button
            type="button"
            title="Editor settings"
            aria-label="Editor settings"
            aria-pressed={sidePanel === "settings"}
            onClick={() =>
              setSidePanel((current) =>
                current === "settings" ? null : "settings",
              )
            }
            className={`mt-auto flex h-11 w-full items-center justify-center border-l-2 transition-colors ${sidePanel === "settings" ? "border-violet-400 bg-violet-400/[0.08] text-violet-300" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={`flex min-h-0 ${terminalOpen ? "flex-[7]" : "flex-1"}`}
          >
            {sidePanel === "explorer" && (
              <aside className="flex min-h-0 w-52 flex-shrink-0 flex-col border-r border-white/[0.07] bg-[#10192a]">
                <p className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-400">
                  Explorer
                </p>
                <div className="flex items-center gap-1.5 border-y border-white/[0.05] px-3 py-2 text-xs font-semibold text-zinc-200">
                  <FolderIcon className="h-3.5 w-3.5 text-cyan-300" />
                  <span className="min-w-0 flex-1 truncate">
                    {title || "my-app"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 font-mono text-[11px] text-zinc-400">
                  <span className="text-zinc-600">⌄</span>
                  <FolderIcon className="h-3 w-3" /> src
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto pl-4 pr-2">
                  {files.map((file) => {
                    const isActive = activeFile?.id === file.id;
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
                              <FileKindIcon name={file.name} />
                              <span className="min-w-0 flex-1 truncate">
                                {file.name}
                              </span>
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
                            if (e.target.files)
                              void handleImportFiles(e.target.files);
                          }}
                        />
                        <input
                          ref={folderInputRef}
                          type="file"
                          multiple
                          hidden
                          {...({ webkitdirectory: "", directory: "" } as Record<
                            string,
                            string
                          >)}
                          onChange={(e) => {
                            if (e.target.files)
                              void handleImportFiles(e.target.files);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </aside>
            )}

            {sidePanel === "search" && (
              <aside
                aria-label="Search project files"
                className="flex min-h-0 w-56 flex-shrink-0 flex-col border-r border-white/[0.07] bg-[#10192a]"
              >
                <h2 className="px-3 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-400">
                  Search
                </h2>
                <div className="px-3">
                  <div className="flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#0a1020] px-2 focus-within:border-cyan-400/50">
                    <SearchIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <input
                      ref={searchInputRef}
                      type="search"
                      aria-label="Find in project"
                      placeholder="Find in project"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="h-9 min-w-0 flex-1 bg-transparent text-xs text-white placeholder-zinc-600 outline-none"
                    />
                  </div>
                </div>
                <p className="px-3 py-3 font-mono text-[10px] text-zinc-500">
                  {searchQuery.trim()
                    ? `${searchResults.length} matches`
                    : "Search file names & content"}
                </p>
                <ul className="min-h-0 flex-1 overflow-y-auto px-2">
                  {searchResults.map(({ file, line, excerpt }) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectFile(file.id)}
                        className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
                      >
                        <span className="flex items-center gap-2 text-[11px] text-zinc-200">
                          <FileKindIcon name={file.name} />
                          <span className="min-w-0 truncate">{file.name}</span>
                        </span>
                        {excerpt && (
                          <span className="mt-1 block truncate pl-7 font-mono text-[10px] text-zinc-500">
                            {line}: {excerpt}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                  {searchQuery.trim() && searchResults.length === 0 && (
                    <li className="px-2 py-4 text-xs text-zinc-500">
                      No matches in this project.
                    </li>
                  )}
                </ul>
              </aside>
            )}

            {sidePanel === "extensions" && (
              <aside
                aria-label="Extensions"
                className="flex min-h-0 w-56 flex-shrink-0 flex-col border-r border-white/[0.07] bg-[#10192a]"
              >
                <h2 className="px-3 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-400">
                  Extensions
                </h2>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                      <CodeIcon className="h-4 w-4 text-cyan-300" /> Monaco
                      language tools
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                      Syntax highlighting, suggestions and inline diagnostics
                      for your code files.
                    </p>
                    <span className="mt-3 inline-block font-mono text-[10px] text-emerald-300">
                      ● BUILT IN
                    </span>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                      <GithubIcon className="h-4 w-4" /> GitHub importer
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                      Bring repository source files into your workspace.
                    </p>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={openGitHubModal}
                        className="mt-3 w-full rounded-md bg-cyan-400/10 px-2 py-2 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20"
                      >
                        {githubConnected
                          ? "Browse repositories"
                          : "Connect GitHub"}
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            )}

            {sidePanel === "settings" && (
              <aside
                aria-label="Editor settings"
                className="flex min-h-0 w-56 flex-shrink-0 flex-col border-r border-white/[0.07] bg-[#10192a]"
              >
                <h2 className="px-3 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-400">
                  Editor settings
                </h2>
                <div className="space-y-4 px-3">
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-xs text-zinc-300">
                    <span>Minimap</span>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Show minimap"
                      aria-checked={minimapEnabled}
                      onClick={() => setMinimapEnabled((prev) => !prev)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${minimapEnabled ? "bg-cyan-500" : "bg-zinc-700"}`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${minimapEnabled ? "translate-x-4" : ""}`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-xs text-zinc-300">
                    <span>Word wrap</span>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Enable word wrap"
                      aria-checked={wordWrapEnabled}
                      onClick={() => setWordWrapEnabled((prev) => !prev)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${wordWrapEnabled ? "bg-cyan-500" : "bg-zinc-700"}`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${wordWrapEnabled ? "translate-x-4" : ""}`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                    <span>Font size</span>
                    <div className="flex items-center gap-2 font-mono">
                      <button
                        type="button"
                        aria-label="Decrease editor font size"
                        disabled={editorFontSize <= 11}
                        onClick={() => setEditorFontSize((size) => size - 1)}
                        className="rounded bg-white/[0.06] px-2 py-1 hover:bg-white/[0.1] disabled:opacity-40"
                      >
                        −
                      </button>
                      {editorFontSize}
                      <button
                        type="button"
                        aria-label="Increase editor font size"
                        disabled={editorFontSize >= 18}
                        onClick={() => setEditorFontSize((size) => size + 1)}
                        className="rounded bg-white/[0.06] px-2 py-1 hover:bg-white/[0.1] disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <p className="pt-3 text-[11px] leading-relaxed text-zinc-500">
                    Changes apply immediately to the current editor.
                  </p>
                </div>
              </aside>
            )}

            {/* Editor column */}
            <div className="flex min-w-0 flex-1 flex-col bg-[#0a0e1a]">
              {/* Only open files have tabs; closing a tab doesn't delete it. */}
              <div
                role="tablist"
                aria-label="Open files"
                className="flex h-10 flex-shrink-0 items-stretch overflow-x-auto border-b border-white/[0.07] bg-[#101727] pl-1"
              >
                {openFiles.map((file) => {
                  const isActive = activeFile?.id === file.id;
                  return (
                    <div
                      key={file.id}
                      className={`group flex shrink-0 items-center border-r border-white/[0.06] ${isActive ? "border-t-2 border-t-cyan-400 bg-[#0a0e1a] text-zinc-100" : "border-t-2 border-t-transparent bg-[#111a2b] text-zinc-400 hover:bg-[#172135]"}`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        title={file.name}
                        onClick={() => handleSelectFile(file.id)}
                        className="flex h-full max-w-40 items-center gap-2 pl-3 pr-1 font-mono text-[11px] outline-none focus-visible:text-cyan-300"
                      >
                        <FileKindIcon name={file.name} />
                        <span className="truncate">{file.name}</span>
                        {isActive &&
                          (saveState === "dirty" || saveState === "saving") && (
                            <span
                              className="text-amber-300"
                              aria-label="Unsaved changes"
                            >
                              ●
                            </span>
                          )}
                      </button>
                      <button
                        type="button"
                        title={`Close ${file.name}`}
                        aria-label={`Close ${file.name} tab`}
                        onClick={() => handleCloseTab(file.id)}
                        className="mx-1 flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white/[0.1] hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-cyan-400"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                {openFiles.length === 0 && (
                  <span className="self-center px-4 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                    No open editors
                  </span>
                )}
              </div>

              {/* Virtual source-tree breadcrumbs above the editor. */}
              <nav
                aria-label="File breadcrumbs"
                className="flex h-8 flex-shrink-0 items-center gap-1.5 overflow-hidden border-b border-white/[0.05] bg-[#0a0e1a] px-4 font-mono text-[11px] text-zinc-500"
              >
                <span>projects</span>
                <span className="text-zinc-700">›</span>
                <span className="max-w-28 truncate">
                  {title.trim() || "my-app"}
                </span>
                <span className="text-zinc-700">›</span>
                <span>src</span>
                {activeFile && (
                  <>
                    <span className="text-zinc-700">›</span>
                    <FileKindIcon name={activeFile.name} />
                    <span className="truncate text-zinc-200">
                      {activeFile.name}
                    </span>
                  </>
                )}
              </nav>

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
                      onCursorChange={(line, column) =>
                        setCursorPosition({ line, column })
                      }
                      onValidate={(markers) =>
                        setDiagnostics((prev) => ({
                          ...prev,
                          [activeFile.id]: markers.map((marker) => ({
                            fileId: activeFile.id,
                            fileName: activeFile.name,
                            line: marker.startLineNumber,
                            column: marker.startColumn,
                            severity:
                              marker.severity >= 8
                                ? "error"
                                : marker.severity >= 4
                                  ? "warning"
                                  : "info",
                            message: marker.message,
                          })),
                        }))
                      }
                      options={{
                        minimap: {
                          enabled: minimapEnabled,
                          scale: 1,
                          size: "proportional",
                        },
                        wordWrap: wordWrapEnabled ? "on" : "off",
                        fontSize: editorFontSize,
                      }}
                      readOnly={readOnly}
                    />
                  )
                ) : (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-400/10 shadow-2xl shadow-cyan-500/10">
                      <CodeIcon className="h-8 w-8 text-cyan-400" />
                    </div>
                    <h2 className="mt-6 text-xl font-semibold tracking-tight text-white">
                      {files.length ? "No open editors" : "Welcome to D-Code"}
                    </h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                      {files.length
                        ? "Select a file from Explorer to reopen it. Closing a tab keeps your file safe."
                        : "Create a source file or open one of your projects to get started."}
                    </p>
                    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                      {files.length ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSidePanel("explorer");
                            handleSelectFile(files[0].id);
                          }}
                          className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                        >
                          <FolderIcon className="h-4 w-4" /> Open{" "}
                          {files[0].name}
                        </button>
                      ) : !readOnly ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSidePanel("explorer");
                            setAddingFile(true);
                          }}
                          className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                        >
                          <PlusIcon className="h-4 w-4" /> Create New File
                        </button>
                      ) : null}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => router.push("/projects")}
                          className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                        >
                          <FolderIcon className="h-4 w-4" /> Open Project
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Integrated, tabbed bottom panel; CLI history survives tab switches. */}
          {terminalOpen && (
            <DCodeTerminal
              files={files}
              projectTitle={title}
              userEmail={userEmail}
              onOpenFile={handleSelectFile}
              problems={problems}
              outputLines={outputLines}
              activeTab={terminalTab}
              onTabChange={setTerminalTab}
              onClose={() => setTerminalOpen(false)}
              className="flex-[3] min-h-0"
            />
          )}
        </div>
      </div>

      {/* Solid workstation status bar, synced to cursor, save state and model. */}
      <div className="flex h-7 flex-shrink-0 items-center justify-between gap-4 overflow-x-auto bg-[#614bb5] px-3 font-mono text-[10px] font-medium text-white sm:px-4">
        <div className="flex shrink-0 items-center gap-4">
          <span
            className="flex items-center gap-1.5"
            title="Workspace branch and unsaved changes"
          >
            <CodeIcon className="h-3 w-3" />
            Main
            {!readOnly && (!projectId || ["dirty", "saving", "error"].includes(saveState))
              ? "*"
              : ""}
          </span>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              setTerminalOpen(true);
              setTerminalTab("problems");
            }}
            className="flex items-center gap-1.5 rounded px-1 transition-colors hover:bg-white/15 disabled:cursor-default disabled:hover:bg-transparent"
            title={
              readOnly
                ? "Problems are available in the editor"
                : "Open Problems panel"
            }
          >
            <span className="text-white/80">◇</span>
            {problems.length} Problems
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-4 sm:gap-5">
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
          <span>UTF-8</span>
          <span
            className="inline-flex items-center gap-1.5 rounded border border-white/25 bg-white/10 px-1.5 py-0.5"
            title={`Active AI model: ${activeModel.label}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: activeModel.accent }}
            />
            {activeModel.label}
          </span>
        </div>
      </div>

      <ShareHub
        open={shareHubOpen}
        onClose={closeShareHub}
        kind="D-Code"
        title={title}
        description={
          project?.description?.trim() ||
          `Explore ${title || "this project"} in D-Code, the DashyCore workspace.`
        }
        url={shareUrl}
        isPublic={isPublic}
        busy={savingShare}
        error={shareError}
        onVisibilityChange={(value) => void handleVisibilityChange(value)}
        onRetry={() => void prepareShareHub()}
      />

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
                <h2 className="text-sm font-semibold text-white">
                  Connect GitHub
                </h2>
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
                  Paste any public repo (e.g.
                  https://github.com/PPpro-blip/Dashy-core). Source files plus
                  up to {MAX_IMPORT_FILES} — images and fonts come in as Base64
                  previews.
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
    </div>
  );
}
