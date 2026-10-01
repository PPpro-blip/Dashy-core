/**
 * DashyCore v7 — Simple unified line diff (LCS-based) for the Source
 * Control panel. Not a Myers-perfect diff, but a clear, correct line diff:
 * adds (+), removes (−) and context lines.
 */

export interface DiffLine {
  kind: "ctx" | "add" | "del";
  /** 1-based line number in the old text (context/removed lines). */
  oldLine?: number;
  /** 1-based line number in the new text (context/added lines). */
  newLine?: number;
  text: string;
}

/** Cap: files larger than this are reported instead of diffed. */
export const MAX_DIFF_LINES = 1200;

/**
 * Unified diff of two texts. Resolves null when the diff would be too
 * expensive (large files) — callers show a friendly message instead.
 */
export function unifiedDiff(oldText: string, newText: string): DiffLine[] | null {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  // Trailing empty line from a final newline — drop it like git does.
  if (oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines[newLines.length - 1] === "") newLines.pop();

  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return null;
  }

  const n = oldLines.length;
  const m = newLines.length;

  // Classic LCS via DP over lines. (n*m guarded by the cap above.)
  const dp: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const cell = i * (m + 1) + j;
      if (oldLines[i] === newLines[j]) {
        dp[cell] = dp[(i + 1) * (m + 1) + j + 1] + 1;
      } else {
        dp[cell] = Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: "ctx", oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
      out.push({ kind: "del", oldLine: i + 1, text: oldLines[i] });
      i++;
    } else {
      out.push({ kind: "add", newLine: j + 1, text: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", oldLine: i + 1, text: oldLines[i] });
    i++;
  }
  while (j < m) {
    out.push({ kind: "add", newLine: j + 1, text: newLines[j] });
    j++;
  }
  return out;
}
