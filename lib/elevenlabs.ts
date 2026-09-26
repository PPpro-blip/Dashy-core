/** Browser-only ElevenLabs preference helpers. The key never goes to Supabase. */
export const ELEVENLABS_KEY_STORAGE = "dashy.elevenlabs.key";
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

export function getElevenLabsKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ELEVENLABS_KEY_STORAGE)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setElevenLabsKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    if (key.trim()) window.localStorage.setItem(ELEVENLABS_KEY_STORAGE, key.trim());
    else window.localStorage.removeItem(ELEVENLABS_KEY_STORAGE);
  } catch {
    // Settings remains usable when localStorage is disabled.
  }
}
