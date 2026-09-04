/**
 * DashyCore v7 — Dashy Extensions: public barrel.
 *
 * One import site for the extension system. The honest banner copy lives here
 * so the ExtensionsPanel and any docs share one wording.
 */

export const EXTENSIONS_HONEST_BANNER =
  "Web-safe Dashy Extensions. Desktop-only VS Code extensions (Cline, Roo, .vsix) cannot run in the browser — we ship native equivalents below.";

export { BUILTIN_EXTENSIONS, DEFAULT_DISABLED_IDS, builtinExtensionById } from "./registry";
export {
  DISCOVER_CATALOG,
  CATALOG_CATEGORIES,
  catalogEntryById,
  getRemoteCatalogUrl,
  type CatalogEntry,
  type CatalogCategory,
} from "./catalog";
export {
  commandRegistry,
  activateEnabledExtensions,
  deactivateAllExtensions,
  setExtensionEnabled,
  getEnabledExtensionIdsCached,
  COMMANDS_CHANGED_EVENT,
  type CommandDefinition,
  type DCodeExtensionUiApi,
} from "./runtime";
export type {
  ExtensionManifest,
  ExtensionModule,
  ExtensionContext,
  DCodeWorkspaceApi,
  QuickPickItem,
} from "./types";
