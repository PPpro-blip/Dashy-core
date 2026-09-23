/**
 * DashyCore v7 — First-party extension: `dashy.tailwind`
 * (Tailwind Class IntelliSense).
 *
 * Web-safe Tailwind helper for the browser IDE:
 *   - a Monaco completion provider suggesting common Tailwind utilities
 *     while typing inside `class="…"` / `className="…"` attributes
 *   - a "Tailwind: Insert Play CDN Script" command that injects the official
 *     Tailwind Play CDN snippet into the active HTML file's <head>
 *
 * Fully local: the utility list is a curated static set, no network calls,
 * no language server. Disabling disposes the provider so suggestions vanish.
 */

import type { editor as MonacoEditorNs, Position } from "monaco-editor";
import type { DCodeMonacoNamespace, ExtensionModule } from "../types";

interface Utility {
  label: string;
  detail: string;
}

/** Curated utility subset (layout, flex/grid, spacing, sizing, type, color). */
const UTILITIES: Utility[] = [
  // Layout
  { label: "container", detail: "Layout · centered container" },
  { label: "block", detail: "Display · block" },
  { label: "inline-block", detail: "Display · inline-block" },
  { label: "flex", detail: "Display · flex" },
  { label: "inline-flex", detail: "Display · inline-flex" },
  { label: "grid", detail: "Display · grid" },
  { label: "hidden", detail: "Display · none" },
  { label: "static", detail: "Position · static" },
  { label: "relative", detail: "Position · relative" },
  { label: "absolute", detail: "Position · absolute" },
  { label: "fixed", detail: "Position · fixed" },
  { label: "sticky", detail: "Position · sticky" },
  { label: "inset-0", detail: "Position · all offsets 0" },
  { label: "top-0", detail: "Position · top 0" },
  { label: "z-10", detail: "Z-index · 10" },
  { label: "z-50", detail: "Z-index · 50" },
  // Flexbox
  { label: "flex-row", detail: "Flex · row direction" },
  { label: "flex-col", detail: "Flex · column direction" },
  { label: "flex-wrap", detail: "Flex · wrap" },
  { label: "items-start", detail: "Flex · align start" },
  { label: "items-center", detail: "Flex · align center" },
  { label: "items-end", detail: "Flex · align end" },
  { label: "justify-start", detail: "Flex · justify start" },
  { label: "justify-center", detail: "Flex · justify center" },
  { label: "justify-end", detail: "Flex · justify end" },
  { label: "justify-between", detail: "Flex · space between" },
  { label: "gap-1", detail: "Gap · 0.25rem" },
  { label: "gap-2", detail: "Gap · 0.5rem" },
  { label: "gap-4", detail: "Gap · 1rem" },
  { label: "gap-6", detail: "Gap · 1.5rem" },
  { label: "flex-1", detail: "Flex · grow + shrink" },
  { label: "flex-shrink-0", detail: "Flex · never shrink" },
  // Grid
  { label: "grid-cols-2", detail: "Grid · 2 columns" },
  { label: "grid-cols-3", detail: "Grid · 3 columns" },
  { label: "grid-cols-4", detail: "Grid · 4 columns" },
  { label: "col-span-2", detail: "Grid · span 2" },
  // Spacing
  { label: "p-1", detail: "Padding · 0.25rem" },
  { label: "p-2", detail: "Padding · 0.5rem" },
  { label: "p-4", detail: "Padding · 1rem" },
  { label: "p-6", detail: "Padding · 1.5rem" },
  { label: "px-2", detail: "Padding X · 0.5rem" },
  { label: "px-4", detail: "Padding X · 1rem" },
  { label: "py-1", detail: "Padding Y · 0.25rem" },
  { label: "py-2", detail: "Padding Y · 0.5rem" },
  { label: "m-0", detail: "Margin · 0" },
  { label: "mx-auto", detail: "Margin X · auto (center)" },
  { label: "mt-2", detail: "Margin top · 0.5rem" },
  { label: "mt-4", detail: "Margin top · 1rem" },
  { label: "mb-2", detail: "Margin bottom · 0.5rem" },
  { label: "space-x-2", detail: "Spacing · horizontal 0.5rem" },
  { label: "space-y-2", detail: "Spacing · vertical 0.5rem" },
  // Sizing
  { label: "w-full", detail: "Width · 100%" },
  { label: "w-1/2", detail: "Width · 50%" },
  { label: "h-full", detail: "Height · 100%" },
  { label: "min-h-screen", detail: "Min-height · viewport" },
  { label: "max-w-md", detail: "Max width · 28rem" },
  { label: "max-w-xl", detail: "Max width · 36rem" },
  // Typography
  { label: "text-xs", detail: "Font size · xs" },
  { label: "text-sm", detail: "Font size · sm" },
  { label: "text-base", detail: "Font size · base" },
  { label: "text-lg", detail: "Font size · lg" },
  { label: "text-xl", detail: "Font size · xl" },
  { label: "font-medium", detail: "Weight · 500" },
  { label: "font-semibold", detail: "Weight · 600" },
  { label: "font-bold", detail: "Weight · 700" },
  { label: "text-center", detail: "Align · center" },
  { label: "text-left", detail: "Align · left" },
  { label: "truncate", detail: "Text · ellipsis overflow" },
  // Colors
  { label: "text-white", detail: "Color · white text" },
  { label: "text-black", detail: "Color · black text" },
  { label: "bg-white", detail: "Background · white" },
  { label: "bg-black", detail: "Background · black" },
  { label: "bg-transparent", detail: "Background · transparent" },
  // Borders / effects
  { label: "border", detail: "Border · 1px" },
  { label: "border-0", detail: "Border · none" },
  { label: "rounded", detail: "Radius · default" },
  { label: "rounded-lg", detail: "Radius · large" },
  { label: "rounded-xl", detail: "Radius · xl" },
  { label: "rounded-full", detail: "Radius · pill" },
  { label: "shadow", detail: "Shadow · default" },
  { label: "shadow-lg", detail: "Shadow · large" },
  { label: "opacity-50", detail: "Opacity · 50%" },
  { label: "transition", detail: "Transition · default" },
  { label: "cursor-pointer", detail: "Cursor · pointer" },
  { label: "overflow-hidden", detail: "Overflow · hidden" },
];

/** True when the cursor sits inside a class="…" / className="…" value. */
function insideClassAttribute(
  model: MonacoEditorNs.ITextModel,
  position: Position
): boolean {
  const prefix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: 1,
    endColumn: position.column,
  });
  return /(?:class|className)="[^"]*$/.test(prefix);
}

let disposable: { dispose(): void } | null = null;

function register(monaco: DCodeMonacoNamespace): void {
  disposable?.dispose();
  disposable = monaco.languages.registerCompletionItemProvider(
    ["html", "javascript", "typescript"],
    {
      triggerCharacters: ['"', " ", "-"],
      provideCompletionItems(
        model: MonacoEditorNs.ITextModel,
        position: Position
      ) {
        if (!insideClassAttribute(model, position)) {
          return { suggestions: [] };
        }
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: UTILITIES.map((u) => ({
            label: u.label,
            kind: monaco.languages.CompletionItemKind.Property,
            detail: `Tailwind · ${u.detail}`,
            insertText: u.label,
            range,
          })),
        };
      },
    }
  );
}

const PLAY_CDN_SRC = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";

export const tailwindExtension: ExtensionModule = {
  manifest: {
    id: "dashy.tailwind",
    name: "Tailwind Class IntelliSense",
    version: "1.0.0",
    description:
      "Live CSS utility helper & previewer. Utility completions inside class attributes plus one-click Tailwind Play CDN injection for HTML files.",
    author: "DashyCore",
    icon: "🌊",
    categories: ["Language", "Productivity"],
    contributes: {
      commands: [
        {
          id: "dashy.tailwind.insertPlayCdn",
          title: "Insert Play CDN Script",
          category: "Tailwind",
        },
      ],
    },
    activationEvents: ["*"],
  },

  activate(context) {
    const monaco = context.workspace.getMonaco();
    if (monaco) register(monaco);

    context.registerCommand("dashy.tailwind.insertPlayCdn", {
      title: "Insert Play CDN Script",
      category: "Tailwind",
      handler: () => {
        const file = context.workspace.getActiveFile();
        if (!file || !/\.html?$/i.test(file.name)) {
          context.ui.notify(
            "Open an HTML file first — the Tailwind Play CDN snippet targets <head>."
          );
          return;
        }
        if (file.content.includes(PLAY_CDN_SRC)) {
          context.ui.notify("Tailwind Play CDN is already in this file.");
          return;
        }
        const snippet = `  <script src="${PLAY_CDN_SRC}"></script>`;
        const headClose = file.content.indexOf("</head>");
        const next =
          headClose >= 0
            ? `${file.content.slice(0, headClose)}${snippet}\n${file.content.slice(headClose)}`
            : `${snippet}\n${file.content}`;
        context.workspace.setActiveFileContent(next);
        context.ui.notify(
          "Tailwind Play CDN inserted — utilities now preview live in the browser."
        );
      },
    });
  },

  deactivate() {
    disposable?.dispose();
    disposable = null;
  },
};
