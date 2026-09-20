"use client";

/**
 * DashyCore v7 — Pair Coder panel (Roo-style, web-safe).
 *
 * Selection-scoped pair programming. Seeded from the current editor
 * selection + filename, it holds a normal (streaming) chat about that code.
 * When a reply contains a fenced code block, "Apply code block" replaces the
 * original selection in Monaco.
 *
 * Worker path: NORMAL chat (agentMode:false) — conversational and streaming
 * reads better here than the structured-JSON agent path, and we only ever
 * apply a single block back over one selection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DCodeWorkspaceApi } from "@/lib/dcode/extensions/types";
import { firstCodeBlock, runAgentTurn } from "@/lib/dcode/extensions/agent";
import { onViewAction } from "@/lib/dcode/extensions/view-bridge";
import { useToast } from "@/components/Toast";
import { LoaderIcon, SendIcon, UsersIcon, XIcon } from "@/components/icons";

interface PairCoderPanelProps {
  api: DCodeWorkspaceApi;
  onClose: () => void;
}

interface Turn {
  role: "user" | "pair";
  text: string;
}

const SYSTEM_PROMPT =
  "You are Pair Coder, a Roo-style pair-programming assistant inside a browser IDE. " +
  "You focus on the user's selected code and its file. Be concise and practical. " +
  "When you propose a code change, put the FULL replacement for the selection in a single fenced code block " +
  "so it can be applied directly back over the selection.";

export function PairCoderPanel({ api, onClose }: PairCoderPanelProps) {
  const toast = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<{ file: string; language: string; code: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef("");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  const captureSelection = useCallback(() => {
    const file = api.getActiveFile();
    const selection = api.getSelectedText();
    if (!file || !selection || !selection.trim()) {
      toast.show({
        type: "info",
        title: "Select code first",
        message: "Highlight code in the editor, then start Pair Coder.",
      });
      return false;
    }
    setSeed({ file: file.name, language: file.language, code: selection });
    setTurns([]);
    window.setTimeout(() => inputRef.current?.focus(), 30);
    return true;
  }, [api, toast]);

  useEffect(() => {
    const off = onViewAction("pair-coder.newFromSelection", () => {
      captureSelection();
    });
    return off;
  }, [captureSelection]);

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || busy) return;
      const activeSeed =
        seed ??
        (() => {
          const file = api.getActiveFile();
          const sel = api.getSelectedText();
          return file && sel && sel.trim()
            ? { file: file.name, language: file.language, code: sel }
            : null;
        })();
      if (!activeSeed) {
        toast.show({
          type: "info",
          title: "Select code first",
          message: "Highlight code in the editor to give Pair Coder context.",
        });
        return;
      }
      if (!seed) setSeed(activeSeed);

      setInput("");
      setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
      setBusy(true);
      streamRef.current = "";
      setTurns((prev) => [...prev, { role: "pair", text: "" }]);

      try {
        const userId = await api.getUserId();
        const prompt =
          `${SYSTEM_PROMPT}\n\n` +
          `File: ${activeSeed.file} (${activeSeed.language})\n` +
          `Selected code:\n\`\`\`${activeSeed.language}\n${activeSeed.code}\n\`\`\`\n\n` +
          `Question: ${trimmed}`;
        await runAgentTurn(prompt, {
          userId,
          agentMode: false,
          callbacks: {
            onDelta: (delta) => {
              streamRef.current += delta;
              const snapshot = streamRef.current;
              setTurns((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "pair", text: snapshot };
                return next;
              });
            },
          },
        });
      } catch (error) {
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "pair",
            text: `[Pair Coder error] ${
              error instanceof Error ? error.message : "Could not reach the assistant."
            }`,
          };
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [api, busy, seed, toast]
  );

  const applyBlock = useCallback(
    (text: string) => {
      const block = firstCodeBlock(text);
      if (!block) {
        toast.show({
          type: "info",
          title: "No code block",
          message: "This reply has no fenced code block to apply.",
        });
        return;
      }
      const ok = api.replaceSelection(block);
      if (ok) {
        toast.show({
          type: "success",
          title: "Applied",
          message: "Replaced your selection with the code block.",
        });
      } else {
        toast.show({
          type: "error",
          title: "Could not apply",
          message: "Re-select the code in the editor and try again.",
        });
      }
    },
    [api, toast]
  );

  return (
    <div className="flex h-full min-h-0 w-80 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0e1a]/95">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="text-base">👥</span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-zinc-100">Pair Coder</p>
          <p className="text-[9px] text-zinc-600">Roo-style pair programming</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Pair Coder"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {seed ? (
        <div className="flex-shrink-0 border-b border-white/[0.05] bg-black/20 px-3 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
            Selection · {seed.file}
          </p>
          <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-zinc-400">
            {seed.code.slice(0, 800)}
          </pre>
          <button
            type="button"
            onClick={captureSelection}
            className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-cyan-400/80 hover:text-cyan-300"
          >
            Re-capture selection
          </button>
        </div>
      ) : (
        <div className="flex-shrink-0 border-b border-white/[0.05] px-3 py-2">
          <button
            type="button"
            onClick={captureSelection}
            className="w-full rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1.5 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20"
          >
            Capture editor selection
          </button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[11px] leading-relaxed text-zinc-500">
            <p className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <UsersIcon className="h-3.5 w-3.5 text-cyan-400" />
              Pair on a selection
            </p>
            <p className="mt-1.5">
              Select code in the editor, then ask a question — refactor it, explain it,
              add tests. If the reply has a code block, click{" "}
              <span className="text-cyan-300">Apply code block</span> to replace your
              selection.
            </p>
          </div>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-6 rounded-lg bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
              {turn.text}
            </div>
          ) : (
            <div key={i} className="space-y-1.5">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-zinc-300">
                <pre className="whitespace-pre-wrap break-words font-sans">{turn.text || "…"}</pre>
              </div>
              {firstCodeBlock(turn.text) && (
                <button
                  type="button"
                  onClick={() => applyBlock(turn.text)}
                  className="rounded-md bg-cyan-500 px-2.5 py-1 text-[10px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                >
                  Apply code block
                </button>
              )}
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            Pair Coder is thinking…
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-white/[0.06] p-2.5">
        <div className="flex items-end gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="Ask about the selection…"
            spellCheck={false}
            className="max-h-28 min-h-0 w-full resize-none bg-transparent text-[11px] text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="mb-0.5 rounded-md bg-cyan-500 p-1.5 text-[#06202a] transition-colors hover:bg-cyan-400 disabled:opacity-40"
          >
            <SendIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
