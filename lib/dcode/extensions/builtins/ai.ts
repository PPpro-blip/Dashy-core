/**
 * DashyCore v7 — First-party extension: `dashy.ai` (DashyAI).
 *
 * "Explain Current File" and "Refactor Selection" through the EXISTING chat
 * pipeline (lib/chat-client → dashy-flow-state worker) — no new AI provider,
 * no agent mode, default model (dashy-allround). Results stream into the
 * AI Output drawer with a copy button.
 */

import { sendChatMessage } from "@/lib/chat-client";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import type { ExtensionContext, ExtensionModule } from "../types";

const SYSTEM_NOTE =
  "You are DashyAI inside the D-Code web IDE. Answer concisely and directly.";

async function runDashyAi(
  context: ExtensionContext,
  title: string,
  prompt: string
): Promise<void> {
  const userId = await context.workspace.getUserId();
  context.workspace.showAiOutput(title);
  try {
    await sendChatMessage(
      {
        message: prompt,
        model: DEFAULT_MODEL_ID,
        userId: userId ?? undefined,
        agentMode: false,
      },
      {
        onDelta: (delta) => context.workspace.appendAiOutput(delta),
      }
    );
  } catch (error) {
    context.workspace.appendAiOutput(
      `\n\n[DashyAI error] ${
        error instanceof Error ? error.message : "Could not reach the assistant."
      }`
    );
  } finally {
    context.workspace.finishAiOutput();
  }
}

export const aiExtension: ExtensionModule = {
  manifest: {
    id: "dashy.ai",
    name: "DashyAI",
    version: "1.0.0",
    description:
      "Explain the current file or refactor a selection with DashyAI — the same model router as Dashy chat.",
    author: "DashyCore",
    categories: ["AI"],
    contributes: {
      commands: [
        {
          id: "dashy.ai.explainFile",
          title: "Explain Current File",
          category: "DashyAI",
        },
        {
          id: "dashy.ai.refactorSelection",
          title: "Refactor Selection",
          category: "DashyAI",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    context.registerCommand("dashy.ai.explainFile", {
      title: "Explain Current File",
      category: "DashyAI",
      handler: async () => {
        const file = context.workspace.getActiveFile();
        if (!file) {
          context.ui.notify("Open a file first, then run Explain Current File.");
          return;
        }
        const prompt = `${SYSTEM_NOTE}\n\nExplain this source file (${file.name}, ${file.language}). Cover what it does, its key functions and any notable patterns. Use markdown.\n\nFile: ${file.name}\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
        await runDashyAi(context, `DashyAI · Explain ${file.name}`, prompt);
      },
    });

    context.registerCommand("dashy.ai.refactorSelection", {
      title: "Refactor Selection",
      category: "DashyAI",
      handler: async () => {
        const file = context.workspace.getActiveFile();
        const selection = context.workspace.getSelectedText();
        if (!file) {
          context.ui.notify("Open a file first, then run Refactor Selection.");
          return;
        }
        if (!selection || !selection.trim()) {
          context.ui.notify(
            "Select code in the editor first — Refactor Selection works on your selection."
          );
          return;
        }
        const prompt = `${SYSTEM_NOTE}\n\nRefactor the selected code from ${file.name}. Improve clarity, naming and structure without changing behavior. Show the refactored code in a fenced block, then a short bullet list of what changed.\n\nFile: ${file.name}\nSelected code:\n\`\`\`${file.language}\n${selection}\n\`\`\``;
        await runDashyAi(
          context,
          `DashyAI · Refactor selection in ${file.name}`,
          prompt
        );
      },
    });
  },
};
