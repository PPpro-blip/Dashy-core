/**
 * DashyCore v7 — First-party extension: `dashy.autocomplete` (Ghost Suggestions).
 *
 * Monaco inline (ghost text) completions backed by the existing chat worker.
 * Disabled by default — only active once the user installs/enables it.
 *
 *   - debounced (350ms), one suggestion max
 *   - short prefix context only (a few hundred chars before the cursor)
 *   - fails soft: any worker/parse error yields no suggestion, no toast spam
 *   - a per-request AbortController cancels stale in-flight calls
 */

import type { editor as MonacoEditorNs, Position } from "monaco-editor";
import { sendChatMessage } from "@/lib/chat-client";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import type {
  DCodeMonacoNamespace,
  ExtensionContext,
  ExtensionModule,
} from "../types";

const DEBOUNCE_MS = 350;
const MAX_PREFIX = 600;
const MAX_SUFFIX = 200;

let providerDisposable: { dispose(): void } | null = null;
let inFlight: AbortController | null = null;

interface CacheEntry {
  key: string;
  text: string;
}
let lastCache: CacheEntry | null = null;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Strips markdown fences the model may wrap a completion in. */
function cleanCompletion(raw: string): string {
  let text = raw;
  const fence = /^```[\w.-]*\n([\s\S]*?)```/m.exec(text);
  if (fence) text = fence[1];
  // Only keep the leading portion up to a blank line — ghost text should be short.
  return text.replace(/\r/g, "");
}

function registerProvider(
  monaco: DCodeMonacoNamespace,
  context: ExtensionContext
): void {
  providerDisposable?.dispose();
  providerDisposable = monaco.languages.registerInlineCompletionsProvider(
    { pattern: "**" },
    {
      freeInlineCompletions() {
        /* no-op: results aren't retained */
      },
      async provideInlineCompletions(
        model: MonacoEditorNs.ITextModel,
        position: Position
      ) {
        // Cancel any prior request.
        inFlight?.abort();
        const controller = new AbortController();
        inFlight = controller;

        try {
          await delay(DEBOUNCE_MS, controller.signal);

          const offset = model.getOffsetAt(position);
          const full = model.getValue();
          const prefix = full.slice(Math.max(0, offset - MAX_PREFIX), offset);
          const suffix = full.slice(offset, offset + MAX_SUFFIX);
          if (!prefix.trim()) return { items: [] };

          const cacheKey = `${prefix}\u0000${suffix}`;
          if (lastCache && lastCache.key === cacheKey) {
            return {
              items: [{ insertText: lastCache.text, range: undefined }],
            };
          }

          const userId = await context.workspace.getUserId();
          const language = model.getLanguageId();
          const prompt =
            `You are an inline code completion engine inside a browser IDE. ` +
            `Continue the code at the cursor for language "${language}". ` +
            `Return ONLY the raw completion text (no prose, no markdown fences, no explanation). ` +
            `Keep it short — a single logical continuation.\n\n` +
            `<PREFIX>\n${prefix}\n</PREFIX>\n<SUFFIX>\n${suffix}\n</SUFFIX>`;

          const result = await sendChatMessage(
            {
              message: prompt,
              model: DEFAULT_MODEL_ID,
              userId: userId ?? undefined,
              agentMode: false,
              signal: controller.signal,
            },
            {}
          );

          if (controller.signal.aborted) return { items: [] };
          const text = cleanCompletion(result.content).replace(/\n{3,}/g, "\n\n");
          const trimmed = text.replace(/\s+$/, "");
          if (!trimmed) return { items: [] };

          lastCache = { key: cacheKey, text: trimmed };
          return { items: [{ insertText: trimmed, range: undefined }] };
        } catch {
          // Fail soft — no toast, no console spam beyond dev noise.
          return { items: [] };
        } finally {
          if (inFlight === controller) inFlight = null;
        }
      },
    }
  );
}

export const autocompleteExtension: ExtensionModule = {
  manifest: {
    id: "dashy.autocomplete",
    name: "Ghost Suggestions",
    version: "1.0.0",
    description:
      "Optional AI inline completions (ghost text) for Monaco. Debounced, one suggestion at a time, and off until you enable it.",
    author: "DashyCore",
    icon: "✨",
    categories: ["AI", "Productivity"],
    contributes: {
      commands: [
        {
          id: "dashy.autocomplete.trigger",
          title: "Trigger Inline Suggestion",
          category: "Ghost Suggestions",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    const monaco = context.workspace.getMonaco();
    if (monaco) {
      registerProvider(monaco, context);
    }

    context.registerCommand("dashy.autocomplete.trigger", {
      title: "Trigger Inline Suggestion",
      category: "Ghost Suggestions",
      handler: () => {
        const editor = context.workspace.getEditor();
        const m = context.workspace.getMonaco();
        if (!editor || !m) {
          context.ui.notify("Open a file first to use Ghost Suggestions.");
          return;
        }
        // Ensure the provider is live, then ask Monaco to show ghost text.
        if (!providerDisposable) registerProvider(m, context);
        editor.trigger("dashy.autocomplete", "editor.action.inlineSuggest.trigger", {});
      },
    });
  },

  deactivate() {
    inFlight?.abort();
    inFlight = null;
    lastCache = null;
    providerDisposable?.dispose();
    providerDisposable = null;
  },
};
