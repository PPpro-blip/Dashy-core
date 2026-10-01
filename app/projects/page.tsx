"use client";

/**
 * DashyCore v7 — Projects (real D-Code projects grid).
 *
 * Lists the signed-in user's D-Code projects (Supabase, RLS-scoped).
 * Card contract (deliberately small): title · file count · language ·
 * last edited · visibility (icon + accessible text label, never colour
 * alone). Actions: [Open] [Share] [⋯] — the overflow menu holds Rename /
 * Duplicate / Move / Delete. Share opens THE canonical Share Hub with this
 * exact project pre-selected.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createProject,
  deleteProject,
  listProjects,
  starterProjectDraft,
  updateProject,
  type DCodeProject,
} from "@/lib/dcode";
import { useToast } from "@/components/Toast";
import {
  CodeIcon,
  CopyIcon,
  DotsIcon,
  FolderIcon,
  GlobeIcon,
  LoaderIcon,
  LockIcon,
  PenIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
} from "@/components/icons";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** ⋯ overflow menu — closes on Escape, outside click and after an action. */
function CardMenu({
  project,
  busy,
  confirmingDelete,
  onRename,
  onDuplicate,
  onDelete,
}: {
  project: DCodeProject;
  busy: boolean;
  confirmingDelete: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${project.title.trim() || "untitled project"}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        <DotsIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Project actions"
          className="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-white/[0.1] bg-[#131731] p-1.5 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <PenIcon className="h-3.5 w-3.5" /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onDuplicate();
            }}
          >
            <CopyIcon className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            title="Folders don't exist yet — there is nowhere to move projects to."
            className={itemClass}
          >
            <FolderIcon className="h-3.5 w-3.5" /> Move
            <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
              No folders yet
            </span>
          </button>
          <div className="my-1 border-t border-white/[0.06]" />
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} ${
              confirmingDelete ? "bg-red-500/10 text-red-300" : "hover:!text-red-300"
            }`}
            disabled={busy}
            onClick={() => {
              onDelete();
              if (confirmingDelete) setOpen(false);
            }}
          >
            <TrashIcon className="h-3.5 w-3.5" />
            {confirmingDelete ? "Click again to delete" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<DCodeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Two-step delete confirm: the id staged for deletion. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** Inline rename state. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setProjects(await listProjects());
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load projects."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset a staged delete after a beat, so it never lingers armed.
  useEffect(() => {
    if (!confirmingId) return;
    const timer = window.setTimeout(() => setConfirmingId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingId]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const project = await createProject(starterProjectDraft("typescript"));
      toast.show({
        type: "success",
        title: "Project created",
        message: "Opening it in D-Code…",
      });
      router.push(`/d-code/${project.id}`);
    } catch (error) {
      toast.show({
        type: "error",
        title: "Could not create project",
        message: error instanceof Error ? error.message : "Please try again.",
      });
      setCreating(false);
    }
  }, [creating, router, toast]);

  const handleDelete = useCallback(
    async (project: DCodeProject) => {
      // Two-step confirm to avoid accidental deletes.
      if (confirmingId !== project.id) {
        setConfirmingId(project.id);
        return;
      }
      setConfirmingId(null);
      setBusyId(project.id);
      try {
        await deleteProject(project.id);
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
        toast.show({
          type: "success",
          title: "Project deleted",
          message: `“${project.title.trim() || "Untitled project"}” is gone.`,
        });
      } catch (error) {
        toast.show({
          type: "error",
          title: "Could not delete project",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [confirmingId, toast]
  );

  const handleDuplicate = useCallback(
    async (project: DCodeProject) => {
      if (busyId) return;
      setBusyId(project.id);
      try {
        const copy = await createProject({
          title: `${project.title.trim() || "Untitled project"} (copy)`,
          description: project.description,
          language: project.language,
          files: project.files,
        });
        setProjects((prev) => [copy, ...prev]);
        toast.show({
          type: "success",
          title: "Project duplicated",
          message: `“${copy.title}” was created.`,
        });
      } catch (error) {
        toast.show({
          type: "error",
          title: "Could not duplicate",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, toast]
  );

  const startRename = useCallback((project: DCodeProject) => {
    setRenamingId(project.id);
    setRenameValue(project.title.trim() || "");
  }, []);

  const commitRename = useCallback(
    async (project: DCodeProject) => {
      const title = renameValue.trim();
      setRenamingId(null);
      if (!title || title === project.title) return;
      setBusyId(project.id);
      try {
        const updated = await updateProject(project.id, { title });
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } catch (error) {
        toast.show({
          type: "error",
          title: "Could not rename",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [renameValue, toast]
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Projects
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            D-Code workspaces — multi-file code projects with shareable links.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating}
          className="flex min-h-[44px] flex-shrink-0 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
        >
          {creating ? (
            <LoaderIcon className="h-4 w-4 animate-spin" />
          ) : (
            <PlusIcon className="h-4 w-4" />
          )}
          New project
        </button>
      </div>

      {/* Body */}
      <div className="mt-8">
        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-zinc-500">
            <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
            Loading projects…
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-500/20 bg-white/[0.02] p-8 text-center">
            <p className="text-sm text-zinc-200">{loadError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700"
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
              <CodeIcon className="h-6 w-6 text-cyan-400" />
            </div>
            <p className="mt-4 text-base font-medium text-zinc-100">
              No projects yet
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
              Spin up a multi-file workspace with the Monaco editor, or send
              any chat code block to D-Code with “Open in D-Code”.
            </p>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
            >
              {creating ? (
                <LoaderIcon className="h-4 w-4 animate-spin" />
              ) : (
                <PlusIcon className="h-4 w-4" />
              )}
              Create your first project
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const untitled = !project.title.trim();
              const busy = busyId === project.id;
              return (
                <li
                  key={project.id}
                  className="group relative flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-cyan-400/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    {renamingId === project.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => void commitRename(project)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitRename(project);
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                        aria-label="Project title"
                        placeholder="Project title"
                        className="min-w-0 flex-1 rounded-lg border border-cyan-400/40 bg-black/30 px-2 py-1 text-sm font-semibold text-zinc-100 outline-none"
                      />
                    ) : (
                      <Link href={`/d-code/${project.id}`} className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm font-semibold transition-colors group-hover:text-cyan-300 ${
                            untitled ? "italic text-zinc-500" : "text-zinc-100"
                          }`}
                        >
                          {untitled ? "Untitled project" : project.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {project.files.length}{" "}
                          {project.files.length === 1 ? "file" : "files"} ·{" "}
                          {project.language} · edited {formatRelative(project.updatedAt)}
                        </p>
                      </Link>
                    )}
                    {/* Visibility — icon + text, never colour alone. */}
                    <span
                      className={`flex flex-shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                        project.isPublic
                          ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-300"
                          : "border-white/[0.08] bg-white/[0.03] text-zinc-400"
                      }`}
                    >
                      {project.isPublic ? (
                        <GlobeIcon className="h-3 w-3" />
                      ) : (
                        <LockIcon className="h-3 w-3" />
                      )}
                      {project.isPublic ? "Public" : "Private"}
                    </span>
                  </div>

                  {/* Actions: Open · Share · ⋯ */}
                  <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                    <Link
                      href={`/d-code/${project.id}`}
                      className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                    >
                      <CodeIcon className="h-3.5 w-3.5" />
                      Open
                    </Link>
                    <Link
                      href={`/share?sourceType=dcode_project&sourceId=${encodeURIComponent(project.id)}`}
                      aria-label={`Share ${project.title.trim() || "untitled project"}`}
                      className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                    >
                      <ShareIcon className="h-3.5 w-3.5" />
                      Share
                    </Link>
                    {busy ? (
                      <span className="flex h-9 w-9 items-center justify-center">
                        <LoaderIcon className="h-4 w-4 animate-spin text-zinc-500" />
                      </span>
                    ) : (
                      <CardMenu
                        project={project}
                        busy={busy}
                        confirmingDelete={confirmingId === project.id}
                        onRename={() => startRename(project)}
                        onDuplicate={() => void handleDuplicate(project)}
                        onDelete={() => void handleDelete(project)}
                      />
                    )}
                  </div>
                  {confirmingId === project.id && (
                    <p role="status" className="mt-2 text-[11px] text-red-300">
                      Delete “{project.title.trim() || "Untitled project"}”? Open ⋯ and click
                      Delete again to confirm.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
