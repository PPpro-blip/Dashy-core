/**
 * DashyCore v7 — reasoning-block guard.
 *
 * Some routed models emit hidden reasoning inside <think>…</think> (or
 * <thinking>…</thinking>) before the real answer. That is never the user's
 * answer, so it is stripped from the rendered bubble and surfaced only as a
 * clean, high-level status ("Thinking…").
 *
 * Streaming-safe: an UNCLOSED opening tag means the model is still thinking,
 * so everything after it is withheld until the block closes.
 */

const BLOCK_RE = /<(think|thinking|reasoning)>([\s\S]*?)<\/\1>/gi;
const OPEN_RE = /<(think|thinking|reasoning)>([\s\S]*)$/i;

export interface SplitThinking {
  /** Safe-to-render answer text. */
  visible: string;
  /** True while a reasoning block is still open (model is thinking). */
  isThinking: boolean;
}

export function splitThinking(raw: string): SplitThinking {
  if (!raw || raw.indexOf("<") === -1) {
    return { visible: raw, isThinking: false };
  }

  // Remove every completed reasoning block.
  let visible = raw.replace(BLOCK_RE, "");

  // An unterminated block means the tail is still hidden reasoning.
  let isThinking = false;
  const open = OPEN_RE.exec(visible);
  if (open) {
    visible = visible.slice(0, open.index);
    isThinking = true;
  }

  return { visible: visible.trimStart(), isThinking };
}
