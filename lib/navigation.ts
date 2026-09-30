/**
 * DashyCore v7 — canonical workspace navigation model.
 *
 * ONE source of truth for the sidebar. Every product surface appears here
 * exactly once; contextual entry points elsewhere in the app reuse the same
 * destination instead of adding a second navigation path.
 *
 *   DashyCore
 *     ├── Chat            /chat
 *     ├── D-Code          /d-code            (group)
 *     │     ├── Editor    /d-code
 *     │     ├── Projects  /projects
 *     │     └── Analytics /d-code/analytics
 *     ├── Studio          /studio            (group)
 *     │     ├── Generate  /studio
 *     │     └── Library   /studio/library
 *     ├── Share Hub       /share
 *     ├── Knowledge       /knowledge
 *     ├── Memory          /settings#memory
 *     └── Agents          /agents
 *
 *   ── footer ──
 *     Settings            /settings
 *     Account             (sidebar profile card)
 *
 * Voice is intentionally absent: it is a capability reached from the chat
 * composer (/voice stays a working route), not a primary destination.
 */

import type { ComponentType } from "react";
import {
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  ChartIcon,
  CodeIcon,
  FolderIcon,
  ImageIcon,
  MessageIcon,
  PenIcon,
  ShareIcon,
  SparklesIcon,
} from "@/components/icons";

export interface NavChild {
  id: string;
  label: string;
  href: string;
  Icon: ComponentType<{ className?: string }>;
  /** Extra path prefixes that should mark this child active. */
  match?: string[];
  exact?: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  Icon: ComponentType<{ className?: string }>;
  /** Short description used by tooltips when the sidebar is collapsed. */
  hint?: string;
  match?: string[];
  exact?: boolean;
  children?: NavChild[];
}

export const PRIMARY_NAV: NavItem[] = [
  {
    id: "chat",
    label: "Chat",
    href: "/chat",
    Icon: MessageIcon,
    hint: "Talk to Dashy",
    match: ["/chat", "/voice"],
  },
  {
    id: "d-code",
    label: "D-Code",
    href: "/d-code",
    Icon: CodeIcon,
    hint: "Code workspace",
    match: ["/d-code", "/projects"],
    children: [
      { id: "d-code-editor", label: "Editor", href: "/d-code", Icon: PenIcon, exact: true },
      { id: "d-code-projects", label: "Projects", href: "/projects", Icon: FolderIcon },
      {
        id: "d-code-analytics",
        label: "Analytics",
        href: "/d-code/analytics",
        Icon: ChartIcon,
      },
    ],
  },
  {
    id: "studio",
    label: "Studio",
    href: "/studio",
    Icon: SparklesIcon,
    hint: "Generate visuals",
    match: ["/studio"],
    children: [
      { id: "studio-generate", label: "Generate", href: "/studio", Icon: SparklesIcon, exact: true },
      { id: "studio-library", label: "Library", href: "/studio/library", Icon: ImageIcon },
    ],
  },
  {
    id: "share",
    label: "Share Hub",
    href: "/share",
    Icon: ShareIcon,
    hint: "Publish your work",
    match: ["/share"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    href: "/knowledge",
    Icon: BookOpenIcon,
    hint: "Indexed documents",
    match: ["/knowledge"],
  },
  {
    id: "memory",
    label: "Memory",
    href: "/settings#memory",
    Icon: BrainIcon,
    hint: "What Dashy remembers",
  },
  {
    id: "agents",
    label: "Agents",
    href: "/agents",
    Icon: BotIcon,
    hint: "Agent Mode",
    match: ["/agents"],
  },
];

/**
 * Active-state resolver.
 *
 * `hash` is only meaningful for Memory vs Settings, which share /settings.
 */
export function isNavActive(
  item: { href: string; match?: string[]; exact?: boolean },
  pathname: string,
  hash = ""
): boolean {
  const [path, itemHash] = item.href.split("#");
  if (itemHash) {
    return pathname === path && hash.replace("#", "") === itemHash;
  }
  // /settings is only "active" without a hash so Memory and Settings never
  // both light up.
  if (path === "/settings" && hash) return false;

  if (item.exact) return pathname === path;
  const prefixes = item.match ?? [path];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
