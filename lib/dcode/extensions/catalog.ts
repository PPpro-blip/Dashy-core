/**
 * DashyCore v7 — Dashy Extensions: Discover catalog (curated marketplace UX).
 *
 * This is the "third-party feel" browse surface. Every entry maps 1:1 onto a
 * built-in module id (lib/dcode/extensions/registry.ts) so that clicking
 * Install simply ENABLES the extension and registers its commands live — no
 * download, no .vsix, no remote code execution.
 *
 * Honesty rule: we do NOT list real desktop-only extensions (Cline, Roo,
 * arbitrary .vsix) as installable, because they cannot run in a browser tab.
 * We ship web-native equivalents (Agent Code ≈ Cline, Pair Coder ≈ Roo) and
 * say so plainly in the UI banner.
 *
 * A remote catalog can be layered on later via NEXT_PUBLIC_DCODE_CATALOG_URL
 * (see getRemoteCatalogUrl); the local catalog is authoritative today.
 */

export type CatalogCategory =
  | "AI"
  | "Themes"
  | "Formatters"
  | "Productivity"
  | "Language";

export interface CatalogEntry {
  /** Must equal a BUILTIN_EXTENSIONS manifest id — Install = enable this. */
  id: string;
  name: string;
  /** Short publisher label shown on the card. */
  author: string;
  description: string;
  version: string;
  icon: string;
  categories: CatalogCategory[];
  /** Whether this card presents as a web-native equivalent of a desktop ext. */
  equivalentOf?: string;
}

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  "AI",
  "Themes",
  "Formatters",
  "Productivity",
  "Language",
];

export const DISCOVER_CATALOG: CatalogEntry[] = [
  {
    id: "dashy.cline",
    name: "Dashy Cline Assist",
    author: "DashyCore",
    description:
      "Autonomous coding assistant mode (Web-safe). Reads your project, proposes multi-file edits as diffs, and applies them into Monaco on click.",
    version: "1.0.0",
    icon: "🤖",
    categories: ["AI", "Productivity"],
  },
  {
    id: "dashy.roo",
    name: "Dashy Roo Code",
    author: "DashyCore",
    description:
      "Architect & context builder for multi-file edits. Select code, chat about it with filename context, and apply a returned code block back over the selection.",
    version: "1.0.0",
    icon: "𝚯",
    categories: ["AI", "Productivity"],
  },
  {
    id: "dashy.tailwind",
    name: "Tailwind Class IntelliSense",
    author: "DashyCore",
    description:
      "Live CSS utility helper & previewer. Utility completions inside class attributes plus one-click Tailwind Play CDN injection for HTML files.",
    version: "1.0.0",
    icon: "🎨",
    categories: ["Language", "Productivity"],
  },
  {
    id: "dashy.gitlens",
    name: "Git Lens Preview",
    author: "DashyCore",
    description:
      "Line history & diff inspector. Inspect the active line (file · line · selection) and copy review-ready line permalinks.",
    version: "1.0.0",
    icon: "🔍",
    categories: ["Productivity"],
  },
  {
    id: "dashy.ai",
    name: "DashyAI",
    author: "DashyCore",
    description:
      "Explain the current file or refactor a selection with DashyAI — the same model router as Dashy chat.",
    version: "1.0.0",
    icon: "🧠",
    categories: ["AI"],
  },
  {
    id: "dashy.autocomplete",
    name: "Ghost Suggestions",
    author: "DashyCore",
    description:
      "Optional AI inline completions (ghost text) for Monaco. Debounced, one suggestion at a time, off until you install it.",
    version: "1.0.0",
    icon: "✨",
    categories: ["AI", "Productivity"],
  },
  {
    id: "dashy.themes",
    name: "Dashy Theme Pack",
    author: "DashyCore",
    description:
      "Monaco color themes tuned for DashyCore — obsidian cyan, dark classic, ocean and high contrast.",
    version: "1.0.0",
    icon: "🌈",
    categories: ["Themes"],
  },
  {
    id: "dashy.prettier",
    name: "Prettier Auto-Formatter",
    author: "DashyCore",
    description:
      "Code beautifier on save. Format JavaScript, TypeScript, JSON, CSS, HTML, Markdown and YAML with Prettier's browser build.",
    version: "1.0.0",
    icon: "🧹",
    categories: ["Formatters"],
  },
  {
    id: "dashy.snippets",
    name: "TS / React Snippets",
    author: "DashyCore",
    description:
      "Handy TypeScript & React snippets (rfc, useState, useEffect, clg, tryc…) as Monaco completions with tab stops.",
    version: "1.0.0",
    icon: "🧩",
    categories: ["Productivity", "Language"],
  },
  {
    id: "dashy.markdown-preview",
    name: "Markdown Preview",
    author: "DashyCore",
    description:
      "Preview the active Markdown file in a side panel with GitHub-flavored rendering.",
    version: "1.0.0",
    icon: "📄",
    categories: ["Productivity", "Language"],
  },
];

/** Optional remote catalog URL (env). Local catalog is used when unset. */
export function getRemoteCatalogUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_DCODE_CATALOG_URL;
  return url && url.trim() ? url.trim() : null;
}

export function catalogEntryById(id: string): CatalogEntry | undefined {
  return DISCOVER_CATALOG.find((e) => e.id === id);
}
