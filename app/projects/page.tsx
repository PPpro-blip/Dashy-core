"use client";

/**
 * DashyCore v7 — Projects (real route, feature under construction).
 * Projects will group related chats, files and instructions into
 * long-running workspaces. Placeholder until then — no fake functionality.
 */

import { PlaceholderPage } from "@/components/PlaceholderPage";
import { FolderIcon } from "@/components/icons";

export default function ProjectsPage() {
  return (
    <PlaceholderPage
      Icon={FolderIcon}
      title="Projects"
      tagline="Organize long-running work into dedicated spaces."
      description="Projects will bundle related chats, uploaded documents and instructions so multi-day work stays in one place with its own context."
      points={[
        "Group chats and knowledge under one project",
        "Per-project instructions the assistant always remembers",
        "Shared context across every conversation in the project",
      ]}
    />
  );
}
