/**
 * DashyCore v7 — Source Control: real GitHub via the server proxy.
 *
 * Every request goes to app/api/github/[...path]/route.ts, which injects
 * the Supabase session's GitHub provider_token server-side — the token
 * never touches browser JS or project JSON. Commits are real: GitHub Git
 * Data API blobs → tree → commit → ref update, exactly like a push.
 *
 * The change model compares the current D-Code files against the last
 * known GitHub tree: each local file is hashed with git's own blob SHA-1
 * ("blob <size>\0" + bytes) and compared to the tree entry sha, so the
 * diff is exact without storing any snapshot.
 */

import {
  bytesToDataUrl,
  isBinaryPath,
  isDataUrl,
  mimeForBinaryExt,
  extensionWithDot,
} from "@/lib/dcode-binary";
import {
  basenameOf,
  cleanTextContent,
  containsBinaryMarkers,
  isBlockedPath,
  MAX_FILE_CONTENT_CHARS,
  sanitizeFiles,
} from "@/lib/dcode-sanitize";
import { languageFromFilename, newId, type DCodeFile } from "@/lib/dcode";

/** Server proxy that attaches the session GitHub token. */
const GITHUB_PROXY = "/api/github";

export class GithubApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly kind: "auth" | "rate" | "api" | "network" = "api"
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export interface GithubRepoInfo {
  full_name: string;
  html_url?: string;
  default_branch?: string;
  private?: boolean;
  description?: string | null;
}

export interface GithubTreeEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
  size?: number;
}

export interface GithubBind {
  fullName: string;
  defaultBranch: string;
  lastSyncedSha?: string | null;
}

export type RepoChangeKind = "modified" | "added" | "deleted";

export interface RepoChange {
  kind: RepoChangeKind;
  /** D-Code file name (flat). */
  name: string;
  /** Repo-relative path when it differs from the flat name (deleted files). */
  path?: string;
}

async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_PROXY}/${path}`, init);
  } catch {
    throw new GithubApiError(
      "Could not reach the GitHub proxy — check your connection.",
      undefined,
      "network"
    );
  }
  if (!res.ok) {
    let message = `GitHub API returned HTTP ${res.status}.`;
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === "string" && body.message) {
        message = body.message;
      }
    } catch {
      // Keep the generic message.
    }
    if (res.status === 401) {
      throw new GithubApiError(
        "GitHub connection expired — reconnect GitHub to continue.",
        401,
        "auth"
      );
    }
    if (res.status === 403 && /rate limit|secondary rate/i.test(message)) {
      throw new GithubApiError(
        "GitHub rate limit reached — wait a moment and try again.",
        403,
        "rate"
      );
    }
    throw new GithubApiError(message, res.status);
  }
  return res;
}

async function githubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await githubFetch(path, init);
  return (await res.json()) as T;
}

/** Repos the signed-in user can push to (owner + collaborator). */
export async function listUserRepos(): Promise<GithubRepoInfo[]> {
  const data = await githubJson<GithubRepoInfo[]>(
    "user/repos?sort=updated&per_page=50&affiliation=owner,collaborator"
  );
  return Array.isArray(data) ? data : [];
}

/** Branch names of a repo (default first). */
export async function listBranches(
  owner: string,
  repo: string
): Promise<string[]> {
  const data = await githubJson<Array<{ name: string }>>(
    `repos/${owner}/${repo}/branches?per_page=100`
  );
  return Array.isArray(data) ? data.map((b) => b.name) : [];
}

/** Current commit sha of a branch. */
export async function getBranchHead(
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const data = await githubJson<{ commit?: { sha?: string } }>(
    `repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
  );
  const sha = data?.commit?.sha;
  if (!sha) throw new GithubApiError("Could not resolve the branch head.");
  return sha;
}

/** Recursive git tree of a ref (the "last known GitHub state"). */
export async function getRepoTree(
  owner: string,
  repo: string,
  ref: string
): Promise<GithubTreeEntry[]> {
  const data = await githubJson<{ tree?: GithubTreeEntry[] }>(
    `repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );
  return Array.isArray(data?.tree) ? data.tree : [];
}

/** Raw bytes of a git blob (text or binary — proxy returns base64). */
export async function getBlobBytes(
  owner: string,
  repo: string,
  sha: string
): Promise<Uint8Array> {
  const data = await githubJson<{ content?: string; encoding?: string }>(
    `repos/${owner}/${repo}/git/blobs/${sha}`
  );
  if (typeof data.content !== "string") {
    throw new GithubApiError("GitHub returned an empty blob.");
  }
  if (data.encoding === "base64") {
    const bin = atob(data.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(data.content);
}

/* ---------------------------------------------------------------------- */
/* Pull / load from GitHub                                                */
/* ---------------------------------------------------------------------- */

export interface PullResult {
  files: DCodeFile[];
  /** Files skipped (blocked paths, oversize, duplicates, binaries too big). */
  skipped: number;
  /** Binary assets imported as Base64 data URLs. */
  binaries: number;
}

const MAX_IMPORT_FILES = 120;
const MAX_BINARY_BYTES = 350 * 1024;

/**
 * Fetches a repo's contents at `ref` into D-Code files — text files as
 * UTF-8, binaries as Base64 data URLs, through the same sanitizer gates as
 * every other import path.
 */
export async function pullRepoContents(
  owner: string,
  repo: string,
  ref: string
): Promise<PullResult> {
  const tree = await getRepoTree(owner, repo, ref);
  const blobs = tree
    .filter((e) => e.type === "blob" && e.path)
    .map((e) => ({ path: e.path, size: typeof e.size === "number" ? e.size : 0 }))
    .filter(({ path }) => /^[a-zA-Z0-9_@\-\.\(\)\[\]\/]+$/.test(path))
    .slice(0, MAX_IMPORT_FILES * 2);

  let skipped = 0;
  let binaries = 0;
  const seenNames = new Set<string>();
  const files: DCodeFile[] = [];

  for (const { path, size } of blobs) {
    if (files.length >= MAX_IMPORT_FILES) break;
    const name = basenameOf(path);
    if (isBlockedPath(path) || isBlockedPath(name)) {
      skipped += 1;
      continue;
    }
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) {
      skipped += 1;
      continue;
    }

    const entry = tree.find((e) => e.path === path);
    if (!entry) continue;

    if (isBinaryPath(name)) {
      if (size && size > MAX_BINARY_BYTES) {
        skipped += 1;
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await getBlobBytes(owner, repo, entry.sha);
      } catch {
        continue;
      }
      if (bytes.length > MAX_BINARY_BYTES) {
        skipped += 1;
        continue;
      }
      seenNames.add(lower);
      binaries += 1;
      files.push({
        id: newId(),
        name,
        language: languageFromFilename(name),
        content: bytesToDataUrl(bytes, mimeForBinaryExt(extensionWithDot(name))),
      });
      continue;
    }

    let content: string;
    try {
      content = new TextDecoder().decode(await getBlobBytes(owner, repo, entry.sha));
    } catch {
      continue;
    }
    if (containsBinaryMarkers(content)) {
      skipped += 1;
      continue;
    }
    if (content.length > MAX_FILE_CONTENT_CHARS) {
      skipped += 1;
      continue;
    }
    seenNames.add(lower);
    files.push({
      id: newId(),
      name,
      language: languageFromFilename(name),
      content: cleanTextContent(content),
    });
  }

  const sanitized = sanitizeFiles(files);
  if (files.length !== sanitized.length) {
    skipped += files.length - sanitized.length;
  }
  return { files: sanitized, skipped, binaries };
}

/* ---------------------------------------------------------------------- */
/* Change model — D-Code files vs last known GitHub tree                  */
/* ---------------------------------------------------------------------- */

/** git's blob sha-1: sha1("blob <size>\0" + bytes). */
async function gitBlobSha1(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Hashes a D-Code file the way git would hash its blob. */
export async function fileGitSha(file: DCodeFile): Promise<string> {
  const bytes = isDataUrl(file.content)
    ? (() => {
        const bin = atob(dataUrlToBase64(file.content));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      })()
    : new TextEncoder().encode(file.content);
  return gitBlobSha1(bytes);
}

/**
 * Diff: current project files vs the repo tree. Files are matched by
 * basename (D-Code is a flat file list; first occurrence wins, matching
 * the importer's dedupe). Blocked paths never appear.
 */
export async function computeRepoChanges(
  files: DCodeFile[],
  tree: GithubTreeEntry[]
): Promise<RepoChange[]> {
  const byName = new Map<string, GithubTreeEntry>();
  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    if (isBlockedPath(entry.path) || isBlockedPath(basenameOf(entry.path))) continue;
    const key = basenameOf(entry.path).toLowerCase();
    if (!byName.has(key)) byName.set(key, entry);
  }

  const changes: RepoChange[] = [];
  const matched = new Set<string>();

  for (const file of files) {
    const entry = byName.get(file.name.toLowerCase());
    if (!entry) {
      changes.push({ kind: "added", name: file.name });
      continue;
    }
    matched.add(entry.sha);
    const sha = await fileGitSha(file);
    if (sha !== entry.sha) {
      changes.push({ kind: "modified", name: file.name });
    }
  }

  for (const entry of byName.values()) {
    if (!matched.has(entry.sha)) {
      changes.push({
        kind: "deleted",
        name: basenameOf(entry.path),
        path: entry.path,
      });
    }
  }

  // Deterministic order: modified, added, deleted — then by name.
  const order: Record<RepoChangeKind, number> = {
    modified: 0,
    added: 1,
    deleted: 2,
  };
  return changes.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)
  );
}

/* ---------------------------------------------------------------------- */
/* Commit & push — Git Data API                                           */
/* ---------------------------------------------------------------------- */

export interface PushResult {
  sha: string;
  url: string;
}

export interface PushOptions {
  owner: string;
  repo: string;
  branch: string;
  message: string;
  /** Files to write/overwrite (current content). */
  files: DCodeFile[];
  /** Repo-relative paths to delete. */
  deleted: string[];
}

/**
 * Creates a real commit on GitHub: blobs → tree (based on the live branch
 * tip) → commit → ref update. The committer is the token's GitHub user.
 */
export async function pushCommit(options: PushOptions): Promise<PushResult> {
  const { owner, repo, branch } = options;
  // Fresh tip at commit time — never build on a stale parent.
  const tip = await getBranchHead(owner, repo, branch);

  const treeEntries: Array<{
    path: string;
    mode: string;
    type: "blob";
    sha: string | null;
  }> = [];

  for (const file of options.files) {
    const isBinary = isDataUrl(file.content);
    const blob = await githubJson<{ sha: string }>(
      `repos/${owner}/${repo}/git/blobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isBinary
            ? { content: dataUrlToBase64(file.content), encoding: "base64" }
            : { content: file.content, encoding: "utf-8" }
        ),
      }
    );
    if (!blob.sha) throw new GithubApiError("GitHub did not return a blob sha.");
    treeEntries.push({ path: file.name, mode: "100644", type: "blob", sha: blob.sha });
  }

  for (const path of options.deleted) {
    treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  const tree = await githubJson<{ sha: string }>(
    `repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: tip, tree: treeEntries }),
    }
  );
  if (!tree.sha) throw new GithubApiError("GitHub did not return a tree sha.");

  const commit = await githubJson<{ sha: string }>(
    `repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: options.message,
        tree: tree.sha,
        parents: [tip],
      }),
    }
  );
  if (!commit.sha) throw new GithubApiError("GitHub did not return a commit sha.");

  await githubFetch(`repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return {
    sha: commit.sha,
    url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
  };
}
