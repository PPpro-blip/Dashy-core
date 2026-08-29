"use client";

/**
 * DashyCore v7 — /d-code/[id] (project editor).
 *
 * Loads the project through lib/dcode (RLS: owner-only) and hands it to
 * the workspace with autosave enabled. Unknown / foreign ids render a
 * friendly not-found panel instead of an error.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getProject, type DCodeProject } from "@/lib/dcode";
import { DCodeWorkspace } from "@/components/dcode/DCodeWorkspace";
import { AlertIcon, CodeIcon, LoaderIcon } from "@/components/icons";

interface LoadState {
  status: "loading" | "ready" | "missing" | "error";
  project: DCodeProject | null;
  message?: string;
}

export default function DCodeProjectPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const [state, setState] = useState<LoadState>({
    status: "loading",
    project: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const project = await getProject(id);
        if (cancelled) return;
        setState(
          project
            ? { status: "ready", project }
            : {
                status: "missing",
                project: null,
              }
        );
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          project: null,
          message:
            error instanceof Error ? error.message : "Could not load project.",
        });
      }
    }
    if (id) void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center gap-2 text-zinc-500">
        <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
        <span className="text-sm">Loading project…</span>
      </div>
    );
  }

  if (state.status !== "ready" || !state.project) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-16">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10">
            {state.status === "error" ? (
              <AlertIcon className="h-5 w-5 text-red-400" />
            ) : (
              <CodeIcon className="h-5 w-5 text-cyan-400" />
            )}
          </div>
          <p className="mt-4 text-base font-medium text-zinc-100">
            {state.status === "error"
              ? "Could not load this project"
              : "Project not found"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {state.status === "error"
              ? state.message
              : "It may have been deleted, or it belongs to another account."}
          </p>
          <Link
            href="/projects"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
          >
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return <DCodeWorkspace project={state.project} />;
}
