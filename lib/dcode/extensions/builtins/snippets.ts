/**
 * DashyCore v7 — First-party extension: `dashy.snippets` (TS/React Snippets).
 *
 * Registers a Monaco completion provider for TypeScript/JavaScript that
 * offers common TS/React snippets (component, hook, log, etc.) with tab
 * stops. Deactivating disposes the provider so the completions vanish.
 */

import type { editor as MonacoEditorNs, Position } from "monaco-editor";
import type { DCodeMonacoNamespace, ExtensionModule } from "../types";

interface Snippet {
  label: string;
  detail: string;
  body: string;
}

const SNIPPETS: Snippet[] = [
  {
    label: "rfc",
    detail: "React function component",
    body: [
      'export function ${1:Component}() {',
      "  return (",
      "    <div>${2:content}</div>",
      "  );",
      "}",
      "",
    ].join("\n"),
  },
  {
    label: "useState",
    detail: "React useState hook",
    body: "const [${1:state}, set${2:State}] = useState(${3:initial});",
  },
  {
    label: "useEffect",
    detail: "React useEffect hook",
    body: ["useEffect(() => {", "  ${1:effect}", "}, [${2:deps}]);"].join("\n"),
  },
  {
    label: "clg",
    detail: "console.log",
    body: 'console.log(${1:value});',
  },
  {
    label: "afn",
    detail: "async arrow function",
    body: "const ${1:fn} = async (${2:args}) => {\n  ${3:body}\n};",
  },
  {
    label: "tryc",
    detail: "try/catch block",
    body: [
      "try {",
      "  ${1:body}",
      "} catch (error) {",
      "  ${2:console.error(error);}",
      "}",
    ].join("\n"),
  },
  {
    label: "interface",
    detail: "TypeScript interface",
    body: "interface ${1:Name} {\n  ${2:key}: ${3:type};\n}",
  },
];

let disposable: { dispose(): void } | null = null;

function register(monaco: DCodeMonacoNamespace): void {
  disposable?.dispose();
  disposable = monaco.languages.registerCompletionItemProvider(
    ["typescript", "javascript"],
    {
      provideCompletionItems(model: MonacoEditorNs.ITextModel, position: Position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: SNIPPETS.map((s) => ({
            label: s.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `Dashy · ${s.detail}`,
            insertText: s.body,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    }
  );
}

export const snippetsExtension: ExtensionModule = {
  manifest: {
    id: "dashy.snippets",
    name: "TS / React Snippets",
    version: "1.0.0",
    description:
      "Handy TypeScript & React snippets (rfc, useState, useEffect, clg, tryc…) as Monaco completions with tab stops.",
    author: "DashyCore",
    icon: "🧩",
    categories: ["Productivity", "Language"],
    contributes: {},
    activationEvents: ["*"],
  },

  activate(context) {
    const monaco = context.workspace.getMonaco();
    if (monaco) register(monaco);
  },

  deactivate() {
    disposable?.dispose();
    disposable = null;
  },
};
