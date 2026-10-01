"use client";

/**
 * DashyCore v7 — Source Control panel (real GitHub, web-safe).
 *
 * All API traffic goes through app/api/github/[...path] (server proxy with
 * the Supabase session's GitHub provider_token) — no fake commits, no
 * token in localStorage or project JSON. Commits are real GitHub Git Data
 * API commits (blobs → tree → commit → ref).
 *
 * Change model: the current D-Code files are hashed with git's blob SHA-1
 * and compared against the bound branch's recursive tree, so the panel
 * shows modified / added / deleted without storing any snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DCodeFile } from "@/lib/dcode";
import { isBinaryPath } from "@/lib/dcode-binary";
import { unifiedDiff } from "@/lib/dcode/diff";
import {
  computeRepoChanges,
  getBranchHead,
  getRepoTree,
  getBlobBytes,
  GithubApiError,
  listBranches,
  listUserRepos,
  pullRepoContents,
  pushCommit,
  type GithubBind,
  type GithubRepoInfo,
  type GithubTreeEntry,
  type RepoChange,
} from "@/lib/dcode/github";
import { useToast } from "@/components/Toast";
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  GitBranchIcon,
  GitCommitIcon,
  GithubIcon,
  LoaderIcon,
  RefreshIcon,
  XIcon,
} from "@/components/icons";

interface SourceControlPanelProps {
  files: DCodeFile[];
  bind: GithubBind | null;
  /** True when the session was created via GitHub OAuth. */
  connected: boolean;
  /** Runs the GitHub OAuth flow (repo scope) and returns to D-Code. */
  onConnect: () => void;
  /** Persists the bind (or null to unbind) on the project row. */
  onBind: (bind: GithubBind | null) => Promise<void>;
  /** Replaces the workspace files with a pulled snapshot. */
  onPull: (files: DCodeFile[], syncedSha: string) => void;
  /** Bumped whenever a command asks the commit box to focus. */
  commitFocusSignal?: number;
}

interface DiffView {
  name: string;
  kind: RepoChange["kind"];
  lines: Exclude<ReturnType<typeof unifiedDiff>, null>;
  addCount: number;
  delCount: number;
}

const CHANGE_LABEL: Record<RepoChange["kind"], { label: string; cls: string; glyph: string }> = {
  modified: { label: "Modified", cls: "text-amber-300 border-amber-400/30 bg-amber-400/10", glyph: "M" },
  added: { label: "Added", cls: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10", glyph: "A" },
  deleted: { label: "Deleted", cls: "text-red-300 border-red-400/30 bg-red-400/10", glyph: "D" },
};

export function SourceControlPanel({
  files,
  bind,
  connected,
  onConnect,
  onBind,
  onPull,
  commitFocusSignal = 0,
}: SourceControlPanelProps) {
  const toast = useToast();

  /* ------------------------------ state -------------------------------- */

  const [repos, setRepos] = useState<GithubRepoInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [pickedRepo, setPickedRepo] = useState<GithubRepoInfo | null>(null);
  const [pickerStage, setPickerStage] = useState<"idle" | "repos" | "branches">("idle");
  const [listing, setListing] = useState(false);

  const [tree, setTree] = useState<GithubTreeEntry[] | null>(null);
  const [baselineSha, setBaselineSha] = useState<string | null>(null);
  const [changes, setChanges] = useState<RepoChange[] | null>(null);
  const [staged, setStaged] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<DiffView | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPull, setConfirmPull] = useState(false);

  const commitBoxRef = useRef<HTMLTextAreaElement>(null);
  const baselineCache = useRef<Map<string, string>>(new Map());

  const ownerRepo = useMemo(() => {
    if (!bind?.fullName) return null;
    const [owner, ...rest] = bind.fullName.split("/");
    return { owner, repo: rest.join("/") };
  }, [bind?.fullName]);

  /* --------------------------- change model ----------------------------- */

  const applyTree = useCallback((nextTree: GithubTreeEntry[], sha: string) => {
    setTree(nextTree);
    setBaselineSha(sha);
    baselineCache.current.clear();
  }, []);

  /** (Re)computes the change list from current files + cached tree. */
  const recomputeChanges = useCallback(
    async (nextTree: GithubTreeEntry[] | null, nextFiles: DCodeFile[]) => {
      if (!nextTree || nextTree.length === 0) {
        setChanges(null);
        return;
      }
      try {
        const next = await computeRepoChanges(nextFiles, nextTree);
        setChanges(next);
      } catch {
        // Hashing is best-effort; keep the previous list on failure.
      }
    },
    []
  );

  // Recompute when the user edits files (debounced so typing stays smooth).
  const filesRef = useRef(files);
  filesRef.current = files;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  useEffect(() => {
    if (!treeRef.current) return;
    const t = window.setTimeout(() => {
      void recomputeChanges(treeRef.current, filesRef.current);
    }, 600);
    return () => window.clearTimeout(t);
  }, [files, recomputeChanges]);

  // New changes default to staged; edits never silently unstage anything.
  useEffect(() => {
    if (!changes) return;
    setStaged((prev) => {
      const names = new Set(changes.map((c) => c.name));
      const next = new Set<string>();
      for (const name of prev) if (names.has(name)) next.add(name);
      for (const name of names) next.add(name);
      return next;
    });
  }, [changes]);

  /* --------------------------- baseline sync ---------------------------- */

  const refreshBaseline = useCallback(async () => {
    if (!bind || !ownerRepo) return;
    setBusy("Refreshing from GitHub…");
    setError(null);
    try {
      const sha = await getBranchHead(ownerRepo.owner, ownerRepo.repo, bind.defaultBranch);
      const nextTree = await getRepoTree(ownerRepo.owner, ownerRepo.repo, bind.defaultBranch);
      applyTree(nextTree, sha);
      await recomputeChanges(nextTree, filesRef.current);
      await onBind({ ...bind, lastSyncedSha: sha });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach GitHub.");
    } finally {
      setBusy(null);
    }
  }, [applyTree, bind, onBind, ownerRepo, recomputeChanges]);

  // Initial baseline: on mount and whenever the bind changes.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!connected || !bind) return;
    if (firstRun.current || bind.lastSyncedSha !== baselineSha) {
      firstRun.current = false;
      void refreshBaseline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bind?.fullName, bind?.defaultBranch, connected]);

  /* ------------------------------ bind flow ----------------------------- */

  const openRepoPicker = useCallback(async () => {
    setError(null);
    setPickerStage("repos");
    setListing(true);
    try {
      setRepos(await listUserRepos());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list repositories.");
    } finally {
      setListing(false);
    }
  }, []);

  const pickRepo = useCallback(async (repo: GithubRepoInfo) => {
    setPickedRepo(repo);
    setPickerStage("branches");
    setListing(true);
    setError(null);
    try {
      const [owner, ...rest] = repo.full_name.split("/");
      setBranches(await listBranches(owner, rest.join("/")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list branches.");
      setPickerStage("repos");
    } finally {
      setListing(false);
    }
  }, []);

  const pickBranch = useCallback(
    async (branch: string) => {
      if (!pickedRepo) return;
      setBusy("Binding repository…");
      setError(null);
      try {
        await onBind({
          fullName: pickedRepo.full_name,
          defaultBranch: branch,
          lastSyncedSha: null,
        });
        setPickerStage("idle");
        setPickedRepo(null);
        setRepos([]);
        setBranches([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not bind the repository.");
      } finally {
        setBusy(null);
      }
    },
    [onBind, pickedRepo]
  );

  const unbind = useCallback(async () => {
    setBusy("Unbinding…");
    setError(null);
    try {
      await onBind(null);
      setTree(null);
      setBaselineSha(null);
      setChanges(null);
      setDiff(null);
      setStaged(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unbind.");
    } finally {
      setBusy(null);
    }
  }, [onBind]);

  /* -------------------------------- pull -------------------------------- */

  const doPull = useCallback(async () => {
    if (!bind || !ownerRepo) return;
    setBusy("Loading from GitHub…");
    setError(null);
    try {
      const result = await pullRepoContents(ownerRepo.owner, ownerRepo.repo, bind.defaultBranch);
      const sha = await getBranchHead(ownerRepo.owner, ownerRepo.repo, bind.defaultBranch);
      onPull(result.files, sha);
      setConfirmPull(false);
      setDiff(null);
      toast.show({
        type: "success",
        title: "Loaded from GitHub",
        message: `${result.files.length} file${result.files.length === 1 ? "" : "s"} pulled${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}.`,
      });
      await onBind({ ...bind, lastSyncedSha: sha });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the repository.");
    } finally {
      setBusy(null);
    }
  }, [bind, onBind, onPull, ownerRepo, toast]);

  /* ------------------------------- commit ------------------------------- */

  const canCommit = useMemo(
    () => (changes?.length ?? 0) > 0 && staged.size > 0 && message.trim().length > 0,
    [changes, staged, message]
  );

  const doCommit = useCallback(async () => {
    if (!bind || !ownerRepo) return;
    if (!message.trim()) {
      toast.show({ type: "error", title: "Commit message required" });
      return;
    }
    const stagedChanges = (changes ?? []).filter((c) => staged.has(c.name));
    if (stagedChanges.length === 0) {
      toast.show({ type: "error", title: "Stage at least one change" });
      return;
    }
    setBusy("Committing & pushing…");
    setError(null);
    try {
      const byName = new Map(files.map((f) => [f.name, f]));
      const toWrite: DCodeFile[] = [];
      const toDelete: string[] = [];
      for (const change of stagedChanges) {
        if (change.kind === "deleted") {
          toDelete.push(change.path ?? change.name);
        } else {
          const file = byName.get(change.name);
          if (file) toWrite.push(file);
        }
      }
      const result = await pushCommit({
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        branch: bind.defaultBranch,
        message: message.trim(),
        files: toWrite,
        deleted: toDelete,
      });
      setMessage("");
      toast.show({
        type: "success",
        title: "Committed & pushed ✓",
        message: result.url,
        duration: 8000,
      });
      // New baseline = the commit we just made.
      const nextTree = await getRepoTree(ownerRepo.owner, ownerRepo.repo, bind.defaultBranch);
      applyTree(nextTree, result.sha);
      await recomputeChanges(nextTree, filesRef.current);
      await onBind({ ...bind, lastSyncedSha: result.sha });
    } catch (err) {
      const isAuth = err instanceof GithubApiError && err.kind === "auth";
      setError(
        isAuth
          ? "Your GitHub connection expired — reconnect GitHub to push."
          : err instanceof Error
            ? err.message
            : "Commit failed."
      );
    } finally {
      setBusy(null);
    }
  }, [applyTree, bind, changes, files, message, onBind, ownerRepo, recomputeChanges, staged, toast]);

  // "Source Control: Commit" command focuses the message box.
  useEffect(() => {
    if (commitFocusSignal > 0) {
      window.setTimeout(() => commitBoxRef.current?.focus(), 50);
    }
  }, [commitFocusSignal]);

  /* -------------------------------- diff -------------------------------- */

  const openDiff = useCallback(
    async (change: RepoChange) => {
      setDiffLoading(true);
      setError(null);
      try {
        const current =
          files.find((f) => f.name === change.name)?.content ?? "";
        let base = "";
        if (change.kind !== "added" && tree && ownerRepo) {
          const entry = tree.find(
            (e) =>
              e.type === "blob" &&
              (e.path.toLowerCase().endsWith(`/${change.name.toLowerCase()}`) ||
                e.path.toLowerCase() === change.name.toLowerCase())
          );
          if (entry) {
            if (baselineCache.current.has(entry.sha)) {
              base = baselineCache.current.get(entry.sha) ?? "";
            } else {
              if (isBinaryPath(change.name)) {
                // Binary file — show a marker instead of a text diff.
                setDiff({
                  name: change.name,
                  kind: change.kind,
                  lines: [],
                  addCount: 0,
                  delCount: 0,
                });
                setDiffLoading(false);
                return;
              }
              const bytes = await getBlobBytes(ownerRepo.owner, ownerRepo.repo, entry.sha);
              base = new TextDecoder().decode(bytes);
              if (base.length <= 400_000) baselineCache.current.set(entry.sha, base);
            }
          }
        }
        const lines = unifiedDiff(base, current);
        if (lines === null) {
          setDiff({
            name: change.name,
            kind: change.kind,
            lines: [],
            addCount: 0,
            delCount: 0,
          });
        } else {
          setDiff({
            name: change.name,
            kind: change.kind,
            lines,
            addCount: lines.filter((l) => l.kind === "add").length,
            delCount: lines.filter((l) => l.kind === "del").length,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the diff.");
      } finally {
        setDiffLoading(false);
      }
    },
    [files, ownerRepo, tree]
  );

  /* ------------------------------ renderers ----------------------------- */

  const renderPicker = () => {
    if (pickerStage === "idle") return null;
    if (pickerStage === "repos") {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-zinc-400">Your repositories</p>
            <button
              type="button"
              onClick={() => void openRepoPicker()}
              disabled={listing}
              className="text-[10px] font-medium text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
            >
              {listing ? "Loading…" : "Refresh"}
            </button>
          </div>
          {listing && repos.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-zinc-500">
              <LoaderIcon className="h-3 w-3 animate-spin text-cyan-400" />
              Fetching repositories…
            </p>
          ) : (
            <ul className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 p-1.5">
              {repos.length === 0 && (
                <li className="px-2 py-3 text-center text-[11px] text-zinc-600">
                  No repositories found.
                </li>
              )}
              {repos.map((repo) => (
                <li key={repo.full_name}>
                  <button
                    type="button"
                    onClick={() => void pickRepo(repo)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <GitBranchIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-zinc-200">
                        {repo.full_name}
                      </span>
                    </span>
                    <span
                      className={`flex-shrink-0 rounded border px-1 text-[9px] font-semibold uppercase tracking-wider ${
                        repo.private
                          ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                          : "border-white/[0.08] bg-white/[0.03] text-zinc-500"
                      }`}
                    >
                      {repo.private ? "Private" : "Public"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    // branches
    return (
      <div className="space-y-2">
        <p className="text-[11px] font-medium text-zinc-400">
          Branch for <span className="font-mono text-cyan-300">{pickedRepo?.full_name}</span>
        </p>
        {listing ? (
          <p className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-zinc-500">
            <LoaderIcon className="h-3 w-3 animate-spin text-cyan-400" />
            Fetching branches…
          </p>
        ) : (
          <ul className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 p-1.5">
            {branches.map((branch) => (
              <li key={branch}>
                <button
                  type="button"
                  onClick={() => void pickBranch(branch)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <GitBranchIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                  <span className="font-mono text-[11px] text-zinc-200">{branch}</span>
                  {branch === pickedRepo?.default_branch && (
                    <span className="ml-auto rounded border border-cyan-400/25 bg-cyan-400/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                      Default
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            setPickerStage("idle");
            setPickedRepo(null);
          }}
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          ← Back to repositories
        </button>
      </div>
    );
  };

  /* ---------------------------- empty states ---------------------------- */

  if (!connected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Source Control
        </p>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04]">
            <GithubIcon className="h-6 w-6 text-zinc-400" />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-zinc-100">
            Connect GitHub
          </h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Sign in with GitHub to bind this project to a repository, pull
            changes and push real commits. Your session token is used
            server-side — it is never stored in this project.
          </p>
          <button
            type="button"
            onClick={onConnect}
            className="mt-4 flex items-center gap-2 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
          >
            <GithubIcon className="h-3.5 w-3.5" />
            Connect GitHub
          </button>
        </div>
      </div>
    );
  }

  if (!bind) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Source Control
        </p>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10">
            <GitBranchIcon className="h-6 w-6 text-cyan-300" />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-zinc-100">
            Bind a GitHub repository
          </h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Pick one of your repositories and a branch. D-Code compares your
            files against that branch and pushes real commits through the
            GitHub API.
          </p>
          <button
            type="button"
            onClick={() => void openRepoPicker()}
            className="mt-4 flex items-center gap-2 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
          >
            <GitBranchIcon className="h-3.5 w-3.5" />
            {busy ? busy : "Bind repository"}
          </button>
        </div>
        {pickerStage !== "idle" && (
          <div className="flex-shrink-0 border-t border-white/[0.06] px-3 py-3">
            {renderPicker()}
          </div>
        )}
        {error && (
          <p role="alert" className="mx-3 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
      </div>
    );
  }

  /* ------------------------------ main view ----------------------------- */

  const changedCount = changes?.length ?? 0;
  const stagedCount = staged.size;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Source Control
      </p>

      {/* Bound repo header */}
      <div className="mx-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
        <div className="flex items-center gap-2">
          <GithubIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-zinc-200">
            {bind.fullName}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="flex items-center gap-1 rounded border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
            <GitBranchIcon className="h-2.5 w-2.5" />
            {bind.defaultBranch}
          </span>
          {baselineSha && (
            <span className="truncate font-mono text-[10px] text-zinc-600" title="Last synced commit">
              {baselineSha.slice(0, 7)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refreshBaseline()}
            disabled={busy !== null}
            title="Refresh from GitHub — update the change baseline"
            className="ml-auto flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-1.5 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
          >
            <RefreshIcon className="h-3 w-3" />
            {busy ?? "Refresh"}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmPull((v) => !v)}
            disabled={busy !== null}
            title="Load the repository contents into this project"
            className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-1.5 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
          >
            <DownloadIcon className="h-3 w-3" />
            Load from GitHub
          </button>
          <button
            type="button"
            onClick={() => void unbind()}
            disabled={busy !== null}
            className="rounded-md px-1.5 py-1 text-[10px] font-medium text-zinc-600 transition-colors hover:text-red-300 disabled:opacity-50"
          >
            Unbind
          </button>
        </div>
        {confirmPull && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5">
            <span className="flex-1 text-[10px] leading-relaxed text-cyan-200">
              Replace the project files with the current {bind.defaultBranch} contents?
            </span>
            <button
              type="button"
              onClick={() => void doPull()}
              disabled={busy !== null}
              className="rounded-md bg-cyan-500 px-2 py-1 text-[10px] font-semibold text-[#06202a] hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy ?? "Pull"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmPull(false)}
              className="rounded-md px-1 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mx-2.5 mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2"
        >
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-red-300">{error}</p>
          {/reconnect|expired|connect/i.test(error) && (
            <button
              type="button"
              onClick={onConnect}
              className="flex-shrink-0 rounded-md border border-red-400/40 px-2 py-0.5 text-[10px] font-semibold text-red-200 hover:bg-red-400/10"
            >
              Reconnect GitHub
            </button>
          )}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="flex-shrink-0 text-red-300/60 hover:text-red-200"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Changes */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        <p className="px-0.5 pb-1.5 text-[11px] font-medium text-zinc-400">
          Changes{" "}
          {changedCount > 0 && (
            <span className="text-zinc-600">
              · {stagedCount}/{changedCount} staged
            </span>
          )}
        </p>
        {busy && !changes && (
          <p className="flex items-center gap-2 px-0.5 py-2 text-[11px] text-zinc-500">
            <LoaderIcon className="h-3 w-3 animate-spin text-cyan-400" />
            {busy}
          </p>
        )}
        {!busy && changedCount === 0 && (
          <div className="flex flex-col items-center px-2 py-8 text-center">
            <CheckIcon className="h-5 w-5 text-emerald-400/70" />
            <p className="mt-2 text-[11px] text-zinc-500">
              {tree ? "Working tree matches GitHub." : "Refresh from GitHub to see changes."}
            </p>
          </div>
        )}
        <ul className="space-y-1">
          {changes?.map((change) => {
            const info = CHANGE_LABEL[change.kind];
            const checked = staged.has(change.name);
            return (
              <li key={`${change.kind}:${change.name}`}>
                <div className="group flex items-center gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setStaged((prev) => {
                        const next = new Set(prev);
                        if (next.has(change.name)) next.delete(change.name);
                        else next.add(change.name);
                        return next;
                      })
                    }
                    aria-label={`Stage ${change.name}`}
                    className="h-3.5 w-3.5 flex-shrink-0 accent-cyan-400"
                  />
                  <span
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border font-mono text-[9px] font-bold ${info.cls}`}
                    title={info.label}
                  >
                    {info.glyph}
                  </span>
                  <button
                    type="button"
                    onClick={() => void openDiff(change)}
                    disabled={diffLoading}
                    title={`View diff for ${change.name}`}
                    className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-zinc-300 transition-colors hover:text-cyan-300"
                  >
                    {change.name}
                    {change.path && change.path !== change.name && (
                      <span className="text-zinc-600"> ({change.path})</span>
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Diff view */}
        {diff && (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.08] bg-black/30">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-2.5 py-1.5">
              <span className={`font-mono text-[10px] font-bold ${CHANGE_LABEL[diff.kind].cls.split(" ")[0]}`}>
                {CHANGE_LABEL[diff.kind].glyph}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-200">
                {diff.name}
              </span>
              {diff.lines.length > 0 ? (
                <span className="flex-shrink-0 font-mono text-[10px]">
                  <span className="text-emerald-400">+{diff.addCount}</span>{" "}
                  <span className="text-red-400">−{diff.delCount}</span>
                </span>
              ) : (
                <span className="flex-shrink-0 text-[10px] text-zinc-600">
                  {diff.kind === "deleted"
                    ? "not in this project"
                    : "binary or too large to diff"}
                </span>
              )}
              <button
                type="button"
                onClick={() => setDiff(null)}
                aria-label="Close diff"
                className="flex-shrink-0 text-zinc-600 hover:text-zinc-200"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-56 overflow-auto py-1 font-mono text-[10.5px] leading-relaxed">
              {diff.lines.map((line, i) => (
                <div
                  key={i}
                  className={`flex px-2.5 ${
                    line.kind === "add"
                      ? "bg-emerald-500/10 text-emerald-300"
                      : line.kind === "del"
                        ? "bg-red-500/10 text-red-300"
                        : "text-zinc-500"
                  }`}
                >
                  <span className="w-8 flex-shrink-0 select-none text-right text-zinc-700">
                    {line.kind === "add" ? "" : line.oldLine ?? ""}
                  </span>
                  <span className="w-4 flex-shrink-0 select-none text-zinc-700">
                    {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                  </span>
                  <span className="w-8 flex-shrink-0 select-none text-right text-zinc-700">
                    {line.kind === "del" ? "" : line.newLine ?? ""}
                  </span>
                  <span className="whitespace-pre-wrap break-all pl-1">{line.text || " "}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Commit box */}
      <div className="flex-shrink-0 space-y-2 border-t border-white/[0.06] px-3 py-2.5">
        <textarea
          ref={commitBoxRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void doCommit();
          }}
          rows={2}
          placeholder={`Commit message (pushes to ${bind.defaultBranch})`}
          spellCheck={false}
          aria-label="Commit message"
          className="w-full resize-none rounded-lg border border-white/[0.1] bg-black/20 px-2.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-400/50"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void doCommit()}
            disabled={!canCommit || busy !== null}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-semibold text-[#06202a] transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <LoaderIcon className="h-3 w-3 animate-spin" />
            ) : (
              <GitCommitIcon className="h-3 w-3" />
            )}
            {busy ?? "Commit & Push"}
          </button>
        </div>
        <p className="text-[9.5px] leading-relaxed text-zinc-600">
          Commits are pushed to GitHub with your account via the Git Data API
          (Ctrl+Enter to commit). Local terminal `git` commands are a
          simulation — real pushes live here.
        </p>
      </div>
    </div>
  );
}
