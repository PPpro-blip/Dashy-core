/**
 * DashyCore v7 — Dashy Extensions: persisted preferences (localStorage).
 *
 * Enable/disable state, the selected theme and the format-on-save flag all
 * live in localStorage for speed and offline resilience. Nothing here
 * stores GitHub tokens — those only ever exist in the Supabase session and
 * are consumed server-side by app/api/github/[...path]/route.ts.
 */

const ENABLED_KEY = "dashy.dcode.extensions.enabled";
const THEME_KEY = "dashy.dcode.theme";
const FORMAT_ON_SAVE_KEY = "dashy.dcode.prettier.formatOnSave";

/** Extension id → its per-extension storage namespace. */
const EXT_PREFIX = (extensionId: string) => `dashy.dcode.ext.${extensionId}.`;

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable — preference is session-only.
  }
}

/**
 * Ids of enabled extensions. Unknown ids are ignored by the host; missing
 * key means "all built-ins enabled" (the default for first-party packs).
 */
export function getEnabledExtensionIds(allIds: string[]): string[] {
  const stored = readJson(ENABLED_KEY);
  if (!Array.isArray(stored)) return [...allIds];
  const known = new Set(allIds);
  const enabled = stored.filter(
    (id): id is string => typeof id === "string" && known.has(id)
  );
  // Newly shipped built-ins default to enabled.
  for (const id of allIds) if (!enabled.includes(id)) enabled.push(id);
  return enabled;
}

export function setExtensionEnabledState(id: string, enabled: boolean): void {
  const stored = readJson(ENABLED_KEY);
  const list = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
  const next = enabled
    ? [...new Set([...list, id])]
    : list.filter((x) => x !== id);
  writeJson(ENABLED_KEY, next);
}

/* ------------------------------- theme -------------------------------- */

export function getStoredTheme(): string {
  if (typeof window === "undefined") return "dcode-obsidian";
  try {
    return window.localStorage.getItem(THEME_KEY) ?? "dcode-obsidian";
  } catch {
    return "dcode-obsidian";
  }
}

export function setStoredTheme(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_KEY, id);
  } catch {
    // Preference is session-only.
  }
}

/* ---------------------------- format on save -------------------------- */

export function getFormatOnSave(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FORMAT_ON_SAVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFormatOnSave(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FORMAT_ON_SAVE_KEY, enabled ? "1" : "0");
  } catch {
    // Preference is session-only.
  }
}

/* ----------------------- per-extension storage ------------------------ */

export function extensionStorageGet(extensionId: string, key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${EXT_PREFIX(extensionId)}${key}`);
  } catch {
    return null;
  }
}

export function extensionStorageSet(
  extensionId: string,
  key: string,
  value: string
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${EXT_PREFIX(extensionId)}${key}`, value);
  } catch {
    // Storage unavailable — preference is session-only.
  }
}
