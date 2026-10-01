/**
 * DashyCore v7 — Dashy Theme Pack: Monaco color themes.
 *
 * The four first-party themes contributed by the `dashy.themes` extension.
 * `dcode-obsidian` is the original D-Code theme (preserved byte-for-byte);
 * the other three round out the pack: a classic dark, a cyan ocean and a
 * high-contrast option.
 */

import type { editor } from "monaco-editor";

/**
 * The default D-Code theme — the original cyan/obsidian look. Used whenever
 * no stored preference exists AND as the revert target when the Dashy Theme
 * Pack extension is disabled (a disabled extension must not keep its
 * contribution applied).
 */
export const DEFAULT_DCODE_THEME_ID = "dcode-obsidian";

export interface DashyThemeDefinition {
  /** Monaco theme id (stable — persisted in localStorage). */
  id: string;
  /** Display label shown in the Color Theme quick pick. */
  label: string;
  description: string;
  data: editor.IStandaloneThemeData;
}

/* ---------------------------------------------------------------------- */
/* dcode-obsidian — the original DashyCore cyan/obsidian theme.           */
/* ---------------------------------------------------------------------- */

const OBSIDIAN: editor.IStandaloneThemeData = {
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
};

/* ---------------------------------------------------------------------- */
/* dashy-dark-classic — VS Code Dark+ classic, Dashy-tinted.              */
/* ---------------------------------------------------------------------- */

const DARK_CLASSIC: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6a9955" },
    { token: "keyword", foreground: "569cd6" },
    { token: "string", foreground: "ce9178" },
    { token: "number", foreground: "b5cea8" },
    { token: "type", foreground: "4ec9b0" },
    { token: "function", foreground: "dcdcaa" },
    { token: "variable", foreground: "9cdcfe" },
    { token: "delimiter", foreground: "d4d4d4" },
    { token: "operator", foreground: "d4d4d4" },
  ],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorCursor.foreground": "#aeafad",
    "editor.lineHighlightBackground": "#2a2d2e",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#264f7855",
    "editorIndentGuide.background1": "#404040",
    "editorIndentGuide.activeBackground1": "#707070",
    "editorWidget.background": "#252526",
    "editorWidget.border": "#454545",
    "editorSuggestWidget.background": "#252526",
    "editorSuggestWidget.selectedBackground": "#04395e",
    "scrollbarSlider.background": "#79797933",
    "scrollbarSlider.hoverBackground": "#6464644d",
    "scrollbarSlider.activeBackground": "#bfbfbf66",
    "editorGutter.background": "#1e1e1e",
    "editorBracketMatch.border": "#888888",
    "editorBracketMatch.background": "#ffffff1a",
  },
};

/* ---------------------------------------------------------------------- */
/* dashy-ocean — brighter cyan-forward variant of the obsidian theme.     */
/* ---------------------------------------------------------------------- */

const OCEAN: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "52708a", fontStyle: "italic" },
    { token: "keyword", foreground: "4dd8ff" },
    { token: "string", foreground: "6ef2c0" },
    { token: "number", foreground: "9ad0ff" },
    { token: "type", foreground: "8be9fd" },
    { token: "typeIdentifier", foreground: "8be9fd" },
    { token: "function", foreground: "7aa2f7" },
    { token: "variable", foreground: "dbe9ff" },
    { token: "delimiter", foreground: "7f9db8" },
    { token: "operator", foreground: "89ddff" },
  ],
  colors: {
    "editor.background": "#0b1526",
    "editor.foreground": "#dbe9ff",
    "editorCursor.foreground": "#4dd8ff",
    "editor.lineHighlightBackground": "#10203a",
    "editorLineNumber.foreground": "#35506e",
    "editorLineNumber.activeForeground": "#4dd8ff",
    "editor.selectionBackground": "#164e63aa",
    "editor.inactiveSelectionBackground": "#164e6355",
    "editorIndentGuide.background1": "#16283f",
    "editorIndentGuide.activeBackground1": "#27415f",
    "editorWidget.background": "#0e1a2e",
    "editorWidget.border": "#1d3249",
    "editorSuggestWidget.background": "#0e1a2e",
    "editorSuggestWidget.selectedBackground": "#0e3a52",
    "scrollbarSlider.background": "#4dd8ff22",
    "scrollbarSlider.hoverBackground": "#4dd8ff33",
    "scrollbarSlider.activeBackground": "#4dd8ff44",
    "editorGutter.background": "#0b1526",
    "editorBracketMatch.border": "#4dd8ff88",
    "editorBracketMatch.background": "#4dd8ff1a",
  },
};

/* ---------------------------------------------------------------------- */
/* dashy-high-contrast — maximum contrast, black + neon.                  */
/* ---------------------------------------------------------------------- */

const HIGH_CONTRAST: editor.IStandaloneThemeData = {
  base: "hc-black",
  inherit: true,
  rules: [
    { token: "comment", foreground: "7c8aa5" },
    { token: "keyword", foreground: "22d3ee" },
    { token: "string", foreground: "86efac" },
    { token: "number", foreground: "e9d5ff" },
    { token: "type", foreground: "67e8f9" },
    { token: "function", foreground: "93c5fd" },
    { token: "variable", foreground: "ffffff" },
    { token: "delimiter", foreground: "d4d4d4" },
  ],
  colors: {
    "editor.background": "#000000",
    "editor.foreground": "#ffffff",
    "editorCursor.foreground": "#22d3ee",
    "editor.lineHighlightBackground": "#101826",
    "editorLineNumber.foreground": "#6b7280",
    "editorLineNumber.activeForeground": "#22d3ee",
    "editor.selectionBackground": "#1e3a8aff",
    "editor.inactiveSelectionBackground": "#1e3a8a55",
    "editorIndentGuide.background1": "#1f2937",
    "editorIndentGuide.activeBackground1": "#4b5563",
    "editorWidget.background": "#0a0a0a",
    "editorWidget.border": "#22d3ee66",
    "editorSuggestWidget.background": "#0a0a0a",
    "editorSuggestWidget.selectedBackground": "#164e63",
    "scrollbarSlider.background": "#22d3ee44",
    "scrollbarSlider.hoverBackground": "#22d3ee66",
    "scrollbarSlider.activeBackground": "#22d3ee88",
    "editorGutter.background": "#000000",
    "editorBracketMatch.border": "#22d3ee",
    "editorBracketMatch.background": "#22d3ee2a",
  },
};

export const DASHY_THEMES: DashyThemeDefinition[] = [
  {
    id: "dcode-obsidian",
    label: "Dashy Obsidian",
    description: "Original DashyCore cyan/obsidian theme",
    data: OBSIDIAN,
  },
  {
    id: "dashy-dark-classic",
    label: "Dashy Dark Classic",
    description: "Classic dark editor, VS Code Dark+ energy",
    data: DARK_CLASSIC,
  },
  {
    id: "dashy-ocean",
    label: "Dashy Ocean",
    description: "Bright cyan-forward deep blue",
    data: OCEAN,
  },
  {
    id: "dashy-high-contrast",
    label: "Dashy High Contrast",
    description: "Black + neon, maximum contrast",
    data: HIGH_CONTRAST,
  },
];

/** Theme definition by id (undefined for unknown ids). */
export function dashyThemeById(id: string): DashyThemeDefinition | undefined {
  return DASHY_THEMES.find((t) => t.id === id);
}

/**
 * Defines every Dashy theme on a Monaco instance. Idempotent — safe to
 * call from every editor mount.
 */
export function defineDashyThemes(monaco: {
  editor: {
    defineTheme: (id: string, data: editor.IStandaloneThemeData) => void;
  };
}): void {
  for (const theme of DASHY_THEMES) {
    monaco.editor.defineTheme(theme.id, theme.data);
  }
}
