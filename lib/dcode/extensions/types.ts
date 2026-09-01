/**
 * DashyCore v7 — Dashy Extensions: shared type contracts.
 *
 * Dashy Extensions are the CURATED, web-safe extension format for D-Code.
 * They are NOT VS Code .vsix packages and there is no Microsoft Marketplace
 * integration. v1 ships a code-first built-in registry
 * (lib/dcode/extensions/registry.ts) with first-party extensions; a
 * community marketplace table is explicitly out of scope.
 *
 * An extension is a plain module exporting a manifest plus
 * activate(context)/deactivate() — the same lifecycle idea as VS Code,
 * but the entire runtime is in-process JS that we control:
 *
 *   - no arbitrary host access (no shell, no file system)
 *   - everything an extension can do goes through ExtensionContext
 *   - a crash in activate() is caught and never takes the IDE down
 */

import type { DCodeFile } from "@/lib/dcode";

/** A command contributed by an extension (shown in the Command Palette). */
export interface ExtensionCommandContribution {
  id: string;
  title: string;
  category?: string;
}

/** A Monaco color theme contributed by an extension. */
export interface ExtensionThemeContribution {
  /** Monaco theme id (defined via monaco.editor.defineTheme). */
  id: string;
  /** Human-readable label ("Dashy Obsidian"). */
  label: string;
}

export interface ExtensionContributes {
  commands?: ExtensionCommandContribution[];
  themes?: ExtensionThemeContribution[];
}

export interface ExtensionManifest {
  /** Stable unique id, namespaced, e.g. "dashy.prettier". */
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  categories?: string[];
  contributes?: ExtensionContributes;
  /** e.g. ["*"] — reserved for future lazy activation. */
  activationEvents?: string[];
}

/** One item in an in-IDE quick pick (themes, toggles, …). */
export interface QuickPickItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}

/**
 * The D-Code workspace surface handed to extensions. Every method is a
 * wrapper over the real workspace state — extensions never touch React or
 * Supabase directly.
 */
export interface DCodeWorkspaceApi {
  /** Currently open file, or null in an empty workspace. */
  getActiveFile(): DCodeFile | null;
  /** All project files (text + Base64 binary assets). */
  getFiles(): DCodeFile[];
  /** The Monaco selection text of the active file, or null. */
  getSelectedText(): string | null;
  /** Opens a file by its D-Code id (tab switch). */
  openFile(fileId: string): void;
  /** Applies a contributed Monaco theme and persists the preference. */
  applyTheme(themeId: string): void;
  /** Formats the active file (Prettier). Resolves true when it ran. */
  formatActiveFile(): Promise<boolean>;
  /** Resolves the signed-in Supabase user id (null when signed out). */
  getUserId(): Promise<string | null>;
  /** Opens (or resets) the DashyAI output drawer with a title. */
  showAiOutput(title: string): void;
  /** Appends streaming text to the DashyAI output drawer. */
  appendAiOutput(text: string): void;
  /** Marks the DashyAI output drawer as finished (stops the spinner). */
  finishAiOutput(): void;
  /** Flushes the active buffer through the existing save helper. */
  saveActiveFile(): Promise<void>;
}

/** UI affordances the host provides to extensions. */
export interface DCodeExtensionUi {
  /**
   * Modal quick pick (keyboard-first). Resolves with the picked item, or
   * null when dismissed.
   */
  showQuickPick<T extends QuickPickItem>(
    items: T[],
    title?: string
  ): Promise<T | null>;
  /** Small info toast. */
  notify(message: string): void;
}

/** Per-extension persisted storage (namespaced localStorage). */
export interface ExtensionStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface ExtensionContext {
  extensionId: string;
  manifest: ExtensionManifest;
  /** Registers a command in the central registry (palette picks it up). */
  registerCommand(
    id: string,
    def: {
      title: string;
      category?: string;
      handler: () => void | Promise<void>;
    }
  ): void;
  workspace: DCodeWorkspaceApi;
  ui: DCodeExtensionUi;
  storage: ExtensionStorage;
}

export interface ExtensionModule {
  manifest: ExtensionManifest;
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
