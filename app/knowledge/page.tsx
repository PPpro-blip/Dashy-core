"use client";

/**
 * DashyCore v7 — Knowledge (workspace memory browser).
 *
 * Reuses the REAL upload flow (components/AttachmentButton →
 * POST /api/digest/upload → dashy-digest worker → Supabase RAG tables) and
 * lists indexed documents from the `documents` table. No simulated
 * ingestion — and no browser-side userId: the server proxy injects it.
 */

import { useState } from "react";
import Link from "next/link";
import { AttachmentButton } from "@/components/AttachmentButton";
import { DocumentsList } from "@/components/DocumentsList";

export default function KnowledgePage() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Knowledge</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Everything Dashy has learned from your documents — chunked, embedded
        and made searchable in chat.
      </p>

      {/* Upload — the same real flow as the chat composer attachment. */}
      <section className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Add to memory
        </h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-200">
              Upload a document or screenshot
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              PDF, TXT, MD, PNG or JPG · up to 15 MB · sent to dashy-digest,
              indexed into your workspace memory.
            </p>
          </div>
          {/* The whole visible control IS the attach button — no dead
              click area that only looks like a button. */}
          <AttachmentButton
            origin="knowledge"
            className="h-9 w-auto gap-1.5 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3.5 text-cyan-300 hover:border-cyan-400/40 hover:bg-cyan-500/20 hover:text-cyan-200"
            onUploaded={() => setReloadKey((key) => key + 1)}
          />
        </div>
        <p className="mt-4 rounded-lg border border-white/[0.06] bg-black/20 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-500">
          Tip: you can also attach files straight from the{" "}
          <Link href="/chat" className="text-cyan-300 underline underline-offset-2">
            chat composer
          </Link>{" "}
          — everything lands in the same memory.
        </p>
      </section>

      {/* Indexed documents */}
      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Indexed documents
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Documents Dashy can search during conversations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700"
          >
            Refresh
          </button>
        </div>
        <div className="mt-4">
          <DocumentsList reloadKey={reloadKey} />
        </div>
      </section>
    </div>
  );
}
