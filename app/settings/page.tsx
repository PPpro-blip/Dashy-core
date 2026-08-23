"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/components/AuthProvider";
import {
  applyAccent,
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type DashySettings,
} from "@/lib/ui/auth";
import { DASHY_MODELS, type DashyModelId } from "@/lib/ui/models";

type TabId =
  | "general"
  | "appearance"
  | "models"
  | "data"
  | "memory"
  | "account";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  {
    id: "general",
    label: "General",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r=".5" />
        <circle cx="17.5" cy="10.5" r=".5" />
        <circle cx="8.5" cy="7.5" r=".5" />
        <circle cx="6.5" cy="12.5" r=".5" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      </svg>
    ),
  },
  {
    id: "models",
    label: "Models",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
      </svg>
    ),
  },
  {
    id: "data",
    label: "Data Controls",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: "memory",
    label: "RAG / Memory",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "account",
    label: "Account",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

const ACCENTS = [
  { id: "cyan" as const, color: "#00f2fe", label: "Cyan" },
  { id: "purple" as const, color: "#9b51e0", label: "Purple" },
];

const TIMEZONES = [
  "UTC",
  "Asia/Calcutta",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी (Hindi)" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "ja", label: "日本語" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("general");
  const [settings, setSettings] = useState<DashySettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<
    "delete-chats" | "clear-memories" | null
  >(null);
  const { toast } = useToast();
  const { user, signOut } = useAuth();

  useEffect(() => {
    setSettings(getSettings());
    setHydrated(true);
  }, []);

  const update = (patch: Partial<DashySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    if ("accent" in patch || "accentCustom" in patch) {
      applyAccent(next);
    }
  };

  const memoriesCount = 128; // Mock — RAG store count preview.

  if (!hydrated) {
    return (
      <div className="settings-page">
        <div className="settings-content">
          <div className="dcode-skeleton" style={{ maxWidth: 480 }}>
            <div className="dcode-skeleton-line" style={{ width: "35%" }} />
            <div className="dcode-skeleton-line" style={{ width: "70%" }} />
            <div className="dcode-skeleton-line" style={{ width: "55%" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      {/* Left tab nav */}
      <nav className="settings-nav" aria-label="Settings sections">
        <h2 className="settings-nav-heading">Settings</h2>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-tab${tab === t.id ? " active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
        <Link href="/" className="settings-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Back to chat</span>
        </Link>
      </nav>

      {/* Content */}
      <div className="settings-content">
        {tab === "general" && (
          <section className="settings-pane" key="general">
            <h1 className="settings-pane-title">General</h1>
            <p className="settings-pane-desc">
              Core preferences for your DashyCore workspace.
            </p>

            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Language</span>
                  <span className="settings-row-desc">Interface language.</span>
                </div>
                <select
                  className="settings-select"
                  value={settings.language}
                  onChange={(e) => update({ language: e.target.value })}
                  aria-label="Language"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Timezone</span>
                  <span className="settings-row-desc">Used for timestamps and scheduling.</span>
                </div>
                <select
                  className="settings-select"
                  value={settings.timezone}
                  onChange={(e) => update({ timezone: e.target.value })}
                  aria-label="Timezone"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Default theme</span>
                  <span className="settings-row-desc">Dark is optimized for the obsidian UI.</span>
                </div>
                <div className="theme-options">
                  {(["dark", "system"] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={`theme-option${settings.theme === theme ? " selected" : ""}`}
                      onClick={() => update({ theme })}
                    >
                      {theme === "dark" ? "🌙 Dark" : "🖥 System"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "appearance" && (
          <section className="settings-pane" key="appearance">
            <h1 className="settings-pane-title">Appearance</h1>
            <p className="settings-pane-desc">
              Personalize how DashyCore looks and feels.
            </p>

            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Theme</span>
                  <span className="settings-row-desc">Choose dark or follow your system.</span>
                </div>
                <div className="theme-options">
                  {(["dark", "system"] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={`theme-option${settings.theme === theme ? " selected" : ""}`}
                      onClick={() => update({ theme })}
                    >
                      {theme === "dark" ? "🌙 Dark" : "🖥 System"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Accent color</span>
                  <span className="settings-row-desc">Applied live across the interface.</span>
                </div>
                <div className="accent-options">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      className={`accent-swatch${settings.accent === accent.id ? " selected" : ""}`}
                      style={{ background: accent.color, color: accent.color }}
                      title={accent.label}
                      aria-label={`Accent ${accent.label}`}
                      onClick={() => update({ accent: accent.id })}
                    />
                  ))}
                  <input
                    type="color"
                    className="accent-custom"
                    title="Custom accent"
                    aria-label="Custom accent color"
                    value={settings.accentCustom}
                    onChange={(e) =>
                      update({ accent: "custom", accentCustom: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "models" && (
          <section className="settings-pane" key="models">
            <h1 className="settings-pane-title">Models</h1>
            <p className="settings-pane-desc">
              Configure DASH routing defaults and agent behavior.
            </p>

            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Default DASH model</span>
                  <span className="settings-row-desc">Preselected for every new conversation.</span>
                </div>
                <select
                  className="settings-select"
                  value={settings.defaultModel}
                  onChange={(e) =>
                    update({ defaultModel: e.target.value as DashyModelId })
                  }
                  aria-label="Default model"
                >
                  {DASHY_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Agent Mode by default</span>
                  <span className="settings-row-desc">
                    Start conversations with the GLM-5 agent pipeline active.
                  </span>
                </div>
                <button
                  type="button"
                  className="toggle-switch"
                  role="switch"
                  aria-checked={settings.agentModeDefault}
                  aria-label="Agent Mode by default"
                  onClick={() => update({ agentModeDefault: !settings.agentModeDefault })}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Max tool iterations</span>
                  <span className="settings-row-desc">
                    Upper bound on agentic tool calls per turn.
                  </span>
                </div>
                <div className="slider-row">
                  <input
                    type="range"
                    className="settings-slider"
                    min={1}
                    max={10}
                    step={1}
                    value={settings.maxToolIterations}
                    onChange={(e) =>
                      update({ maxToolIterations: Number(e.target.value) })
                    }
                    aria-label="Max tool iterations"
                  />
                  <span className="slider-value">{settings.maxToolIterations}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "data" && (
          <section className="settings-pane" key="data">
            <h1 className="settings-pane-title">Data Controls</h1>
            <p className="settings-pane-desc">
              Manage what DashyCore stores about your activity.
            </p>

            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Chat history</span>
                  <span className="settings-row-desc">
                    Save conversations so you can revisit them later.
                  </span>
                </div>
                <button
                  type="button"
                  className="toggle-switch"
                  role="switch"
                  aria-checked={settings.chatHistory}
                  aria-label="Chat history"
                  onClick={() => update({ chatHistory: !settings.chatHistory })}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Delete all conversations</span>
                  <span className="settings-row-desc">
                    Permanently remove all chat history from this device.
                  </span>
                </div>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setConfirmDialog("delete-chats")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete all
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === "memory" && (
          <section className="settings-pane" key="memory">
            <h1 className="settings-pane-title">RAG / Memory</h1>
            <p className="settings-pane-desc">
              Control the knowledge DashyCore retrieves when answering.
            </p>

            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Stored memories</span>
                  <span className="settings-row-desc">
                    Knowledge chunks available for retrieval.
                  </span>
                </div>
                <span className="stat-chip">{memoriesCount} chunks</span>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Similarity threshold</span>
                  <span className="settings-row-desc">
                    Minimum relevance score (0.5 – 0.9) for retrieved context.
                  </span>
                </div>
                <div className="slider-row">
                  <input
                    type="range"
                    className="settings-slider"
                    min={0.5}
                    max={0.9}
                    step={0.01}
                    value={settings.similarityThreshold}
                    onChange={(e) =>
                      update({ similarityThreshold: Number(e.target.value) })
                    }
                    aria-label="Similarity threshold"
                  />
                  <span className="slider-value">
                    {settings.similarityThreshold.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Clear all memories</span>
                  <span className="settings-row-desc">
                    Remove every stored memory chunk. This cannot be undone.
                  </span>
                </div>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setConfirmDialog("clear-memories")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Clear all
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === "account" && (
          <section className="settings-pane" key="account">
            <h1 className="settings-pane-title">Account</h1>
            <p className="settings-pane-desc">
              Your profile and session controls.
            </p>

            <div className="settings-group">
              <div className="settings-row">
                <div className="user-profile-card" style={{ padding: 0 }}>
                  <span className="user-avatar" aria-hidden="true">
                    {(user?.name ?? "?")
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="user-profile-info">
                    <span className="user-profile-name">{user?.name ?? "Guest"}</span>
                    <span className="user-profile-email">{user?.email ?? "Not signed in"}</span>
                  </div>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">User ID</span>
                  <span className="settings-row-desc">Stable identifier sent with chat requests.</span>
                </div>
                <span className="stat-chip" style={{ fontSize: 11 }}>
                  {user?.id?.slice(0, 13) ?? "—"}…
                </span>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Sign out</span>
                  <span className="settings-row-desc">
                    End this session on this device.
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    signOut();
                    toast("Signed out.", "info");
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div
          className="dialog-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setConfirmDialog(null)}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="dialog-title">
              {confirmDialog === "delete-chats"
                ? "Delete all conversations?"
                : "Clear all memories?"}
            </h2>
            <p className="dialog-body">
              {confirmDialog === "delete-chats"
                ? "This will permanently remove your entire chat history on this device. This action cannot be undone."
                : "This will permanently remove all stored RAG memory chunks. The assistant will no longer retrieve them. This action cannot be undone."}
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  setConfirmDialog(null);
                  toast(
                    confirmDialog === "delete-chats"
                      ? "All conversations deleted."
                      : "All memories cleared.",
                    "success"
                  );
                }}
              >
                Yes, continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}