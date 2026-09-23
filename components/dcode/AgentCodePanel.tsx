"use client";

/**
 * DashyCore v7 — Agent Code panel (Cline-style, web-safe).
 *
 * A side-panel coding agent: type a task, it reads the in-memory project
 * (file list + contents), asks the worker (agentMode:true JSON path) for
 * structured edits, and renders them as diff cards. "Apply" writes the new
 * contents into the Monaco buffers via the workspace API (which drives the
 * existing autosave path). Nothing runs a real shell — terminal suggestions
 * are printed as text only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DCodeWorkspaceApi } from "@/lib/dcode/extensions/types";
import {
  fileList,
  parseProposedEdits,
  runAgentTurn,
  summarizeFiles,
  type ProposedEdit,
} from "@/lib/dcode/extensions/agent";
import { unifiedDiff } from "@/lib/dcode/diff";
import { onViewAction } from "@/lib/dcode/extensions/view-bridge";
import { useToast } from "@/components/Toast";
import { BotIcon, CheckIcon, LoaderIcon, SendIcon, XIcon } from "@/components/icons";

interface AgentCodePanelProps {
  api: DCodeWorkspaceApi;
  onClose: () => void;
}

interface Turn {
  role: "user" | "agent";
  text: string;
  edits?: ProposedEdit[];
  appliedIds?: string[];
}

const SYSTEM_PROMPT =
  "You are Agent Code, a Cline-style coding agent embedded in a BROWSER IDE (D-Code). " +
  "You can read the user's in-memory project files and propose edits, but you CANNOT run a real shell, " +
  "install packages, or touch the host filesystem. When you want to change or create files, return your " +
  "edits as a fenced ```dashy-edits JSON block of the exact shape " +
  '{"edits":[{"name":"path/file.ext","content":"<FULL new file contents>","language":"typescript"}]} ' +
  "(always the COMPLETE new file, never a partial patch). You may add short prose before the block. " +
  "If a terminal command would help, describe it in prose as a suggestion — do not claim to have run it.";

export function AgentCodePanel({ api, onClose }: AgentCodePanelProps) {
  const toast = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEditsRef = useRef<ProposedEdit[] | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  const applyEdit = useCallback(
    (edit: ProposedEdit, turnIndex: number) => {
      try {
        api.writeFile(edit.name, edit.content, edit.language);
        setTurns((prev) =>
          prev.map((t, i) =>
            i === turnIndex
              ? { ...t, appliedIds: [...(t.appliedIds ?? []), edit.name] }
              : t
          )
        );
        toast.show({
          type: "success",
          title: "Applied",
          message: `${edit.name} written to the editor.`,
        });
      } catch {
        toast.show({
          type: "error",
          title: "Could not apply",
          message: `Failed to write ${edit.name}.`,
        });
      }
    },
    [api, toast]
  );

  const applyAll = useCallback(
    (edits: ProposedEdit[], turnIndex: number) => {
      for (const edit of edits) applyEdit(edit, turnIndex);
    },
    [applyEdit]
  );

  const send = useCallback(
    async (task: string) => {
      const trimmed = task.trim();
      if (!trimmed || busy) return;
      setInput("");
      setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
      setBusy(true);
      try {
        const files = api.getFiles();
        const userId = await api.getUserId();
        const prompt =
          `${SYSTEM_PROMPT}\n\n` +
          `Project files: ${fileList(files)}\n\n` +
          `Current contents:\n${summarizeFiles(files)}\n\n` +
          `Task: ${trimmed}`;
        const content = await runAgentTurn(prompt, {
          userId,
          agentMode: true,
        });
        const edits = parseProposedEdits(content);
        if (edits.length > 0) lastEditsRef.current = edits;
        setTurns((prev) => [
          ...prev,
          { role: "agent", text: content, edits },
        ]);
      } catch (error) {
        setTurns((prev) => [
          ...prev,
          {
            role: "agent",
            text: `[Agent Code error] ${
              error instanceof Error ? error.message : "Could not reach the assistant."
            }`,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [api, busy]
  );

  // View-bridge actions fired by the palette commands.
  useEffect(() => {
    const off1 = onViewAction("agent-code.focusInput", () => {
      window.setTimeout(() => inputRef.current?.focus(), 30);
    });
    const off2 = onViewAction("agent-code.applyLast", () => {
      const edits = lastEditsRef.current;
      if (!edits || edits.length === 0) {
        toast.show({
          type: "info",
          title: "No diff to apply",
          message: "Ask Agent Code for a change first.",
        });
        return;
      }
      // Apply against the most recent agent turn that carried edits.
      setTurns((prev) => {
        let idx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].edits && prev[i].edits!.length > 0) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) applyAll(prev[idx].edits!, idx);
        return prev;
      });
    });
    return () => {
      off1();
      off2();
    };
  }, [applyAll, toast]);

  return (
    <div className="flex h-full min-h-0 w-80 flex-shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0e1a]/95">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="text-base">🤖</span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-zinc-100">Agent Code</p>
          <p className="text-[9px] text-zinc-600">Cline-style coding agent for browser IDE</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Agent Code"
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[11px] leading-relaxed text-zinc-500">
            <p className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <BotIcon className="h-3.5 w-3.5 text-cyan-400" />
              Describe a coding task
            </p>
            <p className="mt-1.5">
              Agent Code reads your open files and proposes edits as diffs.
              Review each one and click <span className="text-cyan-300">Apply</span> to
              write it into the editor. It can suggest terminal commands, but it never
              runs a real shell.
            </p>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-6 rounded-lg bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
              {turn.text}
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-zinc-300">
                <pre className="whitespace-pre-wrap break-words font-sans">
                  {stripEditsBlock(turn.text)}
                </pre>
              </div>
              {turn.edits && turn.edits.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      {turn.edits.length} proposed edit{turn.edits.length === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyAll(turn.edits!, i)}
                      className="rounded-md bg-cyan-500 px-2 py-0.5 text-[10px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                    >
                      Apply all
                    </button>
                  </div>
                  {turn.edits.map((edit) => (
                    <DiffCard
                      key={edit.name}
                      edit={edit}
                      existing={api.getFiles().find((f) => f.name === edit.name)?.content ?? ""}
                      applied={turn.appliedIds?.includes(edit.name) ?? false}
                      onApply={() => applyEdit(edit, i)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            Agent Code is working…
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
            placeholder="Describe a task (e.g. add a debounce util)…"
            spellCheck={false}
            className="max-h-28 min-h-0 w-full resize-none bg-transparent text-[11px] text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send task"
            className="mb-0.5 rounded-md bg-cyan-500 p-1.5 text-[#06202a] transition-colors hover:bg-cyan-400 disabled:opacity-40"
          >
            <SendIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Removes the machine-readable edits block so prose reads clean. */
function stripEditsBlock(text: string): string {
  const cleaned = text.replace(/```(?:dashy-edits|json)\s*\n[\s\S]*?```/gi, "").trim();
  return cleaned || "Proposed the edits below.";
}

function DiffCard({
  edit,
  existing,
  applied,
  onApply,
}: {
  edit: ProposedEdit;
  existing: string;
  applied: boolean;
  onApply: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isNew = existing === "";
  const diff = expanded ? unifiedDiff(existing, edit.content) : null;
  const adds = diff?.filter((l) => l.kind === "add").length ?? 0;
  const dels = diff?.filter((l) => l.kind === "del").length ?? 0;

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-black/20">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-2.5 py-1.5">
        <span
          className={`rounded px-1 py-px text-[9px] font-bold uppercase ${
            isNew
              ? "bg-emerald-400/15 text-emerald-300"
              : "bg-amber-400/15 text-amber-300"
          }`}
        >
          {isNew ? "New" : "Edit"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">
          {edit.name}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-cyan-300"
        >
          {expanded ? "Hide" : "Diff"}
        </button>
        {applied ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300">
            <CheckIcon className="h-3 w-3" />
            Applied
          </span>
        ) : (
          <button
            type="button"
            onClick={onApply}
            className="rounded bg-cyan-500 px-2 py-0.5 text-[10px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
          >
            Apply
          </button>
        )}
      </div>
      {expanded && (
        <div className="max-h-52 overflow-auto px-2.5 py-1.5">
          {diff ? (
            <>
              <p className="mb-1 text-[9px] text-zinc-600">
                +{adds} −{dels}
              </p>
              <pre className="font-mono text-[10px] leading-relaxed">
                {diff.map((line, idx) => (
                  <div
                    key={idx}
                    className={
                      line.kind === "add"
                        ? "bg-emerald-500/10 text-emerald-300"
                        : line.kind === "del"
                        ? "bg-red-500/10 text-red-300"
                        : "text-zinc-500"
                    }
                  >
                    <span className="select-none opacity-60">
                      {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                    </span>
                    {line.text}
                  </div>
                ))}
              </pre>
            </>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-zinc-400">
              {edit.content.slice(0, 4000)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
