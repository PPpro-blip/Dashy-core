"use client";

/**
 * DashyCore v7 — Settings.
 *
 * - Profile: avatar / name / email (read-only from Supabase Auth)
 * - Preferences: default model, theme (dark locked)
 * - Memory: documents list from Supabase `documents` with delete
 * - Danger Zone: sign out, delete account (placeholder)
 *
 * Executive dark-mode aesthetic (zinc-900 / zinc-950).
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { useToast } from "@/components/Toast";
import { MODELS, getModelById } from "@/lib/models";
import { getStoredModel, setStoredModel, MODEL_CHANGED_EVENT } from "@/lib/preferences";
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  ImageIcon,
  LoaderIcon,
  LockIcon,
  MoonIcon,
  TrashIcon,
} from "@/components/icons";

interface DocumentRow {
  id: string;
  title: string | null;
  source_type: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
}

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

function sourceIcon(sourceType: string | null) {
  if (sourceType === "pdf") return { Icon: FileTextIcon, label: "PDF" };
  if (sourceType === "image") return { Icon: ImageIcon, label: "Image" };
  if (sourceType === "markdown") return { Icon: FileTextIcon, label: "Markdown" };
  return { Icon: FileTextIcon, label: "Text" };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SettingsPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [model, setModel] = useState<string>(() => getStoredModel());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const toast = useToast();

  const loadDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, source_type, source, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setDocuments((data as DocumentRow[]) ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load documents.";
      toast.error("Could not load your memory", message);
      setDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  }, [toast]);

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
    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments]);

  const handleDeleteDocument = async (document: DocumentRow) => {
    if (deletingId) return;
    setDeletingId(document.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("documents").delete().eq("id", document.id);
      if (error) throw error;
      setDocuments((prev) => prev.filter((d) => d.id !== document.id));
      toast.success("Document deleted", `${document.title ?? "Untitled document"} was removed from memory.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed.";
      toast.error("Delete failed", message);
    } finally {
      setDeletingId(null);
    }
  };

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
            onClick={() => void loadDocuments()}
            disabled={loadingDocuments}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 disabled:opacity-50"
          >
            {loadingDocuments ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-4">
          {loadingDocuments ? (
            <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              Loading your documents…
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-black/20 px-4 py-8 text-center">
              <p className="text-sm text-zinc-400">No documents yet</p>
              <p className="mt-1 text-xs text-zinc-600">
                Upload a PDF, TXT, MD, PNG or JPG from the chat composer and it
                will show up here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
              {documents.map((document) => {
                const { Icon, label } = sourceIcon(document.source_type);
                return (
                  <li
                    key={document.id}
                    className="flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-zinc-900/50"
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {document.title ?? "Untitled document"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {label} · indexed {formatDate(document.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteDocument(document)}
                      disabled={deletingId !== null}
                      title="Delete document from memory"
                      aria-label={`Delete ${document.title ?? "document"}`}
                      className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === document.id ? (
                        <LoaderIcon className="h-3 w-3 animate-spin" />
                      ) : (
                        <TrashIcon className="h-3 w-3" />
                      )}
                      {deletingId === document.id ? "Deleting…" : "Delete"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
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
