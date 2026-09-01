/**
 * DashyCore v7 — Dashy Extensions runtime: command registry + host.
 *
 * The command registry is the single source of truth for the Command
 * Palette: core D-Code commands AND extension commands all live here, and
 * the palette re-reads it whenever a "commands changed" event fires.
 *
 * The host manages the extension lifecycle: activate() on D-Code mount for
 * every enabled built-in, deactivate() + command unregistration on disable,
 * and try/catch isolation so one broken extension never crashes the IDE.
 */

import { BUILTIN_EXTENSIONS } from "./registry";
import {
  extensionStorageGet,
  extensionStorageSet,
  getEnabledExtensionIds,
  setExtensionEnabledState,
} from "./storage";
import type {
  DCodeWorkspaceApi,
  ExtensionContext,
  ExtensionModule,
  QuickPickItem,
} from "./types";

/** Fired on window when the registry contents change. */
export const COMMANDS_CHANGED_EVENT = "dashy:dcode-commands-changed";

export interface CommandDefinition {
  id: string;
  title: string;
  category?: string;
  handler: () => void | Promise<void>;
}

class CommandRegistryImpl {
  private commands = new Map<string, CommandDefinition>();

  register(def: CommandDefinition): void {
    this.commands.set(def.id, def);
    this.emit();
  }

  unregister(id: string): void {
    if (this.commands.delete(id)) this.emit();
  }

  /** Removes every command whose id starts with `prefix` (extension teardown). */
  unregisterByPrefix(prefix: string): void {
    let changed = false;
    for (const id of [...this.commands.keys()]) {
      if (id.startsWith(prefix)) {
        this.commands.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  getAll(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  get(id: string): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  /** Runs a command handler. Errors are isolated — the palette stays alive. */
  execute(id: string): Promise<void> {
    const command = this.commands.get(id);
    if (!command) return Promise.resolve();
    try {
      return Promise.resolve(command.handler());
    } catch (error) {
      console.error(`[dcode] command ${id} failed`, error);
      return Promise.resolve();
    }
  }

  private emit(): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(COMMANDS_CHANGED_EVENT));
    }
  }
}

/** Shared registry — the workspace registers core + extension commands. */
export const commandRegistry = new CommandRegistryImpl();

/* --------------------------- extension host --------------------------- */

export interface DCodeExtensionUiApi {
  showQuickPick<T extends QuickPickItem>(
    items: T[],
    title?: string
  ): Promise<T | null>;
  notify(message: string): void;
}

const activeModules = new Map<string, ExtensionModule>();
/** Per-session view of enabled ids (kept in sync with storage). */
let enabledIdsCache: string[] | null = null;

function enabledIds(): string[] {
  if (!enabledIdsCache) {
    enabledIdsCache = getEnabledExtensionIds(
      BUILTIN_EXTENSIONS.map((m) => m.manifest.id)
    );
  }
  return enabledIdsCache;
}

export function getEnabledExtensionIdsCached(): string[] {
  return [...enabledIds()];
}

function buildContext(
  mod: ExtensionModule,
  workspace: DCodeWorkspaceApi,
  ui: DCodeExtensionUiApi
): ExtensionContext {
  const extId = mod.manifest.id;
  return {
    extensionId: extId,
    manifest: mod.manifest,
    registerCommand(id, def) {
      commandRegistry.register({ id, title: def.title, category: def.category, handler: def.handler });
    },
    workspace,
    ui,
    storage: {
      get: (key) => extensionStorageGet(extId, key),
      set: (key, value) => extensionStorageSet(extId, key, value),
    },
  };
}

async function activateOne(
  mod: ExtensionModule,
  workspace: DCodeWorkspaceApi,
  ui: DCodeExtensionUiApi
): Promise<void> {
  if (activeModules.has(mod.manifest.id)) return;
  try {
    await mod.activate(buildContext(mod, workspace, ui));
    activeModules.set(mod.manifest.id, mod);
  } catch (error) {
    // One broken extension must never take the IDE down.
    console.error(`[dcode] extension ${mod.manifest.id} failed to activate`, error);
  }
}

async function deactivateOne(mod: ExtensionModule): Promise<void> {
  if (!activeModules.has(mod.manifest.id)) return;
  try {
    await mod.deactivate?.();
  } catch (error) {
    console.error(`[dcode] extension ${mod.manifest.id} failed to deactivate`, error);
  }
  activeModules.delete(mod.manifest.id);
  // Teardown: every command contributed by this extension disappears.
  for (const cmd of mod.manifest.contributes?.commands ?? []) {
    commandRegistry.unregister(cmd.id);
  }
}

/** Activates every enabled built-in (call once on D-Code mount). */
export async function activateEnabledExtensions(
  workspace: DCodeWorkspaceApi,
  ui: DCodeExtensionUiApi
): Promise<void> {
  for (const mod of BUILTIN_EXTENSIONS) {
    if (enabledIds().includes(mod.manifest.id)) {
      await activateOne(mod, workspace, ui);
    }
  }
}

/** Deactivates all active extensions (D-Code unmount / read-only). */
export async function deactivateAllExtensions(): Promise<void> {
  for (const mod of [...activeModules.values()]) {
    await deactivateOne(mod);
  }
}

/**
 * Enables or disables an extension, live. Persists the preference and
 * activates/deactivates + (un)registers its commands immediately, so the
 * palette reflects the change without a reload.
 */
export async function setExtensionEnabled(
  id: string,
  enabled: boolean,
  workspace: DCodeWorkspaceApi,
  ui: DCodeExtensionUiApi
): Promise<void> {
  const mod = BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id);
  if (!mod) return;
  setExtensionEnabledState(id, enabled);
  enabledIdsCache = getEnabledExtensionIds(
    BUILTIN_EXTENSIONS.map((m) => m.manifest.id)
  );
  if (enabled) {
    await activateOne(mod, workspace, ui);
  } else {
    await deactivateOne(mod);
  }
}
