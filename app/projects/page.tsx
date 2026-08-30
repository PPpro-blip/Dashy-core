"use client";

/**
 * DashyCore v7 — Projects (real D-Code projects grid).
 *
 * Lists the signed-in user's D-Code projects (Supabase, RLS-scoped) with
 * create / open / delete. "New project" creates a starter project row and
 * opens it in the D-Code Monaco editor at /d-code/<id>.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createProject,
  deleteProject,
  listProjects,
  starterProjectDraft,
  type DCodeProject,
} from "@/lib/dcode";
import { useToast } from "@/components/Toast";
import {
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  LoaderIcon,
  LockIcon,
  PlusIcon,
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
  const [projects, setProjects] = useState<DCodeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Two-step delete confirm: the id staged for deletion. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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

  // Reset a staged delete if the pointer leaves the button.
  useEffect(() => {
    if (!confirmingId) return;
    const reset = () => setConfirmingId(null);
    const timer = window.setTimeout(reset, 3000);
    return () => {
      window.clearTimeout(timer);
    };
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
      setDeletingId(project.id);
      try {
        await deleteProject(project.id);
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
        toast.show({
          type: "success",
          title: "Project deleted",
          message: `“${project.title}” is gone.`,
        });
      } catch (error) {
        toast.show({
          type: "error",
          title: "Could not delete project",
          message: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setDeletingId(null);
      }
    },
    [confirmingId, toast]
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between gap-4">
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
          className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
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
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:opacity-50"
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
              const confirming = confirmingId === project.id;
              return (
                <li
                  key={project.id}
                  className="group relative flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-cyan-400/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/d-code/${project.id}`}
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-cyan-300">
                        {project.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {project.files.length}{" "}
                        {project.files.length === 1 ? "file" : "files"} ·{" "}
                        {project.language} · edited{" "}
                        {formatRelative(project.updatedAt)}
                      </p>
                    </Link>
                    <span
                      title={project.isPublic ? "Public — link sharing on" : "Private"}
                      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border ${
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
                    </span>
                  </div>

                  {/* File preview names */}
                  <div className="mt-3 flex min-h-[22px] flex-wrap gap-1.5">
                    {project.files.slice(0, 3).map((file) => (
                      <span
                        key={file.id}
                        className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
                      >
                        <FileTextIcon className="h-2.5 w-2.5" />
                        {file.name}
                      </span>
                    ))}
                    {project.files.length > 3 && (
                      <span className="rounded-md border border-white/[0.06] bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                        +{project.files.length - 3}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                    <Link
                      href={`/d-code/${project.id}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20"
                    >
                      <CodeIcon className="h-3.5 w-3.5" />
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDelete(project)}
                      disabled={deletingId !== null}
                      aria-label={`Delete ${project.title}`}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        confirming
                          ? "border-red-400/40 bg-red-500/10 text-red-300"
                          : "border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:border-red-400/40 hover:text-red-300"
                      }`}
                    >
                      {deletingId === project.id ? (
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <TrashIcon className="h-3.5 w-3.5" />
                      )}
                      {deletingId === project.id
                        ? "Deleting…"
                        : confirming
                          ? "Confirm delete"
                          : "Delete"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
