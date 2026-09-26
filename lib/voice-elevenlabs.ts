/**
 * DashyCore — ElevenLabs voice engine (browser side).
 *
 *   - Settings storage: the user's own ElevenLabs key + preferred voice,
 *     kept in THIS browser's localStorage only. The key is relayed per
 *     request to our same-origin proxy (/api/voice/elevenlabs) as the
 *     `x-elevenlabs-api-key` header and never persisted server-side. When no
 *     personal key is set, the server's ELEVENLABS_API_KEY is used.
 *   - speechTextFromMarkdown(): turns an assistant bubble's markdown into
 *     speakable prose (no code dumps, no URLs, no table pipes).
 *   - speak(): ONE global player. Starts playback on the first streamed MP3
 *     chunks via MediaSource where supported (Chrome/Edge/Firefox, Safari
 *     via ManagedMediaSource), else buffers to a Blob. When the Settings and
 *     server keys are both absent, it falls back to browser SpeechSynthesis.
 */

export const ELEVENLABS_KEY_STORAGE = "dashy.elevenlabs.key";
export const ELEVENLABS_VOICE_STORAGE = "dashy.elevenlabs.voice";
export const ELEVENLABS_CHANGED_EVENT = "dashy:elevenlabs-changed";
const PROXY_ENDPOINT = "/api/voice/elevenlabs";
/** Mirrors MAX_TEXT_CHARS in the proxy route. */
export const MAX_SPEECH_CHARS = 5000;

export interface VoicePreset {
  id: string;
  name: string;
  description: string;
}

/** ElevenLabs premade voices (available on every account). */
export const VOICE_PRESETS: VoicePreset[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Calm American, conversational" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: "Warm British narrator" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", description: "Soft, confident American" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "Deep, resonant American" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", description: "Smooth Swedish-English" },
  { id: "9BWtsMINqrJLrRacOk9x", name: "Aria", description: "Expressive American" },
];
/** ElevenLabs Rachel is the stable default when the caller sends no voice id. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const KEY_REQUIRED_MESSAGE = "ElevenLabs API Key required in Settings";

/* ------------------------------------------------------------------------ */
/* Storage                                                                   */
/* ------------------------------------------------------------------------ */

function read(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable — session-only.
  }
  window.dispatchEvent(new CustomEvent(ELEVENLABS_CHANGED_EVENT));
}

export const readElevenLabsKey = (): string => read(ELEVENLABS_KEY_STORAGE).trim();
export const writeElevenLabsKey = (value: string | null): void =>
  write(ELEVENLABS_KEY_STORAGE, value?.trim() || null);
export const readElevenLabsVoice = (): string =>
  read(ELEVENLABS_VOICE_STORAGE).trim() || DEFAULT_VOICE_ID;
export const writeElevenLabsVoice = (value: string | null): void =>
  write(ELEVENLABS_VOICE_STORAGE, value?.trim() || null);

/* ------------------------------------------------------------------------ */
/* Markdown → speech                                                          */
/* ------------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------------ */
/* Player                                                                     */
/* ------------------------------------------------------------------------ */

export type SpeakState = "loading" | "playing" | "idle" | "error";

/** Optional settings used only when native browser speech is the fallback. */
export interface BrowserSpeechFallback {
  voiceName?: string;
  rate?: number;
  pitch?: number;
}

export class VoiceEngineError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VoiceEngineError";
    this.status = status;
  }
}

interface ActivePlayback {
  id: string;
  audio: HTMLAudioElement;
  controller: AbortController;
  objectUrl: string | null;
  onState: (state: SpeakState, error?: VoiceEngineError) => void;
  done: boolean;
}

let active: ActivePlayback | null = null;

type MediaSourceCtor = typeof MediaSource;

/** MediaSource (or Safari's ManagedMediaSource) that can take audio/mpeg. */
function mpegMediaSource(): MediaSourceCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    MediaSource?: MediaSourceCtor;
    ManagedMediaSource?: MediaSourceCtor;
  };
  for (const Ctor of [w.MediaSource, w.ManagedMediaSource]) {
    try {
      if (Ctor && typeof Ctor.isTypeSupported === "function" && Ctor.isTypeSupported("audio/mpeg")) {
        return Ctor;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

function finish(playback: ActivePlayback, state: SpeakState, error?: VoiceEngineError): void {
  if (playback.done) return;
  playback.done = true;
  playback.controller.abort();
  try {
    playback.audio.pause();
    playback.audio.removeAttribute("src");
    playback.audio.load();
  } catch {
    // ignore teardown errors
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (playback.objectUrl) URL.revokeObjectURL(playback.objectUrl);
  if (active === playback) active = null;
  playback.onState(state, error);
}

/** Stops whatever is currently being spoken (no-op when silent). */
export function stopSpeaking(): void {
  if (active) finish(active, "idle");
}

/** Id of the utterance currently loading/playing, if any. */
export function activeSpeechId(): string | null {
  return active?.id ?? null;
}

async function errorFromResponse(response: Response): Promise<VoiceEngineError> {
  let message = `Voice engine error (${response.status}).`;
  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) message = data.error;
  } catch {
    // keep default
  }
  return new VoiceEngineError(message, response.status);
}

function speakWithBrowserFallback(
  playback: ActivePlayback,
  text: string,
  fallback?: BrowserSpeechFallback
): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    finish(playback, "error", new VoiceEngineError("Browser speech synthesis is unavailable.", 0));
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const selectedVoice = fallback?.voiceName
    ? synth.getVoices().find((voice) => voice.name === fallback.voiceName)
    : null;
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || "en-US";
  if (fallback?.rate) utterance.rate = fallback.rate;
  if (fallback?.pitch) utterance.pitch = fallback.pitch;
  utterance.onstart = () => {
    if (!playback.done) playback.onState("playing");
  };
  utterance.onend = () => finish(playback, "idle");
  utterance.onerror = () => {
    if (!playback.done) finish(playback, "error", new VoiceEngineError("Browser speech could not play this response.", 0));
  };
  synth.speak(utterance);
}

/**
 * Speaks `text` through the ElevenLabs proxy. MUST be called from a user
 * gesture (click) — playback is primed synchronously so autoplay policies
 * accept it even though audio arrives asynchronously.
 */
export function speak(
  id: string,
  text: string,
  onState: (state: SpeakState, error?: VoiceEngineError) => void,
  browserFallback?: BrowserSpeechFallback
): void {
  stopSpeaking();
  const clean = text.trim();
  if (!clean) {
    onState("error", new VoiceEngineError("Nothing to read aloud in this message.", 400));
    return;
  }

  const audio = new Audio();
  audio.preload = "auto";
  const playback: ActivePlayback = {
    id,
    audio,
    controller: new AbortController(),
    objectUrl: null,
    onState,
    done: false,
  };
  active = playback;
  onState("loading");

  audio.addEventListener("playing", () => {
    if (!playback.done) onState("playing");
  });
  audio.addEventListener("ended", () => finish(playback, "idle"));
  audio.addEventListener("error", () => {
    if (!playback.done && audio.getAttribute("src")) {
      finish(playback, "error", new VoiceEngineError("The browser could not play this audio.", 0));
    }
  });

  const MS = mpegMediaSource();
  let mediaSource: MediaSource | null = null;
  if (MS) {
    mediaSource = new MS();
    playback.objectUrl = URL.createObjectURL(mediaSource);
    // ManagedMediaSource requires this to be off to stream on iOS.
    (audio as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
    audio.src = playback.objectUrl;
    // Prime playback inside the gesture; it resolves once data arrives.
    void audio.play().catch(() => undefined);
  }

  const key = readElevenLabsKey();
  const request = fetch(PROXY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-elevenlabs-api-key": key } : {}),
    },
    body: JSON.stringify({ text: clean, voice_id: readElevenLabsVoice() }),
    signal: playback.controller.signal,
  });

  void (async () => {
    try {
      const response = await request;
      if (!response.ok || !response.body) throw await errorFromResponse(response);

      if (mediaSource) {
        await streamIntoMediaSource(mediaSource, response.body, playback);
        return;
      }

      // Fallback: buffer the whole MP3, then play.
      const blob = await response.blob();
      if (playback.done) return;
      playback.objectUrl = URL.createObjectURL(new Blob([blob], { type: "audio/mpeg" }));
      audio.src = playback.objectUrl;
      await audio.play();
    } catch (error) {
      if (playback.done) return;
      if ((error as { name?: string }).name === "AbortError") {
        finish(playback, "idle");
        return;
      }
      if ((error as { name?: string }).name === "NotAllowedError") {
        finish(playback, "error", new VoiceEngineError("Your browser blocked autoplay — tap the speaker again.", 0));
        return;
      }
      if (error instanceof VoiceEngineError && error.message === KEY_REQUIRED_MESSAGE) {
        // The route deliberately reports this cleanly; keep Voice usable with
        // the native browser speech engine instead of leaving the user silent.
        speakWithBrowserFallback(playback, clean, browserFallback);
        return;
      }
      finish(
        playback,
        "error",
        error instanceof VoiceEngineError
          ? error
          : new VoiceEngineError(error instanceof Error ? error.message : "Voice playback failed.", 0)
      );
    }
  })();
}

async function streamIntoMediaSource(
  mediaSource: MediaSource,
  body: ReadableStream<Uint8Array>,
  playback: ActivePlayback
): Promise<void> {
  if (mediaSource.readyState !== "open") {
    await new Promise<void>((resolve) =>
      mediaSource.addEventListener("sourceopen", () => resolve(), { once: true })
    );
  }
  if (playback.done) return;
  const buffer = mediaSource.addSourceBuffer("audio/mpeg");
  const waitIdle = () =>
    buffer.updating
      ? new Promise<void>((resolve) => buffer.addEventListener("updateend", () => resolve(), { once: true }))
      : Promise.resolve();

  const reader = body.getReader();
  let started = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (playback.done) {
      void reader.cancel().catch(() => undefined);
      return;
    }
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    await waitIdle();
    buffer.appendBuffer(value as BufferSource);
    if (!started) {
      started = true;
      void playback.audio.play().catch((error: { name?: string }) => {
        if (error?.name === "NotAllowedError") {
          finish(
            playback,
            "error",
            new VoiceEngineError("Your browser blocked autoplay — tap the speaker again.", 0)
          );
        }
      });
    }
  }
  await waitIdle();
  if (mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
    } catch {
      // already ended
    }
  }
  if (!started) {
    finish(playback, "error", new VoiceEngineError("ElevenLabs returned no audio.", 0));
  }
}
