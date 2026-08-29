"use client";

/**
 * DashyCore v7 — D-Code Monaco editor (client-only wrapper).
 *
 * - @monaco-editor/react is loaded with ssr:false (Monaco touches `window`
 *   and the loader fetches it from CDN at runtime — never on the server).
 * - Defines the custom "dcode-obsidian" theme: vs-dark base tuned to the
 *   DashyCore obsidian/navy background with cyan accents.
 * - Keeps the public surface tiny: value / language / onChange / readOnly
 *   plus passthrough options, so the workspace stays declarative.
 */

import dynamic from "next/dynamic";
import { useCallback } from "react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { LoaderIcon } from "@/components/icons";

const MonacoReact = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center gap-2 bg-[#0a0e1a] text-zinc-500">
      <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
      <span className="text-xs">Loading editor…</span>
    </div>
  ),
});

/** Obsidian + cyan theme — matches the DashyCore workspace. */
const DCODE_THEME = "dcode-obsidian";

function defineDcodeTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(DCODE_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5b6478", fontStyle: "italic" },
      { token: "keyword", foreground: "22d3ee" },
      { token: "string", foreground: "7dd3a8" },
      { token: "number", foreground: "c4b5fd" },
      { token: "type", foreground: "67e8f9" },
      { token: "typeIdentifier", foreground: "67e8f9" },
      { token: "function", foreground: "93c5fd" },
      { token: "variable", foreground: "e2e8f0" },
      { token: "delimiter", foreground: "77839c" },
    ],
    colors: {
      "editor.background": "#0a0e1a",
      "editor.foreground": "#e2e8f0",
      "editorCursor.foreground": "#22d3ee",
      "editor.lineHighlightBackground": "#111726",
      "editorLineNumber.foreground": "#3d4657",
      "editorLineNumber.activeForeground": "#22d3ee",
      "editor.selectionBackground": "#164e63aa",
      "editor.inactiveSelectionBackground": "#164e6355",
      "editorIndentGuide.background1": "#1c2436",
      "editorIndentGuide.activeBackground1": "#2c304a",
      "editorWidget.background": "#0d1220",
      "editorWidget.border": "#1c2436",
      "editorSuggestWidget.background": "#0d1220",
      "editorSuggestWidget.selectedBackground": "#164e63",
      "scrollbarSlider.background": "#22d3ee22",
      "scrollbarSlider.hoverBackground": "#22d3ee33",
      "scrollbarSlider.activeBackground": "#22d3ee44",
      "editorGutter.background": "#0a0e1a",
      "editorBracketMatch.border": "#22d3ee88",
      "editorBracketMatch.background": "#22d3ee1a",
    },
  });
}

export interface MonacoEditorProps {
  value: string;
  language: string;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
  /** Extra editor options (merged over the D-Code defaults). */
  options?: Record<string, unknown>;
  className?: string;
}

export function MonacoEditor({
  value,
  language,
  onChange,
  readOnly = false,
  options,
  className,
}: MonacoEditorProps) {
  const handleMount = useCallback<OnMount>((_editor, monaco) => {
    defineDcodeTheme(monaco);
    monaco.editor.setTheme(DCODE_THEME);
  }, []);

  return (
    <div className={`h-full w-full ${className ?? ""}`}>
      <MonacoReact
        height="100%"
        theme={DCODE_THEME}
        language={language}
        value={value}
        onChange={onChange}
        onMount={handleMount}
        options={{
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
          fontSize: 13,
          fontLigatures: true,
          minimap: { enabled: true, scale: 1, size: "proportional" },
          lineNumbers: "on",
          renderLineHighlight: "all",
          smoothScrolling: true,
          cursorBlinking: "phase",
          cursorSmoothCaretAnimation: "on",
          padding: { top: 12, bottom: 24 },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          readOnly,
          ...options,
        }}
      />
    </div>
  );
}
