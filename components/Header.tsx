"use client";

/**
 * DashyCore v7 — workspace topbar (old peak Dashy style).
 *
 * - Left: "WORKSPACE" breadcrumb + live session title
 * - Right: subtle "AI ready" pill, DASH-* model selector, user avatar chip
 * - Accepts an optional `sessionTitle` prop (layout passes "New Chat" /
 *   "Settings"); the chat page updates the title live via the
 *   `dashy:chat-title` event.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { checkWorkerStatus } from "@/lib/chat-client";
import { EVENTS } from "@/lib/conversations";
import { MODELS, getModelById } from "@/lib/models";
import { getStoredModel, setStoredModel, MODEL_CHANGED_EVENT } from "@/lib/preferences";
import { CheckIcon, ChevronDownIcon, MenuIcon } from "@/components/icons";

type WorkerStatus = "checking" | "online" | "offline";

interface HeaderProps {
  sessionTitle?: string;
  /** Mobile only — opens the navigation drawer owned by the shell. */
  onOpenNav?: () => void;
}

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "D";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Header({ sessionTitle = "DashyCore", onOpenNav }: HeaderProps) {
  const [title, setTitle] = useState(sessionTitle);
  const [model, setModel] = useState<string>(() => getStoredModel());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>("checking");
  const [avatarInitials, setAvatarInitials] = useState("D");

  /* Live chat title updates from the chat page. */
  useEffect(() => {
    const onTitle = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail;
      if (detail?.title) setTitle(detail.title);
    };
    window.addEventListener(EVENTS.CHAT_TITLE, onTitle);
    return () => window.removeEventListener(EVENTS.CHAT_TITLE, onTitle);
  }, []);

  /* Shared model preference — the header owns the selector. */
  useEffect(() => {
    const onModelChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ model?: string }>).detail;
      if (detail?.model) setModel(detail.model);
    };
    window.addEventListener(MODEL_CHANGED_EVENT, onModelChanged);
    return () => window.removeEventListener(MODEL_CHANGED_EVENT, onModelChanged);
  }, []);

  /* Avatar initial for the profile chip. */
  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled || !user) return;
        const name =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          user.email?.split("@")[0] ||
          "Dashy user";
        setAvatarInitials(initialsFor(name, user.email ?? ""));
      } catch {
        // Keep the default initial.
      }
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Subtle AI-ready pill backed by a real reachability check. */
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      const result = await checkWorkerStatus();
      if (!cancelled) setWorkerStatus(result.state);
    };
    void ping();
    const interval = setInterval(() => void ping(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const currentModel = getModelById(model);

  const pill = {
    checking: { dot: "bg-zinc-500 animate-pulse", label: "connecting…" },
    online: { dot: "bg-emerald-400", label: "AI ready" },
    offline: { dot: "bg-red-400", label: "offline" },
  }[workerStatus];

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center gap-2 border-b border-white/[0.06] bg-navy/80 px-3 backdrop-blur-2xl sm:gap-3 sm:px-5">
      {/* Mobile navigation trigger */}
      {onOpenNav && (
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 md:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      )}

      {/* Breadcrumb + title */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 lg:inline">
          Workspace
        </span>
        <ChevronDownIcon className="hidden h-3 w-3 -rotate-90 text-zinc-600 lg:inline" />
        <h2 className="truncate text-sm font-semibold tracking-tight text-zinc-100" title={title}>
          {title}
        </h2>
      </div>

      <div className="ml-auto flex min-w-0 flex-shrink-0 items-center gap-1.5 sm:gap-2.5">
        {/* AI ready pill — desktop only, the model chip carries the state on phones */}
        <div
          className="hidden items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-400 lg:flex"
          title="dashy-flow-state reachability"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </div>

        {/* Model selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setModelMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={modelMenuOpen}
            aria-label={`Model: ${currentModel.label}`}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: currentModel.accent }}
            />
            <span className="hidden sm:inline">{currentModel.label}</span>
            <span className="sm:hidden">{currentModel.short}</span>
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
              <div
                role="listbox"
                aria-label="Select model"
                className="absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-white/[0.08] bg-[#131731] p-1.5 shadow-2xl shadow-black/60"
              >
                {MODELS.map((m) => {
                  const Icon = m.Icon;
                  const isSelected = m.id === currentModel.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setStoredModel(m.id);
                        setModelMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                        isSelected ? "bg-cyan-500/10" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${m.accent}1f`, color: m.accent }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                          {m.label}
                          {m.badge && (
                            <span className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-300">
                              {m.badge}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {m.description}
                        </span>
                      </span>
                      {isSelected && <CheckIcon className="h-4 w-4 flex-shrink-0 text-cyan-400" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* User avatar chip */}
        <Link
          href="/settings"
          title="Open settings"
          aria-label="Open settings"
          className="ml-0.5 hidden h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-xs font-semibold text-white transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 sm:flex"
        >
          {avatarInitials}
        </Link>
      </div>
    </header>
  );
}
