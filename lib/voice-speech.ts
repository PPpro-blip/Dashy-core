/**
 * DashyCore — keyless speech-text utilities.
 *
 * speechTextFromMarkdown() turns an assistant bubble's markdown into
 * speakable prose (no code dumps, no URLs, no table pipes) and clamps it at
 * a sentence boundary under the TTS proxy's character cap. It is engine
 * agnostic: the chat "read aloud" speaker feeds the result to the keyless
 * /api/voice proxy, and any future pre-generated persona audio pipeline can
 * reuse it when preparing scripts.
 *
 * No API keys live here — ElevenLabs is an offline asset-generation
 * dependency for persona audio, never a runtime user-key API.
 */

/** Mirrors the text cap in the /api/voice proxy route. */
export const MAX_SPEECH_CHARS = 5000;

/** Strips markdown to natural, speakable text (clamped at a sentence end). */
export function speechTextFromMarkdown(markdown: string, max = MAX_SPEECH_CHARS): string {
  let text = markdown
    // Fenced code → a short spoken note (reading code aloud is noise).
    .replace(/```[\s\S]*?(```|$)/g, " (code block omitted) ")
    // Images → their alt text; links → their label.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? ` ${alt.replace(/<IMG>\s*/i, "Image: ")} ` : " "))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Bare URLs.
    .replace(/https?:\/\/\S+/g, " link ")
    // Inline code, HTML tags.
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    // Headings, blockquotes, list bullets, numbered lists.
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, heading: string) => `${heading.trim()}.`)
    .replace(/^\s{0,3}>\s?/gm, "")
    // Tables: drop separator rows; each row becomes one comma-separated line.
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) =>
      `${row.split("|").map((cell) => cell.trim()).filter(Boolean).join(", ")}.`
    )
    // List bullets / numbers: speak each item as its own sentence.
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.*)$/gm, (_m, item: string) =>
      /[.!?:;]$/.test(item.trim()) ? item.trim() : `${item.trim()}.`
    )
    .replace(/\s*\|\s*/g, ", ")
    // Emphasis / strike markers.
    .replace(/(\*\*|\*|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[\s(])(__?)(?=\S)([^\n]*?\S)\2(?=[\s).,!?:;]|$)/g, "$1$3")
    // Horizontal rules.
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    // Tidy punctuation: "!." → "!", ".." → ".", " ," → ",", double spaces.
    .replace(/([!?])\s*\.+/g, "$1 ")
    .replace(/\.(?:\s*\.)+/g, ". ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/([.,!?])(?=[^\s\d.,!?)])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,.\s]+/, "")
    .trim();

  if (text.length > max) {
    const slice = text.slice(0, max);
    const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    text = (end > max * 0.6 ? slice.slice(0, end + 1) : slice).trim();
  }
  return text;
}
