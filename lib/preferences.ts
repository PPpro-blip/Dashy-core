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
