/**
 * DashyCore v7 — lightweight shared UI preferences.
 *
 * The selected model is a workspace-wide preference: the header dropdown
 * writes it, the chat composer reads it, and every component updates live
 * through a custom DOM event. Backed by localStorage.
 *
 * The sidebar collapse preference uses the exact same pattern so the
 * workspace shell stays in sync across routes without a new persistence
 * layer.
 */

import { DEFAULT_MODEL_ID, MODELS } from "@/lib/models";

const MODEL_KEY = "dashycore:model";
export const MODEL_CHANGED_EVENT = "dashy:model-changed";

export function getStoredModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID;
  try {
    const stored = window.localStorage.getItem(MODEL_KEY);
    if (stored && MODELS.some((model) => model.id === stored)) {
      return stored;
    }
  } catch {
    // Storage unavailable — fall back to default.
  }
  return DEFAULT_MODEL_ID;
}

export function setStoredModel(id: string): void {
  if (!MODELS.some((model) => model.id === id)) return;
  try {
    window.localStorage.setItem(MODEL_KEY, id);
  } catch {
    // Storage unavailable — preference is session-only.
  }
  window.dispatchEvent(new CustomEvent(MODEL_CHANGED_EVENT, { detail: { model: id } }));
}

/* ---------------------------------------------------------------------- */
/* Sidebar collapse                                                        */
/* ---------------------------------------------------------------------- */

const SIDEBAR_KEY = "dashycore:sidebar-collapsed";
export const SIDEBAR_CHANGED_EVENT = "dashy:sidebar-changed";

/** True once the user has expressed a sidebar preference explicitly. */
export function hasStoredSidebarPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== null;
  } catch {
    return false;
  }
}

/** Reads the persisted desktop sidebar state (false = expanded). */
export function getStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStoredSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage unavailable — preference is session-only.
  }
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_CHANGED_EVENT, { detail: { collapsed } })
  );
}
