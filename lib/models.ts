/**
 * DashyCore v7 — canonical model registry (old peak Dashy naming).
 *
 * Header dropdown, chat page and settings all read from this single source
 * so the DASH-* labels stay consistent across the workspace.
 */

import type { ComponentType } from "react";
import { BrainIcon, SparklesIcon, ZapIcon } from "@/components/icons";

export interface DashyModel {
  id: string;
  /** Display name shown in the UI (old peak DASH- style). */
  label: string;
  description: string;
  /** Accent color used for icons / dots. */
  accent: string;
  badge?: string;
  Icon: ComponentType<{ className?: string }>;
}

export const MODELS: DashyModel[] = [
  {
    id: "dashy-complexity",
    label: "DASH-Complexity",
    description: "Best for reasoning, coding, and large context tasks.",
    accent: "#a78bfa",
    Icon: BrainIcon,
  },
  {
    id: "dashy-allround",
    label: "DASH-Allround",
    description: "Balanced general assistant for everyday tasks.",
    accent: "#22d3ee",
    badge: "Default",
    Icon: SparklesIcon,
  },
  {
    id: "dashy-superfast",
    label: "DASH-Superfast",
    description: "Instant answers with the lowest latency.",
    accent: "#34d399",
    Icon: ZapIcon,
  },
];

export const DEFAULT_MODEL_ID = "dashy-allround";

export function getModelById(id: string | null | undefined): DashyModel {
  return (
    MODELS.find((model) => model.id === id) ??
    MODELS.find((model) => model.id === DEFAULT_MODEL_ID) ??
    MODELS[0]
  );
}
