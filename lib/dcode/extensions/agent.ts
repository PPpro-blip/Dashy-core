/**
 * DashyCore v7 — Dashy Extensions: shared coding-agent helpers.
 *
 * Used by Agent Code (Cline-style) and Pair Coder (Roo-style). All AI
 * traffic reuses the EXISTING chat pipeline (lib/chat-client →
 * dashy-flow-state worker); there is no new provider and no host shell.
 *
 * Two worker paths are available and we pick per feature:
 *   - agentMode:true  → worker returns a single JSON object (no SSE). Best
 *     for "give me structured file edits" (Agent Code). We still parse the
 *     returned text for fenced blocks because the worker streams prose.
 *   - agentMode:false → normal chat (SSE/stream). Best for conversational,
 *     selection-scoped help (Pair Coder).
 */

import { sendChatMessage, type ChatCallbacks } from "@/lib/chat-client";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import type { DCodeFile } from "@/lib/dcode";

export interface ProposedEdit {
  /** Target file name (as it should appear in the tree). */
  name: string;
  /** Full new file contents. */
  content: string;
  /** Monaco language id parsed from the fence, when present. */
  language?: string;
}

/**
 * Runs a coding-agent turn through the worker.
 *
 * @param agentMode true → structured JSON path; false → normal streaming.
 */
export async function runAgentTurn(
  prompt: string,
  opts: {
    userId: string | null;
    agentMode: boolean;
    callbacks?: ChatCallbacks;
  }
): Promise<string> {
  const result = await sendChatMessage(
    {
      message: prompt,
      model: DEFAULT_MODEL_ID,
      userId: opts.userId ?? undefined,
      agentMode: opts.agentMode,
    },
    opts.callbacks ?? {}
  );
  return result.content;
}

/** A compact, token-friendly listing of the project files for context. */
export function summarizeFiles(files: DCodeFile[], maxCharsPerFile = 4000): string {
  if (files.length === 0) return "(the project has no files yet)";
  const parts: string[] = [];
  for (const f of files) {
    // Skip Base64 binary assets — never useful as prompt context.
    if (f.content.startsWith("data:")) {
      parts.push(`### ${f.name} (binary asset, omitted)`);
      continue;
    }
    const clipped =
      f.content.length > maxCharsPerFile
        ? `${f.content.slice(0, maxCharsPerFile)}\n… (truncated)`
        : f.content;
    parts.push(`### ${f.name} (${f.language})\n\`\`\`${f.language}\n${clipped}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** Just the file names, for a lightweight "what files exist" line. */
export function fileList(files: DCodeFile[]): string {
  if (files.length === 0) return "(none)";
  return files.map((f) => f.name).join(", ");
}

/**
 * Parses proposed file edits out of an agent response. We accept two shapes,
 * checked in order:
 *
 *   1. A fenced JSON block tagged with a `dashy-edits` info string, or a
 *      bare ```json block whose payload is `{ "edits": [ { name, content } ] }`.
 *   2. Any fenced code block immediately preceded by a filename hint on the
 *      prior line — e.g. "**src/app.ts**" or "File: src/app.ts" or a bare
 *      `path/to/file.ts` line. The fence's info string supplies the language.
 *
 * Returns [] when nothing parseable is found (caller shows the raw text).
 */
export function parseProposedEdits(response: string): ProposedEdit[] {
  const edits = parseJsonEdits(response);
  if (edits.length > 0) return edits;
  return parseFencedEdits(response);
}

function parseJsonEdits(response: string): ProposedEdit[] {
  // ```dashy-edits … ``` or ```json … ``` containing { edits: [...] }
  const fenceRe = /```(?:dashy-edits|json)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(response)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const arr = extractEditArray(parsed);
      if (arr.length > 0) return arr;
    } catch {
      // Not JSON edits — keep scanning.
    }
  }
  return [];
}

function extractEditArray(parsed: unknown): ProposedEdit[] {
  const candidate =
    parsed && typeof parsed === "object" && "edits" in parsed
      ? (parsed as { edits: unknown }).edits
      : parsed;
  if (!Array.isArray(candidate)) return [];
  const out: ProposedEdit[] = [];
  for (const item of candidate) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).name === "string" &&
      typeof (item as Record<string, unknown>).content === "string"
    ) {
      const rec = item as Record<string, unknown>;
      out.push({
        name: String(rec.name),
        content: String(rec.content),
        language:
          typeof rec.language === "string" ? String(rec.language) : undefined,
      });
    }
  }
  return out;
}

const FILENAME_RE = /[\w./-]+\.[A-Za-z0-9]+/;

function parseFencedEdits(response: string): ProposedEdit[] {
  const lines = response.split("\n");
  const out: ProposedEdit[] = [];
  let i = 0;
  while (i < lines.length) {
    const fenceMatch = /^```([\w.-]*)\s*$/.exec(lines[i].trim());
    if (!fenceMatch) {
      i++;
      continue;
    }
    // Collect the block body until the closing fence.
    const lang = fenceMatch[1] || undefined;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^```/.test(lines[j].trim())) {
      body.push(lines[j]);
      j++;
    }
    // Look back up to 2 non-empty lines for a filename hint.
    const name = findFilenameHint(lines, i);
    if (name) {
      out.push({
        name,
        content: body.join("\n").replace(/\s+$/, "") + "\n",
        language: lang,
      });
    }
    i = j + 1;
  }
  return out;
}

function findFilenameHint(lines: string[], fenceIndex: number): string | null {
  for (let k = fenceIndex - 1; k >= 0 && k >= fenceIndex - 3; k--) {
    const line = lines[k].trim();
    if (!line) continue;
    // "File: src/app.ts", "**src/app.ts**", "`src/app.ts`", bare "src/app.ts"
    const cleaned = line
      .replace(/^#+\s*/, "")
      .replace(/^\*\*|\*\*$/g, "")
      .replace(/^`|`$/g, "")
      .replace(/^File:\s*/i, "")
      .replace(/^Filename:\s*/i, "")
      .trim()
      .replace(/[:*`]+$/, "")
      .trim();
    const m = FILENAME_RE.exec(cleaned);
    if (m && (cleaned === m[0] || /file|path/i.test(line) || /^[*`]/.test(line))) {
      return m[0];
    }
    // Stop if the line is clearly prose (long sentence).
    if (line.length > 80) return null;
  }
  return null;
}

/** Extracts the FIRST fenced code block's body (Pair Coder "apply"). */
export function firstCodeBlock(response: string): string | null {
  const m = /```[\w.-]*\s*\n([\s\S]*?)```/.exec(response);
  return m ? m[1].replace(/\s+$/, "") : null;
}
