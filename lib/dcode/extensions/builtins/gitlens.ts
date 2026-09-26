/**
 * DashyCore v7 — First-party extension: `dashy.gitlens` (Git Lens Preview).
 *
 * Web-safe line inspector for the browser IDE. D-Code projects live in
 * Supabase rows (no local .git history to blame), so this Preview sticks to
 * real, locally-available data:
 *   - "Inspect Active Line" reports file · line/total · selection state
 *   - "Copy Line Permalink" copies a `file#L<n>` reference for code reviews
 *
 * No history is ever fabricated — anything beyond the live buffer is out of
 * scope until D-Code snapshots per-save revisions.
 */

import type { ExtensionModule } from "../types";

export const gitlensExtension: ExtensionModule = {
  manifest: {
    id: "dashy.gitlens",
    name: "Git Lens Preview",
    version: "1.0.0",
    description:
      "Line history & diff inspector. Inspect the active line (file · line · selection) and copy review-ready line permalinks.",
    author: "DashyCore",
    icon: "🔍",
    categories: ["Productivity"],
    contributes: {
      commands: [
        {
          id: "dashy.gitlens.inspectLine",
          title: "Inspect Active Line",
          category: "GitLens",
        },
        {
          id: "dashy.gitlens.copyPermalink",
          title: "Copy Line Permalink",
          category: "GitLens",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    const lineInfo = () => {
      const file = context.workspace.getActiveFile();
      if (!file) return null;
      const cursor = context.workspace.getCursorPosition?.() ?? {
        line: 1,
        column: 1,
      };
      const total = Math.max(1, file.content.split("\n").length);
      const line = Math.min(Math.max(1, cursor.line), total);
      return { file, line, column: cursor.column, total };
    };

    context.registerCommand("dashy.gitlens.inspectLine", {
      title: "Inspect Active Line",
      category: "GitLens",
      handler: () => {
        const info = lineInfo();
        if (!info) {
          context.ui.notify("Open a file first, then run Inspect Active Line.");
          return;
        }
        const selection = context.workspace.getSelectedText();
        const selNote =
          selection && selection.trim()
            ? ` · ${selection.length} chars selected`
            : " · no selection";
        context.ui.notify(
          `${info.file.name} · line ${info.line} of ${info.total} (col ${info.column})${selNote}`
        );
      },
    });

    context.registerCommand("dashy.gitlens.copyPermalink", {
      title: "Copy Line Permalink",
      category: "GitLens",
      handler: async () => {
        const info = lineInfo();
        if (!info) {
          context.ui.notify("Open a file first, then run Copy Line Permalink.");
          return;
        }
        const permalink = `${info.file.name}#L${info.line}`;
        try {
          if (
            typeof navigator !== "undefined" &&
            navigator.clipboard?.writeText
          ) {
            await navigator.clipboard.writeText(permalink);
            context.ui.notify(`Line permalink copied: ${permalink}`);
          } else {
            context.ui.notify(`Line permalink: ${permalink}`);
          }
        } catch {
          context.ui.notify(`Line permalink: ${permalink}`);
        }
      },
    });
  },
};
