"use client";

/**
 * DashyCore v7 — /d-code (new scratch project).
 *
 * Renders a fresh unsaved workspace. Two seeds are supported:
 *   - "Open in D-Code" from a chat code block (sessionStorage hand-off)
 *   - otherwise the default starter file (index.ts)
 *
 * The workspace only renders after mount: seeds contain random ids and
 * browser-only hand-off data, so there is nothing stable to prerender.
 * The first explicit save (⌘S / Save) creates the Supabase row and swaps
 * the URL to /d-code/<id>.
 */

import { useEffect, useState } from "react";
import {
  DCODE_INCOMING_KEY,
  filenameFromLanguage,
  newId,
  normalizeLanguage,
  starterProjectDraft,
  type DCodeFile,
} from "@/lib/dcode";
import {
  DCodeWorkspace,
  type DCodeWorkspaceDraft,
} from "@/components/dcode/DCodeWorkspace";

export default function NewDCodePage() {
  const [draft, setDraft] = useState<DCodeWorkspaceDraft | null>(null);

  useEffect(() => {
    // 1) Hand-off from chat: seed the first file with the sent code.
    try {
      const raw = window.sessionStorage.getItem(DCODE_INCOMING_KEY);
      if (raw) {
        window.sessionStorage.removeItem(DCODE_INCOMING_KEY);
        const incoming = JSON.parse(raw) as { code?: string; language?: string };
        if (incoming.code && incoming.code.trim()) {
          const language = normalizeLanguage(incoming.language ?? "");
          const file: DCodeFile = {
            id: newId(),
            name: filenameFromLanguage(language),
            language,
            content: incoming.code,
          };
          setDraft({
            title: "Untitled project",
            language,
            files: [file],
          });
          return;
        }
      }
    } catch {
      // Corrupt seed — fall through to the starter project.
    }

    // 2) Plain scratch project with the starter file.
    const starter = starterProjectDraft("typescript");
    setDraft({
      title: starter.title,
      language: starter.language,
      files: starter.files,
    });
  }, []);

  if (!draft) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center gap-2 text-zinc-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-400" />
        <span className="text-sm">Preparing your workspace…</span>
      </div>
    );
  }

  return <DCodeWorkspace draft={draft} />;
}
