/**
 * DashyCore v7 — Dashy Prettier: document formatting for D-Code.
 *
 * Uses the official Prettier browser build (prettier/standalone + parser
 * plugins), loaded through dynamic imports so webpack code-splits it into
 * a chunk that is only fetched when Format Document is actually invoked.
 *
 * Supported languages: JavaScript/JSX/TS/TSX, JSON, CSS/SCSS/LESS, HTML,
 * Markdown and YAML. If the Prettier chunk fails to load, a built-in JSON
 * fallback keeps Format Document honest for JSON files.
 */

type PrettierModule = {
  format: (
    source: string,
    options: Record<string, unknown>
  ) => Promise<string>;
};

type PrettierPlugin = Record<string, unknown>;

let prettierPromise: Promise<{
  prettier: PrettierModule;
  plugins: PrettierPlugin[];
} | null> | null = null;

/**
 * Loads prettier/standalone + the parser plugins we ship. Resolves null
 * when the chunk fails (caller falls back).
 */
function loadPrettier(): Promise<{
  prettier: PrettierModule;
  plugins: PrettierPlugin[];
} | null> {
  if (!prettierPromise) {
    prettierPromise = (async () => {
      try {
        const [prettier, estree, babel, postcss, html, markdown, yaml] =
          await Promise.all([
            import("prettier/standalone"),
            import("prettier/plugins/estree"),
            import("prettier/plugins/babel"),
            import("prettier/plugins/postcss"),
            import("prettier/plugins/html"),
            import("prettier/plugins/markdown"),
            import("prettier/plugins/yaml"),
          ]);
        return {
          prettier: prettier as unknown as PrettierModule,
          plugins: [
            estree as unknown as PrettierPlugin,
            babel as unknown as PrettierPlugin,
            postcss as unknown as PrettierPlugin,
            html as unknown as PrettierPlugin,
            markdown as unknown as PrettierPlugin,
            yaml as unknown as PrettierPlugin,
          ],
        };
      } catch {
        return null;
      }
    })();
  }
  return prettierPromise;
}

/** File extension (lowercase, no dot) → prettier parser id. */
const PARSER_BY_EXT: Record<string, string> = {
  js: "babel",
  jsx: "babel",
  mjs: "babel",
  cjs: "babel",
  ts: "babel-ts",
  tsx: "babel-ts",
  mts: "babel-ts",
  cts: "babel-ts",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
};

export interface FormatResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** Built-in fallback: pretty-print JSON with 2-space indentation. */
function formatJsonFallback(content: string): string | null {
  try {
    return JSON.stringify(JSON.parse(content), null, 2) + "\n";
  } catch {
    return null;
  }
}

/**
 * Formats `content` for a file named `filename`. Never throws — every
 * failure path resolves a FormatResult with a user-facing error.
 */
export async function formatText(
  filename: string,
  content: string
): Promise<FormatResult> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const parser = PARSER_BY_EXT[ext];

  if (!parser) {
    return {
      ok: false,
      error: `Prettier has no parser for .${ext} files (supported: JS, TS, JSON, CSS, HTML, Markdown, YAML).`,
    };
  }

  const loaded = await loadPrettier();
  if (!loaded) {
    // Prettier chunk unavailable — JSON still formats.
    if (parser === "json") {
      const fallback = formatJsonFallback(content);
      if (fallback !== null) return { ok: true, text: fallback };
    }
    return {
      ok: false,
      error:
        "The Prettier formatter chunk could not be loaded (offline?). JSON formatting is still available.",
    };
  }

  try {
    const text = await loaded.prettier.format(content, {
      parser,
      plugins: loaded.plugins,
      printWidth: 80,
      tabWidth: 2,
      semi: true,
      singleQuote: false,
    });
    return { ok: true, text };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not format this file: ${error.message.split("\n")[0]}`
          : "Could not format this file.",
    };
  }
}
