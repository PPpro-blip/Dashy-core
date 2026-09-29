"use client";

/**
 * DashyCore v7 — D-Code Projects.
 *
 * The signed-in user's real D-Code projects (Supabase, RLS-scoped).
 * Each card exposes exactly one primary path and one share path:
 *
 *     [ Open ]   [ Share ]   [ ⋯ ]
 *
 * ⋯ holds the real secondary actions (rename, duplicate, visibility, copy
 * link, delete). Share always opens THE canonical Share Hub with this exact
 * project pre-selected — never a second sharing implementation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createProject,
  deleteProject,
  listProjects,
  starterProjectDraft,
  toggleProjectPublic,
  updateProject,
  type DCodeProject,
} from "@/lib/dcode";
import { useToast } from "@/components/Toast";
import { useShareHub } from "@/components/share/ShareHubProvider";
import { DCodeTabs } from "@/components/dcode/DCodeTabs";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  GlobeIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  MoreHorizontalIcon,
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

export default function ProjectsPage() {
  const router = useRouter();
  const toast = useToast();
  const shareHub = useShareHub();

  const [projects, setProjects] = useState<DCodeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const project = await createProject(starterProjectDraft("typescript"));
      toast.success("Project created", "Opening it in D-Code…");
      router.push(`/d-code/${project.id}`);
    } catch (error) {
      toast.error(
        "Could not create project",
        error instanceof Error ? error.message : "Please try again."
      );
      setCreating(false);
    }
  }, [creating, router, toast]);

  const patchLocal = useCallback((next: DCodeProject) => {
    setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }, []);

  const handleRename = useCallback(
    async (project: DCodeProject, title: string) => {
      const clean = title.trim();
      if (!clean || clean === project.title) return;
      setBusyId(project.id);
      try {
        patchLocal(await updateProject(project.id, { title: clean }));
        toast.success("Project renamed");
      } catch (error) {
        toast.error(
          "Could not rename",
          error instanceof Error ? error.message : "Please try again."
        );
      } finally {
        setBusyId(null);
      }
    },
    [patchLocal, toast]
  );

  const handleDuplicate = useCallback(
    async (project: DCodeProject) => {
      setBusyId(project.id);
      try {
        const copy = await createProject({
          title: `${project.title?.trim() || "Untitled project"} (copy)`,
          description: project.description,
          language: project.language,
          files: project.files.map((file) => ({
            ...file,
            id: `${file.id}-copy-${Math.random().toString(36).slice(2, 8)}`,
          })),
        });
        setProjects((prev) => [copy, ...prev]);
        toast.success("Project duplicated");
      } catch (error) {
        toast.error(
          "Could not duplicate",
          error instanceof Error ? error.message : "Please try again."
        );
      } finally {
        setBusyId(null);
      }
    },
    [toast]
  );

  const handleVisibility = useCallback(
    async (project: DCodeProject) => {
      setBusyId(project.id);
      try {
        const updated = await toggleProjectPublic(project.id, !project.isPublic);
        patchLocal(updated);
        toast.show({
          type: updated.isPublic ? "success" : "info",
          title: updated.isPublic ? "Public link created" : "Project is private",
          message: updated.isPublic
            ? "Anyone with the link can open it."
            : "The share link no longer works.",
        });
      } catch (error) {
        toast.error(
          "Could not update visibility",
          error instanceof Error ? error.message : "Please try again."
        );
      } finally {
        setBusyId(null);
      }
    },
    [patchLocal, toast]
  );

  const handleCopyLink = useCallback(
    async (project: DCodeProject) => {
      if (!project.isPublic || !project.shareSlug) {
        toast.error(
          "No public link yet",
          "Open Share to publish a link for this project."
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(
          `${window.location.origin}/d-code/share/${project.shareSlug}`
        );
        toast.success("Link copied");
      } catch {
        toast.error("Clipboard unavailable");
      }
    },
    [toast]
  );

  const handleDelete = useCallback(
    async (project: DCodeProject) => {
      setBusyId(project.id);
      try {
        await deleteProject(project.id);
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
        toast.success(
          "Project deleted",
          `“${project.title?.trim() || "Untitled project"}” is gone.`
        );
      } catch (error) {
        toast.error(
          "Could not delete project",
          error instanceof Error ? error.message : "Please try again."
        );
      } finally {
        setBusyId(null);
      }
    },
    [toast]
  );

  /** The one and only Share path for a project card. */
  const handleShare = useCallback(
    (project: DCodeProject) => {
      shareHub.open({
        kind: "dcode-project",
        id: project.id,
        title: project.title,
        language: project.language,
        fileCount: project.files.length,
        isPublic: project.isPublic,
        shareSlug: project.shareSlug,
      });
    },
    [shareHub]
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Projects
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Multi-file D-Code workspaces.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DCodeTabs />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="flex min-h-[36px] flex-shrink-0 items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
          >
            {creating ? (
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlusIcon className="h-3.5 w-3.5" />
            )}
            New project
          </button>
        </div>
      </div>

      <div className="mt-6">
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
              className="mt-4 min-h-[36px] rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700"
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-10 text-center sm:p-12">
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
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busyId === project.id}
                onShare={() => handleShare(project)}
                onRename={(title) => void handleRename(project, title)}
                onDuplicate={() => void handleDuplicate(project)}
                onToggleVisibility={() => void handleVisibility(project)}
                onCopyLink={() => void handleCopyLink(project)}
                onDelete={() => void handleDelete(project)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Card                                                                       */
/* ========================================================================== */

interface ProjectCardProps {
  project: DCodeProject;
  busy: boolean;
  onShare: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onToggleVisibility: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  busy,
  onShare,
  onRename,
  onDuplicate,
  onToggleVisibility,
  onCopyLink,
  onDelete,
}: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState(project.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const hasTitle = !!project.title?.trim();
  const title = hasTitle ? project.title : "Untitled project";

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmDelete(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  const menuItem =
    "flex w-full min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-left text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:bg-white/[0.06]";

  return (
    <li className="group relative flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-cyan-400/25">
      {/* Title + visibility */}
      <div className="flex items-start justify-between gap-2">
        {renaming ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              onRename(draftTitle);
              setRenaming(false);
            }}
          >
            <input
              ref={renameRef}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => {
                onRename(draftTitle);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraftTitle(project.title);
                  setRenaming(false);
                }
              }}
              aria-label="Project title"
              className="h-8 w-full rounded-lg border border-cyan-400/40 bg-black/30 px-2 text-sm font-semibold text-white focus:outline-none"
            />
          </form>
        ) : (
          <Link
            href={`/d-code/${project.id}`}
            className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <p
              className={`truncate text-sm font-semibold transition-colors group-hover:text-cyan-300 ${
                hasTitle ? "text-zinc-100" : "italic text-zinc-500"
              }`}
              title={title}
            >
              {title}
            </p>
          </Link>
        )}

        <span
          className={`flex h-6 flex-shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium ${
            project.isPublic
              ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-300"
              : "border-white/[0.08] bg-white/[0.03] text-zinc-500"
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

      {/* Essential metadata only */}
      <p className="mt-1.5 truncate text-[11px] text-zinc-500">
        {project.files.length} {project.files.length === 1 ? "file" : "files"} ·{" "}
        {project.language} · edited {formatRelative(project.updatedAt)}
      </p>

      {/* Actions: Open · Share · ⋯ */}
      <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3">
        <Link
          href={`/d-code/${project.id}`}
          className="flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <CodeIcon className="h-3.5 w-3.5" />
          Open
        </Link>
        <button
          type="button"
          onClick={onShare}
          className="flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <ShareIcon className="h-3.5 w-3.5" />
          Share
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`More actions for ${title}`}
          className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          {busy ? (
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontalIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${title}`}
          className="absolute bottom-14 right-3 z-20 w-52 rounded-xl border border-white/[0.08] bg-[#151a33] p-1.5 shadow-2xl shadow-black/60"
        >
          <button
            role="menuitem"
            type="button"
            className={menuItem}
            onClick={() => {
              setDraftTitle(project.title);
              setRenaming(true);
              setMenuOpen(false);
            }}
          >
            <PenIcon className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            role="menuitem"
            type="button"
            className={menuItem}
            onClick={() => {
              onDuplicate();
              setMenuOpen(false);
            }}
          >
            <CopyIcon className="h-3.5 w-3.5" />
            Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            className={menuItem}
            onClick={() => {
              onToggleVisibility();
              setMenuOpen(false);
            }}
          >
            {project.isPublic ? (
              <LockIcon className="h-3.5 w-3.5" />
            ) : (
              <GlobeIcon className="h-3.5 w-3.5" />
            )}
            {project.isPublic ? "Make private" : "Make public"}
          </button>
          {project.isPublic && project.shareSlug && (
            <button
              role="menuitem"
              type="button"
              className={menuItem}
              onClick={() => {
                onCopyLink();
                setMenuOpen(false);
              }}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              Copy public link
            </button>
          )}
          <div className="my-1 h-px bg-white/[0.07]" />
          <button
            role="menuitem"
            type="button"
            className={`${menuItem} ${
              confirmDelete ? "text-red-300" : "hover:text-red-300"
            }`}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              onDelete();
              setMenuOpen(false);
              setConfirmDelete(false);
            }}
          >
            {confirmDelete ? (
              <CheckIcon className="h-3.5 w-3.5" />
            ) : (
              <TrashIcon className="h-3.5 w-3.5" />
            )}
            {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        </div>
      )}
    </li>
  );
}
