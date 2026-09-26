/**
 * DashyCore v7 — zero-key embedded voice engine.
 *
 * Every user gets working text-to-speech out of the box, with NO API key:
 *
 *   1. If the user stored a personal ElevenLabs key in Settings, we POST the
 *      text to /api/voice, which proxies ElevenLabs and streams back mp3.
 *   2. Otherwise (or if that call fails for ANY reason) we silently fall back
 *      to the browser's built-in neural synthesizer (`window.speechSynthesis`)
 *      with automatic selection of the best premium/neural voice available
 *      (Google US English, Microsoft Natural, Safari/Apple neural voices…).
 *
 * The public surface is intentionally tiny: `speak()`, `stopSpeaking()` and
 * the ElevenLabs key preference helpers. Nothing here ever throws.
 */

/* ---------------------------------------------------------------------- */
/* ElevenLabs key preference (browser-only, opt-in upgrade)                */
/* ---------------------------------------------------------------------- */

const ELEVENLABS_KEY = "dashycore:elevenlabs-key";
const ELEVENLABS_VOICE_KEY = "dashycore:elevenlabs-voice-id";
export const VOICE_SETTINGS_CHANGED_EVENT = "dashy:voice-settings-changed";

/** Rachel — ElevenLabs' default public voice. */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export function getElevenLabsKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ELEVENLABS_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setElevenLabsKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) window.localStorage.setItem(ELEVENLABS_KEY, trimmed);
    else window.localStorage.removeItem(ELEVENLABS_KEY);
  } catch {
    // Storage unavailable — the built-in engine still works.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VOICE_SETTINGS_CHANGED_EVENT));
  }
}

export function getElevenLabsVoiceId(): string {
  if (typeof window === "undefined") return DEFAULT_ELEVENLABS_VOICE_ID;
  try {
    return (
      window.localStorage.getItem(ELEVENLABS_VOICE_KEY)?.trim() ||
      DEFAULT_ELEVENLABS_VOICE_ID
    );
  } catch {
    return DEFAULT_ELEVENLABS_VOICE_ID;
  }
}

export function setElevenLabsVoiceId(voiceId: string): void {
  try {
    const trimmed = voiceId.trim();
    if (trimmed) window.localStorage.setItem(ELEVENLABS_VOICE_KEY, trimmed);
    else window.localStorage.removeItem(ELEVENLABS_VOICE_KEY);
  } catch {
    // Non-fatal.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VOICE_SETTINGS_CHANGED_EVENT));
  }
}

/* ---------------------------------------------------------------------- */
/* Built-in neural voice selection                                         */
/* ---------------------------------------------------------------------- */

/**
 * Ranked preference list. Higher score wins; anything English still beats a
 * non-English voice, and we always return *something* when voices exist.
 */
const PREMIUM_VOICE_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /google us english/i, score: 100 },
  { pattern: /microsoft (aria|jenny|guy|michelle|ana)[^,]*natural/i, score: 95 },
  { pattern: /natural/i, score: 85 },
  { pattern: /neural/i, score: 85 },
  { pattern: /google uk english female/i, score: 80 },
  { pattern: /google/i, score: 70 },
  { pattern: /samantha|siri|ava|allison|premium|enhanced/i, score: 65 },
  { pattern: /microsoft/i, score: 40 },
];

/** Scores one voice; -1 means "unusable" (never happens, kept for clarity). */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  const lang = (voice.lang || "").toLowerCase();
  let score = 0;
  if (lang.startsWith("en")) score += 30;
  if (lang === "en-us") score += 10;
  if (voice.localService) score += 2;
  for (const { pattern, score: bonus } of PREMIUM_VOICE_PATTERNS) {
    if (pattern.test(voice.name)) {
      score += bonus;
      break;
    }
  }
  if (voice.default) score += 1;
  return score;
}

/** Picks the best available built-in neural voice (null when none exist). */
export function pickPremiumVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] ?? null;
}

/**
 * Chromium populates `getVoices()` asynchronously; resolve once the list is
 * ready (or after a short timeout — we speak with the default voice then).
 */
function loadVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const initial = synth.getVoices();
    if (initial.length > 0) {
      resolve(initial);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

/* ---------------------------------------------------------------------- */
/* Playback                                                                */
/* ---------------------------------------------------------------------- */

export type VoiceEngine = "elevenlabs" | "builtin" | "unsupported";

export interface SpeakOptions {
  /** Called when audio actually starts. */
  onStart?: () => void;
  /** Called when playback ends, is cancelled, or cannot start. */
  onEnd?: () => void;
  /** Which engine ended up being used (always reported before onEnd). */
  onEngine?: (engine: VoiceEngine) => void;
  rate?: number;
  pitch?: number;
}

let activeAudio: HTMLAudioElement | null = null;

/** Hard-stops whatever the voice engine is currently playing. */
export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Ignore — nothing was playing.
  }
  if (activeAudio) {
    try {
      activeAudio.pause();
      if (activeAudio.src.startsWith("blob:")) URL.revokeObjectURL(activeAudio.src);
    } catch {
      // Ignore.
    }
    activeAudio = null;
  }
}

/** Strips markdown so the synthesizer reads prose, not syntax. */
export function textForSpeech(markdown: string, maxChars = 4000): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " (image) ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxChars ? `${plain.slice(0, maxChars)}…` : plain;
}

/** Speaks with the built-in browser neural engine. Never throws. */
async function speakBuiltin(text: string, options: SpeakOptions): Promise<boolean> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  const voices = await loadVoices();
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickPremiumVoice(voices);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || "en-US";
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = () => options.onEnd?.();
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/** Tries the optional ElevenLabs upgrade; resolves false to fall back. */
async function speakElevenLabs(
  text: string,
  options: SpeakOptions
): Promise<boolean> {
  const apiKey = getElevenLabsKey();
  if (!apiKey) return false;
  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        apiKey,
        voiceId: getElevenLabsVoiceId(),
      }),
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("audio")) return false;
    const blob = await response.blob();
    if (blob.size === 0) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    audio.onplay = () => options.onStart?.();
    const cleanup = () => {
      if (activeAudio === audio) activeAudio = null;
      URL.revokeObjectURL(url);
      options.onEnd?.();
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    await audio.play();
    return true;
  } catch {
    // Network, decode, or autoplay failure → built-in engine takes over.
    return false;
  }
}

/**
 * Speaks `text` using the best engine available, with zero configuration.
 * Resolves with the engine that actually produced audio.
 */
export async function speak(
  rawText: string,
  options: SpeakOptions = {}
): Promise<VoiceEngine> {
  const text = textForSpeech(rawText);
  if (!text) {
    options.onEnd?.();
    return "unsupported";
  }

  stopSpeaking();

  if (await speakElevenLabs(text, options)) {
    options.onEngine?.("elevenlabs");
    return "elevenlabs";
  }

  if (await speakBuiltin(text, options)) {
    options.onEngine?.("builtin");
    return "builtin";
  }

  options.onEngine?.("unsupported");
  options.onEnd?.();
  return "unsupported";
}

/** True when the browser can synthesize speech locally (SSR-safe). */
export function isBuiltinVoiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
