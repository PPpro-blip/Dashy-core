/**
 * DashyCore v7 — Dashy Extensions: persisted preferences (localStorage).
 *
 * Enable/disable state, the selected theme and the format-on-save flag all
 * live in localStorage for speed and offline resilience. Nothing here
 * stores GitHub tokens — those only ever exist in the Supabase session and
 * are consumed server-side by app/api/github/[...path]/route.ts.
 */

const ENABLED_KEY = "dashy.dcode.extensions.enabled";
/** Ids the host has already offered to this user (so a user-disabled
 * extension is NOT silently re-enabled on the next load, while a brand-new
 * built-in still defaults to enabled). */
const SEEN_KEY = "dashy.dcode.extensions.seen";
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
 * Ids of enabled extensions. Unknown ids are ignored by the host; a missing
 * key means "all built-ins enabled except the ones that ship disabled by
 * default" (e.g. Ghost Suggestions). Persisted as a JSON string array under
 * `dashy.dcode.extensions.enabled`.
 */
export function getEnabledExtensionIds(
  allIds: string[],
  defaultDisabled: string[] = []
): string[] {
  const off = new Set(defaultDisabled);
  const stored = readJson(ENABLED_KEY);
  const seenRaw = readJson(SEEN_KEY);
  const seen = new Set(
    Array.isArray(seenRaw) ? seenRaw.filter((x): x is string => typeof x === "string") : []
  );

  if (!Array.isArray(stored)) {
    // First run: everything on except the default-disabled set. Record that
    // all current built-ins have now been offered.
    writeJson(SEEN_KEY, [...allIds]);
    return allIds.filter((id) => !off.has(id));
  }

  const known = new Set(allIds);
  const enabled = stored.filter(
    (id): id is string => typeof id === "string" && known.has(id)
  );
  // Auto-enable only built-ins the user has never been offered (brand-new),
  // and never a default-disabled one. A user-disabled extension stays off
  // because it is already in `seen`.
  const newlySeen: string[] = [];
  for (const id of allIds) {
    if (!seen.has(id)) {
      newlySeen.push(id);
      if (!enabled.includes(id) && !off.has(id)) enabled.push(id);
    }
  }
  if (newlySeen.length > 0) writeJson(SEEN_KEY, [...seen, ...newlySeen]);
  return enabled;
}

export function setExtensionEnabledState(id: string, enabled: boolean): void {
  const stored = readJson(ENABLED_KEY);
  const list = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
  const next = enabled
    ? [...new Set([...list, id])]
    : list.filter((x) => x !== id);
  writeJson(ENABLED_KEY, next);
  // Mark seen so getEnabledExtensionIds never re-enables a user-disabled id.
  const seenRaw = readJson(SEEN_KEY);
  const seen = Array.isArray(seenRaw)
    ? seenRaw.filter((x): x is string => typeof x === "string")
    : [];
  if (!seen.includes(id)) writeJson(SEEN_KEY, [...seen, id]);
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
