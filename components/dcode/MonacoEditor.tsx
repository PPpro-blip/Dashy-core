"use client";

/**
 * DashyCore v7 — D-Code Monaco editor (client-only wrapper).
 *
 * - @monaco-editor/react is loaded with ssr:false (Monaco touches `window`
 *   and the loader fetches it from CDN at runtime — never on the server).
 * - Defines every Dashy Theme Pack theme (lib/dcode/extensions/themes)
 *   on mount and applies the persisted selection, defaulting to the
 *   original "dcode-obsidian" cyan theme.
 * - Keeps the public surface tiny: value / language / onChange / readOnly
 *   plus optional theme + onEditorReady, so the workspace stays
 *   declarative and extensions can reach the editor instance.
 */

import dynamic from "next/dynamic";
import { useCallback } from "react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { defineDashyThemes } from "@/lib/dcode/extensions/themes";
import { getStoredTheme } from "@/lib/dcode/extensions/storage";
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

export type DCodeMonacoEditor = Parameters<OnMount>[0];

export interface MonacoEditorProps {
  value: string;
  language: string;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
  /** Monaco theme id (must be a defined Dashy theme). */
  theme?: string;
  /** Called once with the live Monaco editor instance (extensions). */
  onEditorReady?: (editor: DCodeMonacoEditor) => void;
  /** Extra editor options (merged over the D-Code defaults). */
  options?: Record<string, unknown>;
  className?: string;
}

export function MonacoEditor({
  value,
  language,
  onChange,
  readOnly = false,
  theme,
  onEditorReady,
  options,
  className,
}: MonacoEditorProps) {
  const themeId = theme ?? getStoredTheme();

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      defineDashyThemes(monaco);
      monaco.editor.setTheme(themeId);
      onEditorReady?.(editor);
    },
    [onEditorReady, themeId]
  );

  return (
    <div className={`h-full w-full ${className ?? ""}`}>
      <MonacoReact
        height="100%"
        theme={themeId}
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
