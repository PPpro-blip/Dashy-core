/**
 * DashyCore v7 — First-party extension: `dashy.roo` (Pair Coder).
 *
 * A Roo-style pair-programming assistant. It works on the CURRENT SELECTION:
 * you highlight code, it discusses it with the filename as context, and when
 * the reply contains a fenced code block you can apply it back over the
 * selection.
 *
 * Worker path: NORMAL chat (agentMode:false, streaming). Rationale —
 * pair programming is conversational and selection-scoped; a streaming chat
 * reply reads better than the agent's structured-JSON path, and we only ever
 * apply a single fenced block back over the selection (no multi-file writes).
 *
 * The chat surface lives in a host side panel (components/dcode/PairCoderPanel);
 * the command here opens it seeded with the current selection.
 */

import { fireViewAction } from "../view-bridge";
import type { ExtensionModule } from "../types";

export const rooExtension: ExtensionModule = {
  manifest: {
    id: "dashy.roo",
    name: "Pair Coder",
    version: "1.0.0",
    description:
      "Roo-style pair programming. Select code and chat about it with filename context; apply a returned code block straight back over your selection.",
    author: "DashyCore",
    icon: "👥",
    categories: ["AI", "Productivity"],
    contributes: {
      commands: [
        {
          id: "dashy.roo.chatSelection",
          title: "Chat about Selection",
          category: "Pair",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    context.registerCommand("dashy.roo.chatSelection", {
      title: "Chat about Selection",
      category: "Pair",
      handler: () => {
        const selection = context.workspace.getSelectedText();
        if (!selection || !selection.trim()) {
          context.ui.notify("Select code first — Pair Coder works on your selection.");
          return;
        }
        context.ui.showView("pair-coder");
        fireViewAction("pair-coder.newFromSelection");
      },
    });
  },
};
