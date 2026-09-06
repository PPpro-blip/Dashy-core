"use client";

/**
 * DashyCore v7 — Share Hub preferences (localStorage).
 *
 * Remembers the last share destination (app) plus the last caption and tags
 * so "Share now" can act as a true one-tap action on desktop: when the OS
 * share sheet isn't available, it opens the LAST-USED app composer already
 * prefilled instead of making the user re-pick and re-type every time.
 *
 * Key: `dashy.share.prefs`. Written ONLY after a composer is actually
 * confirmed — no fake success states, nothing recorded on cancel.
 */

import type { ShareAppId, ShareDraft } from "@/lib/share-intents";

const PREFS_KEY = "dashy.share.prefs";

export interface SharePrefs {
  /** Last app the user confirmed a share composer for (null = never). */
  destination: ShareAppId | null;
  /** Last caption text (prefills the next composer). */
  caption?: string;
  /** Last tags (prefill the next composer). */
  tags?: string[];
}

export function getSharePrefs(): SharePrefs {
  if (typeof window === "undefined") return { destination: null };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { destination: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { destination: null };
    const rec = parsed as Partial<SharePrefs>;
    return {
      destination: typeof rec.destination === "string" ? (rec.destination as ShareAppId) : null,
      caption: typeof rec.caption === "string" ? rec.caption : undefined,
      tags: Array.isArray(rec.tags)
        ? rec.tags.filter((t): t is string => typeof t === "string")
        : undefined,
    };
  } catch {
    return { destination: null };
  }
}

/** Persists the last-used destination + caption + tags (best-effort). */
export function saveSharePrefs(prefs: SharePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the hub still works, just without the shortcut.
  }
}

/**
 * Seeds a fresh share draft with the remembered caption/tags (if any).
 * The project title, share URL and images always come from the project.
 */
export function applyPrefsToDraft(
  draft: ShareDraft,
  prefs: SharePrefs
): ShareDraft {
  const caption = prefs.caption?.trim();
  const tags =
    prefs.tags && prefs.tags.length > 0 ? prefs.tags.map((t) => t) : undefined;
  if (!caption && !tags) return draft;
  return {
    ...draft,
    caption: caption || draft.caption,
    tags: tags ?? draft.tags,
  };
}
