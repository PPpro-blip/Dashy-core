/**
 * DashyCore v7 — Share Hub composer model.
 *
 * A master caption plus optional per-platform overrides. The master caption
 * seeds every variant, but the user always owns the final text for each
 * platform: once a variant is edited it stops following the master.
 */

import type { ProviderId, ShareProvider } from "@/lib/share/providers";

export interface ComposerState {
  caption: string;
  hashtags: string;
  mentions: string;
  url: string;
  /** Per-platform overrides. Absent = follows the master caption. */
  variants: Partial<Record<ProviderId, string>>;
}

export function emptyComposer(url = ""): ComposerState {
  return { caption: "", hashtags: "", mentions: "", url, variants: {} };
}

/** Normalizes "#one two, #three" into "#one #two #three". */
export function normalizeHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((tag) => `#${tag}`);
}

export function normalizeMentions(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((m) => m.trim().replace(/^@+/, ""))
    .filter(Boolean)
    .map((m) => `@${m}`);
}

/** The caption body for a platform: its override, or the master caption. */
export function captionFor(state: ComposerState, id: ProviderId): string {
  return state.variants[id] ?? state.caption;
}

export function isVariantOverridden(state: ComposerState, id: ProviderId): boolean {
  return state.variants[id] !== undefined;
}

/**
 * Final text handed to a platform: caption + mentions + hashtags.
 * The URL is passed separately because most intents take a `url` field.
 */
export function composeText(
  state: ComposerState,
  provider: ShareProvider
): string {
  const parts: string[] = [];
  const body = captionFor(state, provider.id).trim();
  if (body) parts.push(body);

  const mentions = provider.id === "x" || provider.id === "instagram"
    ? normalizeMentions(state.mentions)
    : [];
  const hashtags = normalizeHashtags(state.hashtags);

  const tail = [...mentions, ...hashtags].join(" ").trim();
  if (tail) parts.push(tail);

  return parts.join("\n\n");
}

/** Full preview text — what the post will look like, URL included. */
export function composePreview(
  state: ComposerState,
  provider: ShareProvider
): string {
  const text = composeText(state, provider);
  const url = state.url.trim();
  if (!url) return text;
  if (provider.prefill.text && provider.prefill.url) {
    return [text, url].filter(Boolean).join("\n\n");
  }
  if (!provider.prefill.text) {
    // Caption has to be pasted by hand; the link is what the platform gets.
    return [text, url].filter(Boolean).join("\n\n");
  }
  return [text, url].filter(Boolean).join("\n\n");
}

export function overLimit(text: string, provider: ShareProvider): boolean {
  return !!provider.charLimit && text.length > provider.charLimit;
}

/** A sensible starting caption derived from the source — never fabricated data. */
export function suggestCaption(title: string, typeLabel: string): string {
  const clean = title.trim();
  if (!clean) return "";
  if (typeLabel === "Studio asset") {
    return `${clean}\n\nMade with DashyCore Studio.`;
  }
  if (typeLabel === "D-Code project") {
    return `${clean} — built in DashyCore D-Code.`;
  }
  return clean;
}
