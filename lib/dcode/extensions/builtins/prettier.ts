/**
 * DashyCore v7 — First-party extension: `dashy.prettier` (Prettier Format).
 *
 * "Format Document" via the official Prettier browser build (see
 * lib/dcode/extensions/format.ts), wired to the Command Palette and to an
 * optional format-on-save toggle (off by default, persisted).
 */

import { formatText } from "../format";
import { getFormatOnSave, setFormatOnSave } from "../storage";
import type { ExtensionModule } from "../types";

export const prettierExtension: ExtensionModule = {
  manifest: {
    id: "dashy.prettier",
    name: "Prettier Format",
    version: "1.0.0",
    description:
      "Format JavaScript, TypeScript, JSON, CSS, HTML, Markdown and YAML with Prettier's browser build.",
    author: "DashyCore",
    categories: ["Formatters"],
    contributes: {
      commands: [
        {
          id: "dashy.prettier.formatDocument",
          title: "Format Document",
          category: "Editor",
        },
        {
          id: "dashy.prettier.toggleFormatOnSave",
          title: "Toggle Format on Save",
          category: "Editor",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    context.registerCommand("dashy.prettier.formatDocument", {
      title: "Format Document",
      category: "Editor",
      handler: async () => {
        await context.workspace.formatActiveFile();
      },
    });

    context.registerCommand("dashy.prettier.toggleFormatOnSave", {
      title: "Toggle Format on Save",
      category: "Editor",
      handler: () => {
        const next = !getFormatOnSave();
        setFormatOnSave(next);
        context.ui.notify(
          next
            ? "Format on Save is ON — files are formatted with Prettier before every save."
            : "Format on Save is OFF."
        );
      },
    });
  },
};

/** Re-exported so the workspace save path can format before persisting. */
export { formatText };
