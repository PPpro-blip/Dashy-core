"use client";

/**
 * DashyCore v7 — Settings.
 *
 * - Profile: avatar / name / email (read-only from Supabase Auth)
 * - Preferences: default model, theme (dark locked)
 * - Memory: documents list from Supabase `documents` (shared DocumentsList)
 * - Danger Zone: sign out, delete account (placeholder)
 *
 * Executive dark-mode aesthetic (zinc-900 / zinc-950).
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { useToast } from "@/components/Toast";
import { DocumentsList } from "@/components/DocumentsList";
import { MODELS, getModelById } from "@/lib/models";
import { getStoredModel, setStoredModel, MODEL_CHANGED_EVENT } from "@/lib/preferences";
import {
  getStoredElevenLabsKey,
  setStoredElevenLabsKey,
  getStoredElevenLabsVoiceId,
  setStoredElevenLabsVoiceId,
  speak,
  stopSpeech,
  onSpeechChange,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "@/lib/voice-engine";
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LockIcon,
  MoonIcon,
  SpeakerIcon,
  SquareIcon,
} from "@/components/icons";

interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
}

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "D";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [model, setModel] = useState<string>(() => getStoredModel());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [docsReloadKey, setDocsReloadKey] = useState(0);
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(DEFAULT_ELEVENLABS_VOICE_ID);
  const [keyVisible, setKeyVisible] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const toast = useToast();

  /* Load previously saved voice preferences (localStorage — BYOK, client-only). */
  useEffect(() => {
    setElevenLabsKey(getStoredElevenLabsKey());
    setElevenLabsVoiceId(getStoredElevenLabsVoiceId());
  }, []);

  /* Track whether the "Test voice" playback is currently speaking. */
  useEffect(() => {
    return onSpeechChange((state) => {
      setTestingVoice(state.id === "settings-voice-test" && state.status !== "idle");
    });
  }, []);

  const handleSaveVoiceKey = () => {
    setStoredElevenLabsKey(elevenLabsKey);
    setStoredElevenLabsVoiceId(elevenLabsVoiceId || DEFAULT_ELEVENLABS_VOICE_ID);
    toast.success(
      elevenLabsKey.trim() ? "ElevenLabs key saved" : "ElevenLabs key cleared",
      elevenLabsKey.trim()
        ? "Dashy will use premium ElevenLabs narration for spoken replies."
        : "Dashy will keep using the built-in zero-key neural voice."
    );
  };

  const handleClearVoiceKey = () => {
    setElevenLabsKey("");
    setStoredElevenLabsKey("");
    toast.info("ElevenLabs key removed", "Back to the built-in voice engine — no key required.");
  };

  const handleTestVoice = () => {
    if (testingVoice) {
      stopSpeech();
      return;
    }
    void speak(
      "Hi, I'm Dashy. This is a preview of your current voice settings — no API key required, but yours makes me sound even better.",
      { id: "settings-voice-test" }
    );
  };

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const supabase = createClient();
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (cancelled || !authUser) return;
        const name =
          (authUser.user_metadata?.full_name as string | undefined) ||
          (authUser.user_metadata?.name as string | undefined) ||
          authUser.email?.split("@")[0] ||
          "pro player";
        setUser({
          name,
          email: authUser.email ?? "",
          avatarUrl: (authUser.user_metadata?.avatar_url as string | undefined) ?? null,
          initials: initialsFor(name, authUser.email ?? ""),
        });
      } catch {
        // Degrade gracefully.
      }
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeModel = getModelById(model);

  /* Stay in sync with the header's model selector. */
  useEffect(() => {
    const onModelChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ model?: string }>).detail;
      if (detail?.model) setModel(detail.model);
    };
    window.addEventListener(MODEL_CHANGED_EVENT, onModelChanged);
    return () => window.removeEventListener(MODEL_CHANGED_EVENT, onModelChanged);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Manage your profile, preferences, workspace memory and account.
      </p>

      {/* ------------------------------- Profile ------------------------------ */}
      <section className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Profile
        </h2>
        <div className="mt-4 flex items-center gap-4">
          {user?.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt={user.name}
              width={56}
              height={56}
              className="h-14 w-14 rounded-full object-cover ring-2 ring-zinc-800"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-lg font-semibold text-white ring-2 ring-white/[0.08]">
              {user?.initials ?? "D"}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-zinc-100">
              {user?.name ?? "Loading…"}
            </p>
            <p className="truncate text-sm text-zinc-500">{user?.email ?? "—"}</p>
          </div>
        </div>
        <p className="mt-4 rounded-lg border border-white/[0.06] bg-black/20 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-500">
          Name and email come from your Supabase auth account and are read-only
          here. To change them, update your auth user metadata in the Supabase
          dashboard.
        </p>
      </section>

      {/* ----------------------------- Preferences ---------------------------- */}
      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Preferences
        </h2>

        <div className="mt-5 space-y-5">
          {/* Default model */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Default model</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Used for new conversations.
              </p>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-white/[0.16]"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: activeModel.accent }}
                />
                {activeModel.label}
                <ChevronDownIcon
                  className={`h-3 w-3 text-zinc-500 transition-transform ${
                    modelMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {modelMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close model selector"
                    tabIndex={-1}
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setModelMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/[0.08] bg-[#131731] p-1.5 shadow-2xl shadow-black/70">
                    {MODELS.map((m) => {
                      const Icon = m.Icon;
                      const isSelected = m.id === model;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setModel(m.id);
                            setStoredModel(m.id);
                            setModelMenuOpen(false);
                            toast.success(
                              "Default model updated",
                              `${m.label} will be used for new chats.`
                            );
                          }}
                          className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                            isSelected ? "bg-cyan-500/10" : "hover:bg-white/[0.04]"
                          }`}
                        >
                          <span
                            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{ backgroundColor: `${m.accent}1f`, color: m.accent }}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                              {m.label}
                              {isSelected && (
                                <CheckIcon className="h-3.5 w-3.5 text-cyan-400" />
                              )}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">
                              {m.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Theme */}
          <div className="flex items-center justify-between gap-4 border-t border-zinc-800/60 pt-5">
            <div>
              <p className="text-sm font-medium text-zinc-200">Theme</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Light mode is not available yet.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300">
              <MoonIcon className="h-3.5 w-3.5 text-cyan-400" />
              Dark
              <LockIcon className="h-3 w-3 text-zinc-600" />
              <span className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                Locked
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------- Voice -------------------------------- */}
      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Voice
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Every reply can be read aloud with the built-in{" "}
              <span className="text-zinc-300">zero-key neural voice engine</span> —
              it works instantly for everyone, no setup required.
            </p>
          </div>
          <span className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300">
            <CheckIcon className="h-3 w-3" />
            Active — no key needed
          </span>
        </div>

        <div className="mt-5 space-y-4 border-t border-zinc-800/60 pt-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <KeyIcon className="h-3.5 w-3.5 text-cyan-400" />
              Optional: upgrade to ElevenLabs
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Paste your own ElevenLabs API key for ultra-realistic premium
              narration. Stored only in this browser and sent per-request to
              our proxy — never saved on our servers. Leave it blank to keep
              using the free built-in voice.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <input
                type={keyVisible ? "text" : "password"}
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                placeholder="sk_… (optional ElevenLabs API key)"
                aria-label="ElevenLabs API key"
                className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 pr-9 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50"
              />
              <button
                type="button"
                onClick={() => setKeyVisible((v) => !v)}
                aria-label={keyVisible ? "Hide API key" : "Show API key"}
                title={keyVisible ? "Hide API key" : "Show API key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-200"
              >
                {keyVisible ? (
                  <EyeOffIcon className="h-3.5 w-3.5" />
                ) : (
                  <EyeIcon className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <input
              type="text"
              value={elevenLabsVoiceId}
              onChange={(e) => setElevenLabsVoiceId(e.target.value)}
              placeholder="Voice ID (optional)"
              aria-label="ElevenLabs voice id"
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-cyan-400/50 sm:w-40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveVoiceKey}
              className="rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleClearVoiceKey}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-red-400/30 hover:text-red-300"
            >
              Clear key
            </button>
            <button
              type="button"
              onClick={handleTestVoice}
              className="ml-auto flex items-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3.5 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-400/20"
            >
              {testingVoice ? (
                <SquareIcon className="h-3.5 w-3.5" />
              ) : (
                <SpeakerIcon className="h-3.5 w-3.5" />
              )}
              {testingVoice ? "Stop" : "Test voice"}
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------- Memory ------------------------------- */}
      <section
        id="memory"
        className="mt-6 scroll-mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Memory
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Documents you&apos;ve uploaded are chunked, embedded and made
              searchable by Dashy.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDocsReloadKey((key) => key + 1)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4">
          <DocumentsList reloadKey={docsReloadKey} />
        </div>
      </section>

      {/* ----------------------------- Danger Zone ----------------------------- */}
      <section className="mt-6 rounded-2xl border border-red-500/20 bg-white/[0.02] p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-red-400/90">
          <AlertIcon className="h-4 w-4" />
          Danger Zone
        </h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Sign out</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              End this session on this device.
            </p>
          </div>
          <SignOutButton />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Delete account</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Permanently remove your account and memory. Contact support for
              now.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Account deletion is not available yet"
            className="cursor-not-allowed rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-600"
          >
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}
