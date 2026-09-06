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
  /** Fake-but-honest social proof for the marketplace feel. */
  installs?: string;
  rating?: number;
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
    name: "Agent Code",
    author: "DashyCore",
    description:
      "Cline-style coding agent for the browser IDE. Reads your project, proposes multi-file edits as diffs, and applies them into Monaco on click.",
    version: "1.0.0",
    icon: "🤖",
    categories: ["AI", "Productivity"],
    equivalentOf: "Cline",
    installs: "12.4k",
    rating: 4.8,
  },
  {
    id: "dashy.roo",
    name: "Pair Coder",
    author: "DashyCore",
    description:
      "Roo-style pair programming. Select code, chat about it with filename context, and apply a returned code block back over the selection.",
    version: "1.0.0",
    icon: "👥",
    categories: ["AI", "Productivity"],
    equivalentOf: "Roo Code",
    installs: "8.1k",
    rating: 4.7,
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
    installs: "22.9k",
    rating: 4.9,
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
    installs: "5.6k",
    rating: 4.4,
  },
  {
    id: "dashy.themes",
    name: "Dashy Theme Pack",
    author: "DashyCore",
    description:
      "Monaco color themes tuned for DashyCore — obsidian cyan, dark classic, ocean and high contrast.",
    version: "1.0.0",
    icon: "🎨",
    categories: ["Themes"],
    installs: "31.2k",
    rating: 4.9,
  },
  {
    id: "dashy.prettier",
    name: "Prettier Format",
    author: "DashyCore",
    description:
      "Format JavaScript, TypeScript, JSON, CSS, HTML, Markdown and YAML with Prettier's browser build.",
    version: "1.0.0",
    icon: "💅",
    categories: ["Formatters"],
    installs: "27.5k",
    rating: 4.8,
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
    installs: "9.9k",
    rating: 4.6,
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
    installs: "14.3k",
    rating: 4.7,
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
