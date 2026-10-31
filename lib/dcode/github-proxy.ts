const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Normalize only explicitly approved GitHub API operations. Never accepts arbitrary proxy paths. */
export function approvedGithubPath(method: string, rawPath: string): { path: string } | null {
  if (/%(?:2f|5c|25)/i.test(rawPath) || rawPath.includes("\\") || rawPath.startsWith("/")) return null;
  let segments: string[];
  try {
    segments = rawPath.split("/").map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (segments.some((part) => !part || part === "." || part === ".." || !SEGMENT.test(part))) return null;
  if (method.toUpperCase() !== "GET") return null;
  const s = segments;
  let valid = false;

  if (s.length === 2 && s[0] === "user" && s[1] === "repos") valid = true;
  if (s.length === 3 && s[0] === "repos") valid = true;
  if (s.length === 4 && s[0] === "repos" && s[3] === "commits") valid = true;
  if (s.length === 6 && s[0] === "repos" && s[3] === "git" && ["trees", "blobs"].includes(s[4])) valid = true;
  if (!valid) return null;

  return { path: s.map(encodeURIComponent).join("/") };
}

/** Keeps query strings operation-specific and rejects duplicates/unknown keys. */
export function approvedGithubQuery(path: string, params: URLSearchParams): Record<string, string> | null {
  const allowed = path === "user/repos"
    ? new Set(["sort", "per_page", "page", "affiliation"])
    : path.endsWith("/branches")
      ? new Set(["per_page", "page"])
      : path.endsWith("/commits")
        ? new Set(["sha", "per_page", "page"])
      : path.includes("/git/trees/")
        ? new Set(["recursive"])
        : new Set<string>();
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!allowed.has(key) || Object.hasOwn(out, key) || value.length > 100) return null;
    out[key] = value;
  }
  if (out.per_page && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(out.per_page)) return null;
  if (out.page && !/^[1-9][0-9]{0,4}$/.test(out.page)) return null;
  if (out.recursive && out.recursive !== "1") return null;
  if (out.sha && (out.sha.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(out.sha) || out.sha.includes(".."))) return null;
  if (out.sort && !["created", "updated", "pushed", "full_name"].includes(out.sort)) return null;
  if (out.affiliation && !/^(?:owner|collaborator|organization)(?:,(?:owner|collaborator|organization))*$/.test(out.affiliation)) return null;
  return out;
}
