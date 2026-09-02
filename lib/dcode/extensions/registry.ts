/**
 * DashyCore v7 — Dashy Extensions: built-in registry.
 *
 * v1 is code-first: the three first-party extensions ship in-repo and are
 * always available to enable/disable. There is deliberately NO marketplace
 * table, no .vsix install and no Microsoft Marketplace scraping — a
 * community marketplace is a later, separate product decision.
 */

import { aiExtension } from "./builtins/ai";
import { prettierExtension } from "./builtins/prettier";
import { themesExtension } from "./builtins/themes";
import type { ExtensionModule } from "./types";

/** All built-in extensions, in display order. */
export const BUILTIN_EXTENSIONS: ExtensionModule[] = [
  themesExtension,
  prettierExtension,
  aiExtension,
];

export function builtinExtensionById(
  id: string
): ExtensionModule | undefined {
  return BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id);
}
