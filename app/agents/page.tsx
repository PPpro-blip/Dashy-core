"use client";

/**
 * DashyCore v7 — Agents (real route, feature under construction).
 * Agents will be custom assistants with their own tools, memory and
 * instructions. Placeholder until then — no fake functionality.
 */

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { BotIcon } from "@/components/icons";

export default function AgentsPage() {
  return (
    <PlaceholderPage
      Icon={BotIcon}
      title="Agents"
      tagline="Custom assistants with tools and standing instructions."
      description="Agents will run multi-step tasks against your knowledge — planning, searching memory and calling tools — instead of answering single prompts."
      points={[
        "Define an agent with its own persona and instructions",
        "Grant access to specific knowledge and memory",
        "Agent Mode routing through the dashy-flow-state worker",
      ]}
    />
  );
}
