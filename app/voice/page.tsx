"use client";

/**
 * DashyCore v7 — Voice chat (Web Speech API, zero backend).
 *
 * - SpeechRecognition → speech-to-text (browser STT)
 * - SpeechSynthesis → text-to-speech (browser TTS)
 * - A large centered cyan orb that pulses while listening / thinking / speaking
 * - 5 named voice presets (Noah / James / Galileo / Aria / Nova) mapped to the
 *   browser's available voices (preferring English) with custom rate/pitch.
 *
 * The transcribed phrase is sent to the SAME dashy-flow-state worker contract
 * as chat (`{ message, model, userId, agentMode, history }`), using the user's
 * default model preference; the reply is spoken aloud with the selected voice.
 *
 * All `window.speechSynthesis` / `SpeechRecognition` access happens client-side
 * (guarded so SSR never touches the Web Speech globals).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChatClientError, sendChatMessage } from "@/lib/chat-client";
import { getStoredModel } from "@/lib/preferences";
import { MicIcon, SquareIcon } from "@/components/icons";

type VoicePresetId = "noah" | "james" | "galileo" | "aria" | "nova";

interface VoicePreset {
  id: VoicePresetId;
  name: string;
  rate: number;
  pitch: number;
  description: string;
}

const VOICE_PRESETS: VoicePreset[] = [
  { id: "noah", name: "Noah", rate: 0.9, pitch: 0.7, description: "Deep, slow" },
  { id: "james", name: "James", rate: 1.0, pitch: 1.0, description: "Clear, standard" },
  { id: "galileo", name: "Galileo", rate: 0.85, pitch: 0.85, description: "Wise, slower" },
  { id: "aria", name: "Aria", rate: 1.1, pitch: 1.3, description: "Higher, energetic" },
  { id: "nova", name: "Nova", rate: 1.0, pitch: 1.15, description: "Smooth, mid" },
];

interface VoiceTurn {
  role: "user" | "assistant";
  text: string;
}

/** Picks the best available voice for a preset — prefer English, then en-US. */
function pickVoice(
  voices: SpeechSynthesisVoice[],
  preset: VoicePreset
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const enUs = english.filter((v) => v.lang?.toLowerCase() === "en-us");
  const byName = english.find((v) =>
    v.name.toLowerCase().includes(preset.name.toLowerCase())
  );
  return byName ?? enUs[0] ?? english[0] ?? voices[0] ?? null;
}

export default function VoicePage() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [presetId, setPresetId] = useState<VoicePresetId>("james");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const preset = VOICE_PRESETS.find((p) => p.id === presetId) ?? VOICE_PRESETS[1];

  /* ------------------------- auth + default model ------------------------- */

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!cancelled && user) setUserId(user.id);
      } catch {
        // Auth is best-effort — the layout already guards this route.
      }
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------- load available voices ------------------------ */

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;

    const syncVoices = () => {
      const list = synth.getVoices();
      if (list.length > 0) setVoices(list);
    };
    syncVoices();
    synth.addEventListener("voiceschanged", syncVoices);
    return () => synth.removeEventListener("voiceschanged", syncVoices);
  }, []);

  /* ------------------------------ speech aloud ---------------------------- */

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const synth = window.speechSynthesis;
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(synth.getVoices(), preset);
      if (voice) utterance.voice = voice;
      utterance.rate = preset.rate;
      utterance.pitch = preset.pitch;
      utterance.lang = voice?.lang ?? "en-US";
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      synth.speak(utterance);
    },
    [preset]
  );

  /* ---------------------------- send to worker ---------------------------- */

  const sendToWorker = useCallback(
    async (text: string) => {
      if (!text.trim() || isThinking) return;
      setError(null);
      setIsThinking(true);

      // Append the user turn (mirrors live).
      setTurns((prev) => [...prev, { role: "user", text }]);

      const model = getStoredModel();
      let authToken: string | undefined;
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        authToken = session?.access_token;
      } catch {
        // Token is best-effort; the client falls back to localStorage.
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Same contract as text chat: full prior-turn history, default model.
      const history = turns
        .filter((t) => t.role === "user" || t.role === "assistant")
        .map((t) => ({ role: t.role, content: t.text }));

      try {
        const result = await sendChatMessage(
          {
            message: text,
            model,
            userId: userId ?? undefined,
            agentMode: false,
            history,
            authToken,
            signal: controller.signal,
          },
          {}
        );
        const reply = result.content.trim();
        setTurns((prev) => [...prev, { role: "assistant", text: reply }]);
        speak(reply);
      } catch (error) {
        if (error instanceof ChatClientError && error.kind === "aborted") {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Could not reach the worker. Please try again.";
        setTurns((prev) => [
          ...prev,
          { role: "assistant", text: `⚠️ ${message}` },
        ]);
        setError(message);
      } finally {
        setIsThinking(false);
        abortControllerRef.current = null;
      }
    },
    [isThinking, speak, turns, userId]
  );

  /* --------------------------- speech recognition ------------------------- */

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError(
        "Voice input isn't supported in this browser. Try Chrome or Edge."
      );
      return;
    }
    if (isListening || isSpeaking || isThinking) return;

    stopSpeaking();
    setError(null);
    setInterim("");

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // Captured across onresult → onend so we never read stale state.
    let finalTranscript = "";

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText) {
        finalTranscript = finalText.trim();
        setInterim(finalTranscript);
      } else {
        setInterim(interimText);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError(
          "Microphone access was denied. Allow the mic in your browser and try again."
        );
      } else if (event.error === "no-speech") {
        setError("No speech detected. Tap to speak again.");
      } else if (event.error !== "aborted") {
        setError(`Microphone error: ${event.error}.`);
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      setInterim("");
      const finalText = finalTranscript;
      if (finalText) {
        void sendToWorker(finalText);
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setError("Could not start the microphone. Please try again.");
    }
  }, [isListening, isSpeaking, isThinking, sendToWorker, stopSpeaking]);

  /* Clean up on unmount. */
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      abortControllerRef.current?.abort();
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /* -------------------------------- render -------------------------------- */

  const active = isListening || isSpeaking || isThinking;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="flex flex-col items-center">
        {/* Orb */}
        <div className="relative flex h-44 w-44 items-center justify-center">
          {/* Pulsing ping ring while active */}
          {active && (
            <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/25" />
          )}
          {/* Glow */}
          <span
            className={`absolute inset-2 rounded-full bg-cyan-500/20 blur-2xl ${
              active ? "animate-pulse" : ""
            }`}
          />
          {/* Core orb */}
          <button
            type="button"
            onClick={active && isListening ? stopListening : startListening}
            aria-label={
              isListening ? "Stop listening" : "Tap to speak"
            }
            title={
              isListening
                ? "Stop listening"
                : "Tap to speak to Dashy"
            }
            className={`relative z-10 flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 via-cyan-500 to-violet-500 shadow-2xl shadow-cyan-500/40 transition-transform hover:scale-105 ${
              active ? "animate-pulse" : ""
            }`}
          >
            {isThinking ? (
              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
            ) : (
              <MicIcon className="h-11 w-11 text-[#06202a]" />
            )}
          </button>
          {/* Indicator label */}
          <p className="absolute -bottom-8 text-xs font-medium tracking-wide text-zinc-500">
            {isListening
              ? "Listening…"
              : isThinking
                ? "Thinking…"
                : isSpeaking
                  ? "Speaking…"
                  : "Tap to speak"}
          </p>
        </div>

        {/* Voice selector */}
        <div className="mt-14 w-full max-w-sm">
          <label
            htmlFor="voice-selector"
            className="mb-2 block text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500"
          >
            Voice
          </label>
          <select
            id="voice-selector"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value as VoicePresetId)}
            disabled={isListening || isThinking || isSpeaking}
            aria-label="Choose a voice"
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-400/50 disabled:opacity-50"
          >
            {VOICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#0d1220]">
                {p.name} — {p.description}
              </option>
            ))}
          </select>
          <p className="mt-2 text-center text-[11px] text-zinc-600">
            {voices.length > 0
              ? `${voices.length} browser voice${voices.length === 1 ? "" : "s"} available · ${preset.name}, ${preset.rate}× rate, ${preset.pitch} pitch`
              : "Loading available voices…"}
          </p>
        </div>

        {/* Mic permission / error */}
        {error && (
          <p
            role="alert"
            className="mt-4 w-full max-w-sm rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs leading-relaxed text-red-300"
          >
            {error}
          </p>
        )}

        {/* Speak / Stop controls */}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={isThinking || isSpeaking}
            className="flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MicIcon className="h-4 w-4" />
            {isListening ? "Stop listening" : "Tap to speak"}
          </button>
          {isSpeaking && (
            <button
              type="button"
              onClick={stopSpeaking}
              className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-5 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
            >
              <SquareIcon className="h-4 w-4" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Live transcript + responses */}
      <div className="mt-12 w-full max-w-2xl space-y-3">
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Conversation
        </p>
        {turns.length === 0 && !interim && (
          <p className="text-center text-sm text-zinc-600">
            Tap the orb and speak — your words turn into chat, and Dashy reads
            the reply back.
          </p>
        )}
        {interim && (
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-tr-sm border border-cyan-400/15 bg-cyan-500/10 px-4 py-3 text-sm text-zinc-100">
              <span className="mr-1.5 text-[10px] text-zinc-500">you</span>
              {interim}
            </div>
          </div>
        )}
        {turns.map((turn, index) => {
          const isUser = turn.role === "user";
          return (
            <div
              key={index}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  isUser
                    ? "rounded-tr-sm border border-cyan-400/15 bg-cyan-500/10 text-zinc-100"
                    : "rounded-tl-sm border border-white/[0.06] bg-white/[0.02] text-zinc-100"
                }`}
              >
                <span className="mr-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  {isUser ? "you" : preset.name}
                </span>
                {turn.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
