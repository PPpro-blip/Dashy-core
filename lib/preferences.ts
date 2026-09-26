/**
 * DashyCore v7 — lightweight shared UI preferences.
 *
 * The selected model is a workspace-wide preference: the header dropdown
 * writes it, the chat composer reads it, and every component updates live
 * through a custom DOM event. Backed by localStorage.
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
/* Agent Mode                                                              */
/* ---------------------------------------------------------------------- */

const AGENT_MODE_KEY = "dashycore:agent-mode";
export const AGENT_MODE_CHANGED_EVENT = "dashy:agent-mode-changed";

/**
 * Agent Mode is a workspace-wide preference (like the model): the chat
 * composer toggles it, and any other surface that sends chat requests reads
 * the same flag so one conversation never mixes modes by accident.
 */
export function getStoredAgentMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AGENT_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStoredAgentMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(AGENT_MODE_KEY, "1");
    else window.localStorage.removeItem(AGENT_MODE_KEY);
  } catch {
    // Storage unavailable — the toggle stays session-only.
  }
  window.dispatchEvent(
    new CustomEvent(AGENT_MODE_CHANGED_EVENT, { detail: { agentMode: enabled } })
  );
}
