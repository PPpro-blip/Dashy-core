"use client";

/**
 * DashyCore — Settings → Voice (ElevenLabs).
 *
 * Holds the user's own ElevenLabs API key + preferred voice for the chat
 * "Read aloud" speaker. The key lives in THIS browser's localStorage only;
 * each speak request relays it to /api/voice/elevenlabs as a header and the
 * server forwards it to ElevenLabs without storing it. Leave it empty to use
 * the workspace key (ELEVENLABS_API_KEY) when the server has one.
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { CheckIcon, EyeIcon, KeyIcon, SpeakerIcon, SpeakerOffIcon, TrashIcon } from "@/components/icons";
import {
  DEFAULT_VOICE_ID,
  ELEVENLABS_CHANGED_EVENT,
  readElevenLabsKey,
  readElevenLabsVoice,
  speak,
  stopSpeaking,
  VOICE_PRESETS,
  writeElevenLabsKey,
  writeElevenLabsVoice,
  type SpeakState,
} from "@/lib/voice-elevenlabs";

const TEST_LINE =
  "Hey, I'm DashyCore. This is how your answers will sound from now on — natural, clear, and ready when you are.";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

export function ElevenLabsSettings() {
  const toast = useToast();
  const [keyInput, setKeyInput] = useState("");
  const [storedKey, setStoredKey] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [customVoice, setCustomVoice] = useState("");
  const [testState, setTestState] = useState<SpeakState>("idle");

  useEffect(() => {
    const sync = () => {
      const key = readElevenLabsKey();
      setStoredKey(key);
      const voice = readElevenLabsVoice();
      setVoiceId(voice);
      setCustomVoice(VOICE_PRESETS.some((p) => p.id === voice) ? "" : voice);
    };
    sync();
    window.addEventListener(ELEVENLABS_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(ELEVENLABS_CHANGED_EVENT, sync);
      stopSpeaking();
    };
  }, []);

  const saveKey = useCallback(() => {
    const value = keyInput.trim();
    if (!value) {
      toast.error("Nothing to save", "Paste your ElevenLabs API key first.");
      return;
    }
    if (!/^[A-Za-z0-9_\-]{20,128}$/.test(value)) {
      toast.error("That doesn't look like an ElevenLabs key", "Copy it from elevenlabs.io → Profile → API keys.");
      return;
    }
    writeElevenLabsKey(value);
    setKeyInput("");
    setRevealed(false);
    toast.success("ElevenLabs key saved", "Stored in this browser only.");
  }, [keyInput, toast]);

  const removeKey = useCallback(() => {
    writeElevenLabsKey(null);
    setKeyInput("");
    toast.info("Key removed", "The workspace key (if configured) will be used instead.");
  }, [toast]);

  const chooseVoice = useCallback(
    (id: string) => {
      setVoiceId(id);
      setCustomVoice("");
      writeElevenLabsVoice(id);
    },
    []
  );

  const saveCustomVoice = useCallback(() => {
    const id = customVoice.trim();
    if (!/^[A-Za-z0-9]{8,40}$/.test(id)) {
      toast.error("Invalid voice ID", "Voice IDs are 8–40 letters/digits (ElevenLabs → Voices → ID).");
      return;
    }
    setVoiceId(id);
    writeElevenLabsVoice(id);
    toast.success("Custom voice selected");
  }, [customVoice, toast]);

  const test = useCallback(() => {
    if (testState !== "idle") {
      stopSpeaking();
      return;
    }
    speak("settings-voice-test", TEST_LINE, (state, error) => {
      setTestState(state === "error" ? "idle" : state);
      if (state === "error" && error) toast.error("Voice test failed", error.message, 7000);
    });
  }, [testState, toast]);

  return (
    <div className="mt-5 space-y-5">
      {/* API key */}
      <div>
        <label htmlFor="elevenlabs-key" className="text-sm font-medium text-zinc-200">
          ElevenLabs API Key
        </label>
        <p className="mt-0.5 text-xs text-zinc-500">
          {storedKey ? (
            <>
              Using your key <span className="font-mono text-zinc-400">{maskKey(storedKey)}</span>.
            </>
          ) : (
            <>Optional — without it the workspace key is used if the server has one.</>
          )}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 focus-within:border-cyan-400/50">
            <KeyIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
            <input
              id="elevenlabs-key"
              type={revealed ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveKey();
              }}
              placeholder={storedKey ? "Paste a new key to replace" : "sk_…"}
              className="h-10 min-w-0 flex-1 bg-transparent font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              title={revealed ? "Hide key" : "Show key"}
              aria-label={revealed ? "Hide key" : "Show key"}
              className="rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <EyeIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={saveKey}
            className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-colors hover:bg-cyan-400"
          >
            <CheckIcon className="h-3.5 w-3.5" />
            Save
          </button>
          {storedKey && (
            <button
              type="button"
              onClick={removeKey}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Voice */}
      <div className="border-t border-zinc-800/60 pt-5">
        <p className="text-sm font-medium text-zinc-200">Voice</p>
        <p className="mt-0.5 text-xs text-zinc-500">Used by the speaker icon on every AI reply.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VOICE_PRESETS.map((preset) => {
            const selected = voiceId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => chooseVoice(preset.id)}
                aria-pressed={selected}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                  selected
                    ? "border-cyan-400/50 bg-cyan-400/[0.08] shadow-[0_0_18px_-6px] shadow-cyan-400/50"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-violet-400/40"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-100">
                  {preset.name}
                  {selected && <CheckIcon className="h-3.5 w-3.5 text-cyan-400" />}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">{preset.description}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={customVoice}
            onChange={(e) => setCustomVoice(e.target.value)}
            placeholder="Custom / cloned voice ID"
            aria-label="Custom voice ID"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/20 px-3 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400/50"
          />
          <button
            type="button"
            onClick={saveCustomVoice}
            disabled={!customVoice.trim()}
            className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
          >
            Use ID
          </button>
          <button
            type="button"
            onClick={test}
            className="flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20"
          >
            {testState === "loading" ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-cyan-400/30 border-t-cyan-300" />
            ) : testState === "playing" ? (
              <SpeakerOffIcon className="h-3.5 w-3.5" />
            ) : (
              <SpeakerIcon className="h-3.5 w-3.5" />
            )}
            {testState === "idle" ? "Test voice" : "Stop"}
          </button>
        </div>
      </div>
    </div>
  );
}
