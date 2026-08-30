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
  LockIcon,
  LoaderIcon,
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

function parseGithubRepo(input: string): { owner: string; repo: string } | null {
  const value = input.trim().replace(/\/$/, "").replace(/\.git$/, "");
  const urlMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  const shortMatch = value.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

/** Lists the signed-in user's GitHub repos when a provider token is available. */
async function listGitHubRepos(): Promise<GithubRepo[]> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const providerToken = (session as { provider_token?: string | null } | null)
    ?.provider_token;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (providerToken) headers.Authorization = `Bearer ${providerToken}`;

  const res = await fetch(
    "https://api.github.com/user/repos?per_page=60&sort=updated",
    { headers }
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "GitHub token is not available. Paste a repo URL to import instead."
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}.`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as GithubRepo[]) : [];
}

/**
 * Basic scaffold importer: resolves a public GitHub repo, walks its tree and
 * pulls up to 60 non-generated source files into D-Code. D-Code stores files
 * as names (a project has no nested folders), so deeply nested paths collapse
 * to their basename.
 */
async function importGitHubRepository(url: string): Promise<DCodeFile[]> {
  const parsed = parseGithubRepo(url);
  if (!parsed) {
    throw new Error(
      "Enter a valid GitHub repo URL (e.g. https://github.com/owner/repo)."
    );
  }
  const { owner, repo } = parsed;

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!repoRes.ok) {
    throw new Error(
      `GitHub repo not found or not accessible (HTTP ${repoRes.status}).`
    );
  }
  const repoInfo = (await repoRes.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch ?? "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: { Accept: "application/vnd.github+json" } }
  );
  if (!treeRes.ok) {
    throw new Error(
      `Could not list GitHub repository contents (HTTP ${treeRes.status}).`
    );
  }
  const tree = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };

  const paths = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path)
    .map((entry) => entry.path as string)
    .filter(
      (path) =>
        !/^(\/?node_modules\/|dist\/|build\/|\.next\/|\.git\/|coverage\/|out\/|target\/)/.test(
          path
        )
    )
    .filter((path) => /^[a-zA-Z0-9_\-\.\/]+$/.test(path))
    .slice(0, 60);

  if (paths.length === 0) {
    throw new Error("No importable source files found in this repository.");
  }

  const files: DCodeFile[] = [];
  for (const path of paths) {
    const name = path.split("/").pop() ?? path;
    const rawRes = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
    );
    if (!rawRes.ok) continue;
    const content = await rawRes.text();
    if (content.length > 512 * 1024) continue;
    files.push({ id: newId(), name, language: languageFromFilename(name), content });
  }

  if (files.length === 0) {
    throw new Error("Could not fetch any raw files from this repository.");
  }
  return files;
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
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [listingRepos, setListingRepos] = useState(false);
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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? files[0] ?? null,
    [files, activeFileId]
  );

  /* ------------------------------- persistence --------------------------- */

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
          setSaveState("error");
          toast.show({
            type: "error",
            title: "Could not save project",
            message: error instanceof Error ? error.message : "Please try again.",
          });
        }
        return;
      }

      setSaveState("saving");
      try {
        const updated = await updateProject(id, { title: t, files: fs });
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
        setSaveState("error");
        if (mode === "manual") {
          toast.show({
            type: "error",
            title: "Save failed",
            message: error instanceof Error ? error.message : "Please try again.",
          });
        }
      }
    },
    [readOnly, router, toast]
  );

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
      flushActiveBuffer();
      setActiveFileId(fileId);
    },
    [flushActiveBuffer]
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

    const target = files.find((f) => f.id === id);
    if (!target) {
      cancelRename();
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

  /* --------------------------------- share -------------------------------- */

  const shareUrl = useMemo(() => {
    if (!shareSlug || typeof window === "undefined") return null;
    return `${window.location.origin}/d-code/share/${shareSlug}`;
  }, [shareSlug]);

  const handleShare = useCallback(async () => {
    if (savingShare) return;
    setSavingShare(true);
    try {
      // Draft without a row: save first so there is something to share.
      let id = latestRef.current.projectId;
      if (!id) {
        await persist("manual");
        id = latestRef.current.projectId;
        if (!id) throw new Error("Save the project before sharing.");
      }
      if (!isPublic) {
        const updated = await toggleProjectPublic(id, true);
        setIsPublic(true);
        setShareSlug(updated.shareSlug);
        const url = `${window.location.origin}/d-code/share/${updated.shareSlug}`;
        await navigator.clipboard.writeText(url);
        toast.show({
          type: "success",
          title: "Public link copied",
          message: "Anyone with the link can view this project.",
        });
      } else if (shareSlug) {
        await navigator.clipboard.writeText(
          `${window.location.origin}/d-code/share/${shareSlug}`
        );
        toast.show({ type: "success", title: "Link copied" });
      }
    } catch (error) {
      toast.show({
        type: "error",
        title: "Sharing failed",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSavingShare(false);
    }
  }, [isPublic, persist, savingShare, shareSlug, toast]);

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
        const imported = await importGitHubRepository(repoUrl);
        setFiles((prev) => {
          const existing = new Set(prev.map((f) => f.name.toLowerCase()));
          const next = [...prev];
          for (const file of imported) {
            if (!existing.has(file.name.toLowerCase())) {
              next.push(file);
              existing.add(file.name.toLowerCase());
            }
          }
          return next;
        });
        setActiveFileId(imported[0]?.id ?? "");
        markDirty();
        toast.show({
          type: "success",
          title: "GitHub repo imported",
          message: `${imported.length} file${
            imported.length === 1 ? "" : "s"
          } added to this project.`,
        });
        closeGitHubModal();
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
    [closeGitHubModal, importingRepo, markDirty, toast]
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
                <button
                  type="button"
                  onClick={() => setAddingFile(true)}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/[0.10] px-2.5 py-2 text-[12px] font-medium text-zinc-500 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  New file
                </button>
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

          {/* Monaco */}
          <div className="min-h-0 flex-1">
            {activeFile ? (
              <MonacoEditor
                key={`${activeFile.id}:${activeFile.language}`}
                value={activeFile.content}
                language={activeFile.language}
                onChange={readOnly ? undefined : updateActiveContent}
                readOnly={readOnly}
              />
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
                  Paste any public repo. Up to 60 source files are pulled in.
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

                {githubRepos.length > 0 && (
                  <ul className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20">
                    {githubRepos.slice(0, 20).map((repo) => (
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
