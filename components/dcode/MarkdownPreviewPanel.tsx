"use client";

/**
 * DashyCore v7 — Markdown Preview panel.
 *
 * Renders the active Markdown file with the same react-markdown + remark-gfm
 * + rehype-sanitize stack the chat uses. It reads the active file live, so
 * switching to another .md file and hitting refresh re-renders it.
 */

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { DCodeWorkspaceApi } from "@/lib/dcode/extensions/types";
import { onViewAction } from "@/lib/dcode/extensions/view-bridge";
import { FileTextIcon, RefreshIcon, XIcon } from "@/components/icons";

interface MarkdownPreviewPanelProps {
  api: DCodeWorkspaceApi;
  onClose: () => void;
}

export function MarkdownPreviewPanel({ api, onClose }: MarkdownPreviewPanelProps) {
  const [doc, setDoc] = useState<{ name: string; content: string } | null>(null);

  const refresh = () => {
    const file = api.getActiveFile();
    if (file && file.language === "markdown") {
      setDoc({ name: file.name, content: file.content });
    } else {
      setDoc(null);
    }
  };

  useEffect(() => {
    refresh();
    const off = onViewAction("markdown-preview.refresh", refresh);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 w-96 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0e1a]/95">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="text-base">📄</span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-zinc-100">Markdown Preview</p>
          <p className="truncate text-[9px] text-zinc-600">{doc?.name ?? "No markdown file open"}</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh preview"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-cyan-300"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Markdown Preview"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {doc ? (
          <div className="dcode-md text-[12px] leading-relaxed text-zinc-300">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {doc.content}
            </Markdown>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-zinc-600">
            <FileTextIcon className="h-8 w-8 text-zinc-700" />
            <p className="mt-3 max-w-[16rem] text-[11px] leading-relaxed">
              Open a Markdown (.md) file and run{" "}
              <span className="text-cyan-300">Markdown: Open Preview</span> from the
              Command Palette.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
