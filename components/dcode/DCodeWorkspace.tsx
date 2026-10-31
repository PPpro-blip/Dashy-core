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
  isPreviewableImage,
  mimeForBinaryExt,
  readBlobAsDataUrl,
  readBlobAsText,
} from "@/lib/dcode-binary";
import { DCodeTerminal } from "@/components/dcode/DCodeTerminal";
import { MonacoEditor } from "@/components/dcode/MonacoEditor";
import { useToast } from "@/components/Toast";
import {
  BracesIcon,
  CheckIcon,
  CodeIcon,
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
  const shortMatch = value.match(/^([^/]+)\/([^/]+)$/);
  const parts = urlMatch ? [urlMatch[1], urlMatch[2]] : shortMatch ? [shortMatch[1], shortMatch[2]] : null;
  if (!parts || parts.some((part) => part === "." || part === ".." || !/^[A-Za-z0-9_.-]+$/.test(part))) return null;
  return { owner: parts[0], repo: parts[1] };
  return null;
}

/** Same-origin, narrow GitHub proxy for public, read-only repository requests. */
async function githubApiJson<T>(path: string, query?: Record<string, string>): Promise<T> {
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`/api/github/${safePath}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    let message = `GitHub request failed (HTTP ${response.status}).`;
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch { /* preserve safe generic failure */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
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
async function importGitHubRepository(url: string): Promise<GithubImportResult> {
  const parsed = parseGithubRepo(url);
  if (!parsed) throw new Error("Enter a valid GitHub repo URL (e.g. https://github.com/owner/repo).");
  const { owner, repo } = parsed;
  const prefix = `repos/${owner}/${repo}`;
  const repoInfo = await githubApiJson<{ default_branch?: string }>(prefix);
  const branch = repoInfo.default_branch ?? "main";
  const head = await githubApiJson<{ sha?: string }>(`${prefix}/commits`, { sha: branch });
  if (!head.sha || !/^[a-f0-9]{40}$/i.test(head.sha)) throw new Error("Could not resolve the repository's default branch.");
  const tree = await githubApiJson<{ tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }> }>(
    `${prefix}/git/trees/${head.sha}`, { recursive: "1" }
  );

  const blobs = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path && entry.sha)
    .map((entry) => ({ path: entry.path as string, sha: entry.sha as string, size: typeof entry.size === "number" ? entry.size : 0 }))
    .filter(({ path }) => /^[a-zA-Z0-9_@\-\.()\[\]\/]+$/.test(path))
    .slice(0, MAX_IMPORT_FILES * 2);

  let skipped = 0;
  let binaries = 0;
  const seenNames = new Set<string>();
  const files: DCodeFile[] = [];
  for (const { path, sha, size } of blobs) {
    if (files.length >= MAX_IMPORT_FILES) break;
    const name = path.split("/").pop() ?? path;
    const lower = name.toLowerCase();
    if (isBlockedPath(path) || seenNames.has(lower) || !/^[a-f0-9]{40}$/i.test(sha)) {
      skipped += 1;
      continue;
    }
    if (isBinaryPath(name) && size > MAX_BINARY_BYTES) {
      skipped += 1;
      continue;
    }

    let blob: { content?: string; encoding?: string };
    try {
      blob = await githubApiJson(`${prefix}/git/blobs/${sha}`);
    } catch {
      skipped += 1;
      continue;
    }
    if (blob.encoding !== "base64" || typeof blob.content !== "string") {
      skipped += 1;
      continue;
    }
    const base64 = blob.content.replace(/\s/g, "");
    let bytes: Uint8Array;
    try {
      const binary = atob(base64);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
      skipped += 1;
      continue;
    }
    if (isBinaryPath(name)) {
      if (bytes.length > MAX_BINARY_BYTES) { skipped += 1; continue; }
      binaries += 1;
      files.push({ id: newId(), name, language: languageFromFilename(name), content: bytesToDataUrl(bytes, mimeForBinaryExt(extensionWithDot(name))) });
    } else {
      const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (containsBinaryMarkers(content) || content.length > MAX_FILE_CONTENT_CHARS) { skipped += 1; continue; }
      files.push({ id: newId(), name, language: languageFromFilename(name), content: cleanTextContent(content) });
    }
    seenNames.add(lower);
  }

  if (files.length === 0) {
    throw new Error(skipped > 0
      ? "No importable files found — repository files were unsupported, generated, or oversized."
      : "No importable source files found in this repository.");
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
  const imgSrc = /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(file.content)
    ? file.content
    : null;
  const isImage = Boolean(imgSrc);

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
  const [newFileName, setNewFileName] = useState("");
  const [addingFile, setAddingFile] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  const [githubConnected, setGithubConnected] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [importingRepo, setImportingRepo] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  /**
   * Latest content seen from the Monaco editor for the ACTIVE file. Monaco
   * reports changes asynchronously; keeping the newest buffer here lets us
   * flush it into `files` state deterministically on tab switch and on save,
   * so an edit is never lost by switching files before a save.
   */
  const editorBufferRef = useRef<{ fileId: string; content: string } | null>(null);

  /** Latest values for debounced/keyboard saves. */
  const latestRef = useRef({ projectId, title, files });
  useEffect(() => {
    latestRef.current = { projectId, title, files };
  }, [projectId, title, files]);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? files[0] ?? null,
    [files, activeFileId]
  );

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
    [clearSaveErrorTimer, toast]
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

      // Draft without a row yet → only an explicit save creates it.
      if (!id) {
        if (mode !== "manual") return;
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
          setSaveState("saved");
          setLastSavedAt(new Date(created.updatedAt));
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
    [clearSaveErrorTimer, handleSaveFailure, readOnly, router, toast]
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
      setActiveFileId(fileId);
    },
    [flushActiveBuffer, toast]
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

  const handleShare = useCallback(async () => {
    if (savingShare) return;
    setSavingShare(true);
    try {
      // Persist a new workspace first, then bind the hub to this exact row.
      let id = latestRef.current.projectId;
      if (!id) {
        await persist("manual");
        id = latestRef.current.projectId;
      }
      if (!id) throw new Error("Save the project before sharing.");
      router.push(`/share?sourceType=dcode_project&sourceId=${encodeURIComponent(id)}`);
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not open Share Hub",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSavingShare(false);
    }
  }, [persist, router, savingShare, toast]);

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
    setGithubModalOpen(true);
  }, []);

  const closeGitHubModal = useCallback(() => {
    setGithubModalOpen(false);
    setGithubError(null);
    setGithubRepoUrl("");
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
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
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
                onClick={() => void handleShare()}
                disabled={savingShare}
                title={isPublic ? "Copy public link" : "Share — make public & copy link"}
                aria-label={isPublic ? "Copy public link" : "Share project"}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-2.5 py-1.5 text-[11px] font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
              >
                {savingShare ? (
                  <LoaderIcon className="h-3 w-3 animate-spin" />
                ) : isPublic ? (
                  <GlobeIcon className="h-3 w-3" />
                ) : (
                  <ShareIcon className="h-3 w-3" />
                )}
                {isPublic ? "Copy link" : "Share"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Split: editor body gets 70% (flex-7) when the terminal is open,
            otherwise it fills the whole remaining column. */}
        <div className={`flex min-h-0 ${terminalOpen ? "flex-[7]" : "flex-1"}`}>
        {/* File tree */}
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

        {/* Editor column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tabs */}
          <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#0d1220]/60 px-2 py-1.5">
            {files.map((file) => {
              const isActive = activeFile?.id === file.id;
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => handleSelectFile(file.id)}
                  className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[11px] transition-colors ${
                    isActive
                      ? "bg-cyan-500/10 text-cyan-300"
                      : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                  }`}
                >
                  {file.name}
                </button>
              );
            })}
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

        {/* Mock terminal drawer — bottom 30% of the workspace when open. */}
        {terminalOpen && (
          <DCodeTerminal
            files={files}
            projectTitle={title}
            userEmail={userEmail}
            onOpenFile={handleSelectFile}
            onClose={() => setTerminalOpen(false)}
            className="flex-[3] min-h-0"
          />
        )}
      </div>

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
                <h2 className="text-sm font-semibold text-white">Import a public GitHub repository</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Only public repository reads are enabled in this deployment.
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

              <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
                Private repository listing, token-authenticated imports, and GitHub pushes are disabled because provider tokens cannot be stored server-side by the current auth architecture. A public repository URL can still be imported without a token.
              </p>

              {githubError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300"
                >
                  {githubError}
                </p>
              )}

            </div>
          </div>
        </>
      )}
    </div>
  );
}
