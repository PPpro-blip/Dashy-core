"use client";

/**
 * DashyCore v7 — DashyAI output drawer.
 *
 * Bottom panel that receives streaming DashyAI results (Explain Current
 * File / Refactor Selection). Copy button + close; the spinner runs while
 * the worker streams.
 */

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { BotIcon, CopyIcon, LoaderIcon, XIcon } from "@/components/icons";

export interface AiOutputState {
  title: string;
  content: string;
  running: boolean;
}

interface AiOutputPanelProps {
  output: AiOutputState;
  onClose: () => void;
}

export function AiOutputPanel({ output, onClose }: AiOutputPanelProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show({ type: "error", title: "Copy failed", message: "Could not reach the clipboard." });
    }
  };

  return (
    <div className="flex h-48 min-h-0 flex-col border-t border-white/[0.06] bg-[#0a0e1a]/90">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <BotIcon className="h-3.5 w-3.5 text-cyan-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-200">
          {output.title}
        </span>
        {output.running && (
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <LoaderIcon className="h-3 w-3 animate-spin text-cyan-400" />
            DashyAI is thinking…
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={!output.content}
          title="Copy output"
          aria-label="Copy DashyAI output"
          className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-40"
        >
          <CopyIcon className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close DashyAI output"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {output.content ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
            {output.content}
          </pre>
        ) : (
          <p className="text-[11px] text-zinc-600">
            {output.running ? "Waiting for DashyAI…" : "No output yet."}
          </p>
        )}
      </div>
    </div>
  );
}
