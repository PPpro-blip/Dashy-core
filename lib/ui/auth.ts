/**
 * DashyCore v7 — Client-side auth & settings helpers.
 *
 * UI-ONLY fake auth session backed by localStorage.
 * Keys:
 *   dashy_auth   = "true" when signed in
 *   dashy_user   = JSON { id, name, email }
 *   dashy_settings = JSON DashySettings
 */

export interface DashyUser {
  id: string;
  name: string;
  email: string;
}

export interface DashySettings {
  language: string;
  timezone: string;
  theme: "dark" | "system";
  accent: "cyan" | "purple" | "custom";
  accentCustom: string;
  defaultModel: string;
  agentModeDefault: boolean;
  maxToolIterations: number;
  chatHistory: boolean;
  similarityThreshold: number;
}

export const DEFAULT_SETTINGS: DashySettings = {
  language: "en",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  theme: "dark",
  accent: "cyan",
  accentCustom: "#00f2fe",
  defaultModel: "dashy-allround",
  agentModeDefault: false,
  maxToolIterations: 5,
  chatHistory: true,
  similarityThreshold: 0.7,
};

const AUTH_KEY = "dashy_auth";
const USER_KEY = "dashy_user";
const SETTINGS_KEY = "dashy_settings";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — ignore silently.
  }
}

export function isAuthenticated(): boolean {
  return safeGet(AUTH_KEY) === "true";
}

export function getUser(): DashyUser | null {
  const raw = safeGet(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DashyUser>;
    if (!parsed.email) return null;
    return {
      id: typeof parsed.id === "string" ? parsed.id : "local-user",
      name: typeof parsed.name === "string" ? parsed.name : parsed.email.split("@")[0],
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

/** Stable per-browser user id used as `userId` in chat requests. */
export function getUserId(): string {
  let id = safeGet("dashy_uid");
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `uid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    safeSet("dashy_uid", id);
  }
  return id;
}

export function signIn(email: string, name?: string): DashyUser {
  const derivedName =
    name?.trim() ||
    email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const user: DashyUser = {
    id: getUserId(),
    name: derivedName,
    email,
  };
  safeSet(AUTH_KEY, "true");
  safeSet(USER_KEY, JSON.stringify(user));
  return user;
}

export function signOut(): void {
  try {
    window.localStorage.removeItem(AUTH_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // Ignore.
  }
}

export function getSettings(): DashySettings {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DashySettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DashySettings): void {
  safeSet(SETTINGS_KEY, JSON.stringify(settings));
}

/** Apply the accent color to the document root (live theming). */
export function applyAccent(settings: DashySettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (settings.accent === "cyan") {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--accent-glow");
  } else {
    const hex =
      settings.accent === "purple" ? "#9b51e0" : settings.accentCustom || "#00f2fe";
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--accent-hover", hex);
    root.style.setProperty("--accent-soft", `${hex}1f`);
    root.style.setProperty("--accent-glow", `${hex}40`);
  }
}