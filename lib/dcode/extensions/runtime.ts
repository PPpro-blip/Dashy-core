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

import { BUILTIN_EXTENSIONS, DEFAULT_DISABLED_IDS } from "./registry";
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
  /** Opens a host-provided side view by id (agent-code, pair-coder, …). */
  showView(viewId: string): void;
}

const activeModules = new Map<string, ExtensionModule>();
/** Per-session view of enabled ids (kept in sync with storage). */
let enabledIdsCache: string[] | null = null;

function enabledIds(): string[] {
  if (!enabledIdsCache) {
    enabledIdsCache = getEnabledExtensionIds(
      BUILTIN_EXTENSIONS.map((m) => m.manifest.id),
      DEFAULT_DISABLED_IDS
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
    getEnabled: () => getEnabledExtensionIdsCached(),
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
 * Extensions whose activate() registers Monaco providers (completion
 * providers, ghost-text completions). Monaco mounts asynchronously (CDN
 * loader) and remounts per tab switch, so these may have been enabled while
 * no editor instance existed — getMonaco() was null and they registered
 * nothing. Re-running activate once a real editor is ready fixes
 * "enabled but does nothing".
 */
const MONACO_PROVIDER_EXTENSION_IDS = ["dashy.snippets", "dashy.autocomplete"];

/**
 * Called from the workspace every time a Monaco editor instance becomes
 * ready: (re)activates the enabled Monaco-provider extensions against the
 * live instance. Idempotent, per-extension failure-isolated.
 */
export async function onMonacoEditorReady(
  workspace: DCodeWorkspaceApi,
  ui: DCodeExtensionUiApi
): Promise<void> {
  for (const id of MONACO_PROVIDER_EXTENSION_IDS) {
    try {
      if (!enabledIds().includes(id)) continue;
      const mod = BUILTIN_EXTENSIONS.find((m) => m.manifest.id === id);
      if (!mod) continue;
      if (activeModules.has(id)) {
        // Clean teardown first so the provider never registers twice.
        try {
          await mod.deactivate?.();
        } catch (error) {
          console.error(`[dcode] extension ${id} failed to deactivate`, error);
        }
        activeModules.delete(id);
      }
      await activateOne(mod, workspace, ui);
    } catch (error) {
      console.error(`[dcode] re-activating ${id} on editor ready failed`, error);
    }
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
  // Pass the full registry so the stored enabled set is seeded from the
  // CURRENT defaults when the user toggles before any preference exists —
  // one toggle must never flip the state of every other built-in.
  setExtensionEnabledState(
    id,
    enabled,
    BUILTIN_EXTENSIONS.map((m) => m.manifest.id),
    DEFAULT_DISABLED_IDS
  );
  enabledIdsCache = getEnabledExtensionIds(
    BUILTIN_EXTENSIONS.map((m) => m.manifest.id),
    DEFAULT_DISABLED_IDS
  );
  if (enabled) {
    await activateOne(mod, workspace, ui);
  } else {
    await deactivateOne(mod);
  }
}
