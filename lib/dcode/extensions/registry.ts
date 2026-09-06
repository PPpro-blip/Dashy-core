/**
 * DashyCore v7 — Dashy Extensions: built-in registry.
 *
 * Code-first: every first-party extension ships in-repo as a plain JS module
 * and is always available to enable/disable. There is deliberately NO .vsix
 * install and no Microsoft Marketplace / Open VSX integration — a real .vsix
 * is a Node/desktop artifact that cannot run inside a browser tab. Instead we
 * ship web-native equivalents (Agent Code ≈ Cline, Pair Coder ≈ Roo).
 *
 * The "Discover" catalog (lib/dcode/extensions/catalog.ts) is the marketplace
 * UX; every catalog entry maps 1:1 onto a module here so Install = enable.
 */

import { aiExtension } from "./builtins/ai";
import { autocompleteExtension } from "./builtins/autocomplete";
import { clineExtension } from "./builtins/cline";
import { markdownPreviewExtension } from "./builtins/markdown-preview";
import { prettierExtension } from "./builtins/prettier";
import { rooExtension } from "./builtins/roo";
import { snippetsExtension } from "./builtins/snippets";
import { themesExtension } from "./builtins/themes";
import type { ExtensionModule } from "./types";

/** All built-in extensions, in display order. */
export const BUILTIN_EXTENSIONS: ExtensionModule[] = [
  themesExtension,
  prettierExtension,
  aiExtension,
  clineExtension,
  rooExtension,
  autocompleteExtension,
  snippetsExtension,
  markdownPreviewExtension,
];

/**
 * Ids that ship DISABLED by default even for a first-run user. Everything
 * else defaults to enabled. Ghost Suggestions is opt-in because it makes a
 * network call on every keystroke pause.
 */
export const DEFAULT_DISABLED_IDS: string[] = ["dashy.autocomplete"];

export function builtinExtensionById(
  id: string
): ExtensionModule | undefined {
  return BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id);
}
