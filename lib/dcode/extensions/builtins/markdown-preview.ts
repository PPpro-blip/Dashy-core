/**
 * DashyCore v7 — First-party extension: `dashy.markdown-preview`.
 *
 * Renders the active Markdown file in a side panel (rendered with the same
 * react-markdown + remark-gfm + rehype-sanitize stack the chat uses). The
 * command opens the host "markdown-preview" view; the panel reads the active
 * file itself, so the preview tracks whatever .md file is open.
 */

import { fireViewAction } from "../view-bridge";
import type { ExtensionModule } from "../types";

export const markdownPreviewExtension: ExtensionModule = {
  manifest: {
    id: "dashy.markdown-preview",
    name: "Markdown Preview",
    version: "1.0.0",
    description:
      "Preview the active Markdown file in a side panel with GitHub-flavored rendering.",
    author: "DashyCore",
    icon: "📄",
    categories: ["Productivity", "Language"],
    contributes: {
      commands: [
        {
          id: "dashy.markdownPreview.open",
          title: "Open Preview",
          category: "Markdown",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    context.registerCommand("dashy.markdownPreview.open", {
      title: "Open Preview",
      category: "Markdown",
      handler: () => {
        const file = context.workspace.getActiveFile();
        if (!file || file.language !== "markdown") {
          context.ui.notify("Open a Markdown (.md) file first, then run Markdown: Open Preview.");
          return;
        }
        context.ui.showView("markdown-preview");
        fireViewAction("markdown-preview.refresh");
      },
    });
  },
};
