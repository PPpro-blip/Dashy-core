/**
 * DashyCore v7 — Zero-key embedded voice engine.
 *
 * Every Dashy reply can be read aloud with ZERO configuration:
 *   1. Optional upgrade  — if the user saved a personal ElevenLabs API key
 *      in Settings, `speak()` calls our `/api/voice` proxy which streams
 *      back real ElevenLabs neural audio (BYOK — the key never touches our
 *      servers persistently, it's forwarded per-request only).
 *   2. Built-in fallback — with NO key configured (the default for every
 *      user), `speak()` uses the browser's native `SpeechSynthesis` engine,
 *      auto-selecting the best available neural/natural voice (Google US
 *      English, Microsoft "Natural" voices, Apple/Siri voices, …).
 *
 * The proxy is designed to NEVER surface an error to the caller: any
 * missing key / bad key / upstream failure resolves as a "fallback" signal
 * and this module transparently drops back to the embedded engine instead.
 *
 * Only one utterance plays at a time — starting a new one stops whatever
 * is currently speaking. Callers can subscribe via `onSpeechChange` to
 * know which logical id (e.g. a chat message id) is currently playing.
 */

const ELEVENLABS_KEY_STORAGE = "dashycore:elevenlabs-key";
const ELEVENLABS_VOICE_STORAGE = "dashycore:elevenlabs-voice-id";

/** ElevenLabs' public "Rachel" premade voice — a sane default. */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/* ========================================================================== */
/* Stored preferences (BYOK — never sent anywhere except our own proxy)       */
/* ========================================================================== */

export function getStoredElevenLabsKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ELEVENLABS_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setStoredElevenLabsKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = key.trim();
    if (trimmed) {
      window.localStorage.setItem(ELEVENLABS_KEY_STORAGE, trimmed);
    } else {
      window.localStorage.removeItem(ELEVENLABS_KEY_STORAGE);
    }
  } catch {
    // Storage unavailable — preference is session-only.
  }
}

export function getStoredElevenLabsVoiceId(): string {
  if (typeof window === "undefined") return DEFAULT_ELEVENLABS_VOICE_ID;
  try {
    return (
      window.localStorage.getItem(ELEVENLABS_VOICE_STORAGE) || DEFAULT_ELEVENLABS_VOICE_ID
    );
  } catch {
    return DEFAULT_ELEVENLABS_VOICE_ID;
  }
}

export function setStoredElevenLabsVoiceId(voiceId: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = voiceId.trim();
    if (trimmed) window.localStorage.setItem(ELEVENLABS_VOICE_STORAGE, trimmed);
    else window.localStorage.removeItem(ELEVENLABS_VOICE_STORAGE);
  } catch {
    // Session-only fallback.
  }
}

/* ========================================================================== */
/* Built-in browser neural voice selection                                    */
/* ========================================================================== */

/** Preferred voice names, in priority order — the highest-quality "Natural"/neural voices on each platform. */
const PREFERRED_VOICE_NAMES = [
  "google us english",
  "microsoft aria online (natural)",
  "microsoft ava online (natural)",
  "microsoft jenny online (natural)",
  "microsoft guy online (natural)",
  "microsoft andrew online (natural)",
  "samantha",
  "daniel",
  "google uk english female",
  "google uk english male",
  "microsoft zira",
  "microsoft david",
  "microsoft mark",
];

/** Picks the best embedded browser voice available — prefers neural/natural, then any English voice. */
export function pickEmbeddedVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;
  for (const wanted of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name.toLowerCase().includes(wanted));
    if (match) return match;
  }
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const enUs = english.find((v) => v.lang?.toLowerCase() === "en-us");
  return enUs ?? english[0] ?? voices[0] ?? null;
}

/** Strips markdown syntax so the built-in/neural engine doesn't read out symbols. */
export function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " image. ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/>\s?/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ========================================================================== */
/* Single active-playback coordinator                                         */
/* ========================================================================== */

export type SpeechStatus = "idle" | "loading" | "playing" | "error";

interface SpeechState {
  id: string | null;
  status: SpeechStatus;
}

let state: SpeechState = { id: null, status: "idle" };
let activeAudio: HTMLAudioElement | null = null;
let generation = 0;

const listeners = new Set<(state: SpeechState) => void>();

function notify() {
  listeners.forEach((cb) => cb(state));
}

function setState(next: SpeechState) {
  state = next;
  notify();
}

export function onSpeechChange(cb: (state: SpeechState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getSpeechState(): SpeechState {
  return state;
}

/** Stops whatever is currently speaking (ElevenLabs audio or browser TTS). */
export function stopSpeech(): void {
  generation += 1;
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {
      // Best-effort cleanup only.
    }
    activeAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  setState({ id: null, status: "idle" });
}

/**
 * Requests real ElevenLabs audio through our zero-crash proxy. Resolves to
 * `null` (never throws) whenever the upgrade path isn't available, so the
 * caller can transparently fall back to the embedded engine.
 */
async function fetchElevenLabsAudio(text: string): Promise<Blob | null> {
  const apiKey = getStoredElevenLabsKey();
  if (!apiKey) return null;

  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        apiKey,
        voiceId: getStoredElevenLabsVoiceId(),
      }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && contentType.includes("audio")) {
      return await response.blob();
    }
    // Any non-audio response (missing key, bad key, quota, network hiccup on
    // the ElevenLabs side) is a deliberate "fallback" signal, never an error.
    return null;
  } catch {
    return null;
  }
}

function speakWithBrowser(
  text: string,
  id: string,
  onDone: () => void
): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    setState({ id: null, status: "error" });
    onDone();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();

  const myGeneration = generation;
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 3000));
  const voice = pickEmbeddedVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.lang = voice?.lang ?? "en-US";

  utterance.onstart = () => {
    if (myGeneration !== generation) return;
    setState({ id, status: "playing" });
  };
  utterance.onend = () => {
    if (myGeneration !== generation) return;
    setState({ id: null, status: "idle" });
    onDone();
  };
  utterance.onerror = () => {
    if (myGeneration !== generation) return;
    setState({ id: null, status: "idle" });
    onDone();
  };

  synth.speak(utterance);
}

/**
 * Speaks `text` aloud. Tries the optional ElevenLabs upgrade first (only if
 * the user configured a key), and ALWAYS falls back to the zero-key
 * built-in browser neural voice on any failure — never throws, never
 * leaves the caller without audio.
 */
export async function speak(
  text: string,
  options: { id?: string } = {}
): Promise<void> {
  const clean = text.trim();
  if (!clean) return;

  stopSpeech();
  const myGeneration = generation;
  const id = options.id ?? `speech-${Date.now()}`;

  setState({ id, status: "loading" });

  const blob = await fetchElevenLabsAudio(clean);
  if (myGeneration !== generation) return; // superseded while we awaited

  if (blob) {
    try {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudio = audio;
      audio.onplay = () => {
        if (myGeneration !== generation) return;
        setState({ id, status: "playing" });
      };
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (activeAudio === audio) activeAudio = null;
      };
      audio.onended = () => {
        cleanup();
        if (myGeneration !== generation) return;
        setState({ id: null, status: "idle" });
      };
      audio.onerror = () => {
        cleanup();
        if (myGeneration !== generation) return;
        // Playback failed mid-stream — degrade to the embedded engine.
        speakWithBrowser(clean, id, () => undefined);
      };
      await audio.play();
      return;
    } catch {
      // Autoplay / decode failure — fall through to the embedded engine.
    }
  }

  speakWithBrowser(clean, id, () => undefined);
}
