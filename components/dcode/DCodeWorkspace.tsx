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
import { useRouter } from "next/navigation";
import {
  createProject,
  languageFromFilename,
  newId,
  toggleProjectPublic,
  updateProject,
  type DCodeFile,
  type DCodeProject,
} from "@/lib/dcode";
import { MonacoEditor } from "@/components/dcode/MonacoEditor";
import { useToast } from "@/components/Toast";
import {
  CheckIcon,
  FileTextIcon,
  GlobeIcon,
  LockIcon,
  LoaderIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
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
      const { projectId: id, title: t, files: fs } = latestRef.current;
      if (readOnly) return;

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
      } catch (error) {
        setSaveState("error");
        if (mode === "manual") {
          toast.show({
            type: "error",
            title: "Could not save project",
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

  /* -------------------------------- file ops ------------------------------ */

  const updateActiveContent = useCallback(
    (content: string | undefined) => {
      const next = content ?? "";
      setFiles((prev) =>
        prev.map((f) => (f.id === activeFile?.id ? { ...f, content: next } : f))
      );
      markDirty();
    },
    [activeFile?.id, markDirty]
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      markDirty();
    },
    [markDirty]
  );

  const handleAddFile = useCallback(() => {
    const name = newFileName.trim();
    if (!name) return;
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
  }, [files, markDirty, newFileName, toast]);

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

      <div className="flex min-h-0 flex-1">
        {/* File tree */}
        <aside className="flex w-52 flex-shrink-0 flex-col border-r border-white/[0.06] bg-navy/40">
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Files
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2">
            {files.map((file) => {
              const isActive = activeFile?.id === file.id;
              return (
                <li key={file.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setActiveFileId(file.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                    }`}
                  >
                    <FileTextIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Delete ${file.name}`}
                      title={`Delete ${file.name}`}
                      onClick={() => handleDeleteFile(file.id)}
                      disabled={deletingFileId !== null}
                      className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-md bg-[#0d1020]/90 p-1 text-zinc-500 transition-colors hover:text-red-400 disabled:opacity-50 group-hover:block"
                    >
                      {deletingFileId === file.id ? (
                        <LoaderIcon className="h-3 w-3 animate-spin" />
                      ) : (
                        <TrashIcon className="h-3 w-3" />
                      )}
                    </button>
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
                  onClick={() => setActiveFileId(file.id)}
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
                key={activeFile.id}
                value={activeFile.content}
                language={activeFile.language}
                onChange={readOnly ? undefined : updateActiveContent}
                readOnly={readOnly}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                No file open
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
