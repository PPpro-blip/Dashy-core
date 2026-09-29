"use client";

/**
 * DashyCore v7 — Share Hub source picker.
 *
 * "What are you sharing?" — only source types that genuinely exist:
 *   · D-Code project  (Supabase, RLS-scoped to the signed-in user)
 *   · Studio asset    (locally stored Pollinations generations)
 *   · Dashy content   (any link + title you compose by hand)
 *
 * Nothing is listed that the account cannot actually reach.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { listProjects, type DCodeProject } from "@/lib/dcode";
import { listStudioAssets, type StudioAsset } from "@/lib/studio";
import type { ShareSource, ShareSourceKind } from "@/lib/share/types";
import {
  ChevronLeftIcon,
  CodeIcon,
  FolderIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  LockIcon,
  SparklesIcon,
} from "@/components/icons";

interface ShareSourcePickerProps {
  onSelect: (source: ShareSource) => void;
  onCancel?: () => void;
}

const KINDS: {
  kind: ShareSourceKind;
  label: string;
  description: string;
  Icon: typeof CodeIcon;
}[] = [
  {
    kind: "dcode-project",
    label: "Project",
    description: "A D-Code project and its public link",
    Icon: CodeIcon,
  },
  {
    kind: "studio-asset",
    label: "Studio asset",
    description: "An image you generated in Studio",
    Icon: SparklesIcon,
  },
  {
    kind: "link",
    label: "Dashy content",
    description: "Any link with your own caption",
    Icon: LinkIcon,
  },
];

export function ShareSourcePicker({ onSelect, onCancel }: ShareSourcePickerProps) {
  const [kind, setKind] = useState<ShareSourceKind | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">
          What are you sharing?
        </h3>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            Cancel
          </button>
        )}
      </div>

      {kind === null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {KINDS.map(({ kind: k, label, description, Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className="flex min-h-[44px] flex-col items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition-colors hover:border-cyan-400/40 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium text-zinc-100">{label}</span>
              <span className="text-xs leading-relaxed text-zinc-500">
                {description}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setKind(null)}
            className="mb-3 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:text-cyan-300"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            All source types
          </button>

          {kind === "dcode-project" && <ProjectList onSelect={onSelect} />}
          {kind === "studio-asset" && <AssetList onSelect={onSelect} />}
          {kind === "link" && <LinkForm onSelect={onSelect} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ projects ------------------------------- */

function ProjectList({ onSelect }: { onSelect: (s: ShareSource) => void }) {
  const [projects, setProjects] = useState<DCodeProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load projects.");
          setProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (projects === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-zinc-500">
        <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
        Loading your projects…
      </p>
    );
  }

  if (error) {
    return <p className="py-6 text-sm text-red-300">{error}</p>;
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center">
        <FolderIcon className="mx-auto h-6 w-6 text-zinc-600" />
        <p className="mt-2 text-sm text-zinc-300">No projects yet</p>
        <p className="mt-1 text-xs text-zinc-500">
          Create one in D-Code, then share it from here.
        </p>
      </div>
    );
  }

  const filtered = query.trim()
    ? projects.filter((p) =>
        p.title.toLowerCase().includes(query.trim().toLowerCase())
      )
    : projects;

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects…"
        aria-label="Search projects"
        className="mb-2 h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-cyan-400/50 focus:outline-none"
      />
      <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {filtered.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              onClick={() =>
                onSelect({
                  kind: "dcode-project",
                  id: project.id,
                  title: project.title,
                  language: project.language,
                  fileCount: project.files.length,
                  isPublic: project.isPublic,
                  shareSlug: project.shareSlug,
                })
              }
              className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-cyan-400/40 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <CodeIcon className="h-4 w-4 flex-shrink-0 text-cyan-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-100">
                  {project.title?.trim() || "Untitled project"}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {project.files.length}{" "}
                  {project.files.length === 1 ? "file" : "files"} · {project.language}
                </span>
              </span>
              <span
                className="flex-shrink-0 text-zinc-500"
                title={project.isPublic ? "Public" : "Private"}
              >
                {project.isPublic ? (
                  <GlobeIcon className="h-3.5 w-3.5 text-cyan-300" />
                ) : (
                  <LockIcon className="h-3.5 w-3.5" />
                )}
                <span className="sr-only">
                  {project.isPublic ? "Public" : "Private"}
                </span>
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-6 text-center text-sm text-zinc-500">
            No matching projects
          </li>
        )}
      </ul>
    </div>
  );
}

/* ------------------------------- assets -------------------------------- */

function AssetList({ onSelect }: { onSelect: (s: ShareSource) => void }) {
  const [assets, setAssets] = useState<StudioAsset[]>([]);

  useEffect(() => {
    setAssets(listStudioAssets());
  }, []);

  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center">
        <ImageIcon className="mx-auto h-6 w-6 text-zinc-600" />
        <p className="mt-2 text-sm text-zinc-300">No Studio assets yet</p>
        <p className="mt-1 text-xs text-zinc-500">
          Generate an image in Studio and it will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
      {assets.map((asset) => (
        <li key={asset.id}>
          <button
            type="button"
            onClick={() =>
              onSelect({
                kind: "studio-asset",
                id: asset.id,
                prompt: asset.prompt,
                imageUrl: asset.url,
                createdAt: asset.createdAt,
              })
            }
            className="group block w-full overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] text-left transition-colors hover:border-cyan-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <span className="relative block aspect-square w-full bg-black/30">
              <Image
                src={asset.url}
                alt={asset.prompt}
                fill
                unoptimized
                sizes="160px"
                className="object-cover"
              />
            </span>
            <span className="block truncate px-2 py-1.5 text-[11px] text-zinc-400">
              {asset.prompt}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- link --------------------------------- */

function LinkForm({ onSelect }: { onSelect: (s: ShareSource) => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const clean = url.trim();
      if (!clean) return;
      onSelect({
        kind: "link",
        id: clean,
        title: title.trim() || clean,
        url: clean,
      });
    },
    [onSelect, title, url]
  );

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label
          htmlFor="share-link-url"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Link
        </label>
        <input
          id="share-link-url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-cyan-400/50 focus:outline-none"
        />
      </div>
      <div>
        <label
          htmlFor="share-link-title"
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          Title <span className="text-zinc-600">(optional)</span>
        </label>
        <input
          id="share-link-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is this?"
          className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-cyan-400/50 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={!url.trim()}
        className="min-h-[40px] w-full rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400 disabled:opacity-40"
      >
        Use this link
      </button>
    </form>
  );
}
