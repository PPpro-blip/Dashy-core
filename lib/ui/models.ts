/**
 * DashyCore v7 — DASH model definitions.
 *
 * These are the REAL model IDs used by the DASH routing layer.
 * Friendly names are display-only; the raw IDs are what get sent
 * to the backend.
 */

export type DashyModelId = "dashy-complexity" | "dashy-allround" | "dashy-superfast";

export interface DashyModel {
  id: DashyModelId;
  name: string;
  description: string;
  /** Whether this model shows the richer thinking-state UI. */
  showsThinking: boolean;
}

export const DASHY_MODELS: DashyModel[] = [
  {
    id: "dashy-complexity",
    name: "DASHY Complexity",
    description: "Deep reasoning · thorough analysis",
    showsThinking: true,
  },
  {
    id: "dashy-allround",
    name: "DASHY AllRound",
    description: "Balanced · everyday tasks",
    showsThinking: false,
  },
  {
    id: "dashy-superfast",
    name: "DASHY SuperFast",
    description: "Lightning fast · quick answers",
    showsThinking: false,
  },
];

export const DEFAULT_MODEL: DashyModelId = "dashy-allround";

export function getModel(id: DashyModelId): DashyModel {
  return DASHY_MODELS.find((m) => m.id === id) ?? DASHY_MODELS[1];
}