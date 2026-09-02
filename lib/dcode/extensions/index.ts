import registry from "./registry.json";

export interface DashyExtension {
  id: string;
  name: string;
  author: string;
  description: string;
  tags: string[];
  version: string;
  entry: string;
}

export const EXTENSIONS_STORAGE_KEY = "dashycore:dcode:extensions:v1";
export const EXTENSIONS_HONEST_COPY =
  "Curated web-safe extensions. VS Code .vsix and Node-only extensions like Cline/Roo Code do not run in a browser IDE — Dashy ships web-native equivalents below.";

export const extensionRegistry = registry as DashyExtension[];

export function getEnabledExtensionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(EXTENSIONS_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export function setExtensionEnabled(id: string, enabled: boolean): string[] {
  const next = new Set(getEnabledExtensionIds());
  if (enabled) next.add(id); else next.delete(id);
  const ids = [...next];
  if (typeof window !== "undefined") window.localStorage.setItem(EXTENSIONS_STORAGE_KEY, JSON.stringify(ids));
  return ids;
}
