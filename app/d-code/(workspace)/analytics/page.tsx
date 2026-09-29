"use client";

/**
 * DashyCore v7 — D-Code · Analytics.
 *
 * D-Code intelligence, not a separate product: every number here is derived
 * client-side from the signed-in user's real `dcode_projects` rows (RLS
 * scoped). There is no analytics backend and nothing is estimated,
 * simulated or extrapolated.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listProjects, type DCodeProject } from "@/lib/dcode";
import { DCodeTabs } from "@/components/dcode/DCodeTabs";
import {
  ChartIcon,
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  LoaderIcon,
  LockIcon,
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

export default function DCodeAnalyticsPage() {
  const [projects, setProjects] = useState<DCodeProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load projects.");
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const rows = projects ?? [];
    const files = rows.reduce((sum, p) => sum + p.files.length, 0);
    const chars = rows.reduce(
      (sum, p) => sum + p.files.reduce((s, f) => s + f.content.length, 0),
      0
    );
    const publicCount = rows.filter((p) => p.isPublic).length;

    const byLanguage = new Map<string, number>();
    for (const project of rows) {
      for (const file of project.files) {
        byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1);
      }
    }
    const languages = [...byLanguage.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count);

    const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const activeThisWeek = rows.filter(
      (p) => new Date(p.updatedAt).getTime() >= week
    ).length;

    return {
      total: rows.length,
      files,
      chars,
      publicCount,
      privateCount: rows.length - publicCount,
      languages,
      activeThisWeek,
      recent: [...rows]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 6),
    };
  }, [projects]);

  if (projects === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-zinc-500">
        <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
        Loading D-Code analytics…
      </div>
    );
  }

  const maxLanguage = stats.languages[0]?.count ?? 1;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Live numbers from your own D-Code projects.
          </p>
        </div>
        <DCodeTabs />
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {stats.total === 0 && !error ? (
        <div className="mt-8 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-10 text-center sm:p-12">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
            <ChartIcon className="h-6 w-6 text-cyan-400" />
          </div>
          <p className="mt-4 text-base font-medium text-zinc-100">
            No data yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
            Analytics fills in as soon as you create your first D-Code
            project.
          </p>
          <Link
            href="/projects"
            className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
          >
            <CodeIcon className="h-4 w-4" />
            Go to projects
          </Link>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Projects", value: stats.total, Icon: CodeIcon },
              { label: "Files", value: stats.files, Icon: FileTextIcon },
              {
                label: "Edited this week",
                value: stats.activeThisWeek,
                Icon: ChartIcon,
              },
              { label: "Public", value: stats.publicCount, Icon: GlobeIcon },
            ].map(({ label, value, Icon }) => (
              <div
                key={label}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </dt>
                <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {/* Language mix */}
            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="text-sm font-semibold text-zinc-100">
                Language mix
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Files per language across every project.
              </p>
              <ul className="mt-4 space-y-2.5">
                {stats.languages.slice(0, 8).map(({ language, count }) => (
                  <li key={language}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-medium text-zinc-300">
                        {language}
                      </span>
                      <span className="flex-shrink-0 text-zinc-500">
                        {count} {count === 1 ? "file" : "files"}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400"
                        style={{
                          width: `${Math.max(6, (count / maxLanguage) * 100)}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
                {stats.languages.length === 0 && (
                  <li className="text-xs text-zinc-500">No files yet.</li>
                )}
              </ul>
            </section>

            {/* Visibility + recency */}
            <section className="space-y-4">
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Visibility
                </h2>
                <div className="mt-3 flex gap-2">
                  <div className="flex-1 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-200">
                      <GlobeIcon className="h-3.5 w-3.5" />
                      Public
                    </p>
                    <p className="mt-1 text-xl font-semibold text-white">
                      {stats.publicCount}
                    </p>
                  </div>
                  <div className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                      <LockIcon className="h-3.5 w-3.5" />
                      Private
                    </p>
                    <p className="mt-1 text-xl font-semibold text-white">
                      {stats.privateCount}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  Public projects are reachable through their share link.
                  DashyCore does not track visits — no view counter is shown
                  because there is no data behind one.
                </p>
              </div>

              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Recently edited
                </h2>
                <ul className="mt-3 space-y-1">
                  {stats.recent.map((project) => (
                    <li key={project.id}>
                      <Link
                        href={`/d-code/${project.id}`}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                      >
                        <CodeIcon className="h-3.5 w-3.5 flex-shrink-0 text-cyan-300" />
                        <span className="min-w-0 flex-1 truncate">
                          {project.title?.trim() || "Untitled project"}
                        </span>
                        <span className="flex-shrink-0 text-zinc-600">
                          {formatRelative(project.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-zinc-600">
            Total stored code: {stats.chars.toLocaleString()} characters across{" "}
            {stats.files} {stats.files === 1 ? "file" : "files"}.
          </p>
        </>
      )}
    </div>
  );
}
