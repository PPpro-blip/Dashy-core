/**
 * DashyCore v7 — First-party extension: `dashy.cline` (Agent Code).
 *
 * A Cline-style coding agent for the browser IDE. It reads the in-memory
 * project (file list + contents), asks the worker (agentMode:true JSON path)
 * for structured file edits, and renders them as diff cards the user must
 * click "Apply" to write into Monaco buffers.
 *
 * Hard limits — this is a BROWSER IDE:
 *   - no real host shell / RCE. Terminal suggestions are text only and, at
 *     most, drive the existing simulated terminal.
 *   - all AI traffic reuses lib/chat-client (dashy-flow-state), userId sent.
 *
 * The chat surface lives in a host side panel (components/dcode/AgentCodePanel);
 * the commands here just open it and trigger its actions via the view bridge.
 */

import { fireViewAction } from "../view-bridge";
import type { ExtensionModule } from "../types";

export const clineExtension: ExtensionModule = {
  manifest: {
    id: "dashy.cline",
    name: "Agent Code",
    version: "1.0.0",
    description:
      "Cline-style coding agent for the browser IDE. Reads your project, proposes multi-file edits as diffs, and applies them into Monaco on click.",
    author: "DashyCore",
    icon: "🤖",
    categories: ["AI", "Productivity"],
    contributes: {
      commands: [
        {
          id: "dashy.cline.startTask",
          title: "Start Task",
          category: "Agent Code",
        },
        {
          id: "dashy.cline.applyLastDiff",
          title: "Apply Last Diff",
          category: "Agent Code",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    context.registerCommand("dashy.cline.startTask", {
      title: "Start Task",
      category: "Agent Code",
      handler: () => {
        context.ui.showView("agent-code");
        fireViewAction("agent-code.focusInput");
      },
    });

    context.registerCommand("dashy.cline.applyLastDiff", {
      title: "Apply Last Diff",
      category: "Agent Code",
      handler: () => {
        context.ui.showView("agent-code");
        fireViewAction("agent-code.applyLast");
      },
    });
  },
};
