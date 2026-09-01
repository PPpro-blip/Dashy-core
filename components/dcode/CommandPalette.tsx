"use client";

/**
 * DashyCore v7 — Command Palette (Ctrl+Shift+P) + generic Quick Pick.
 *
 * Keyboard-first: fuzzy subsequence filter, ↑/↓ navigation, Enter to run,
 * Esc to dismiss. Both core D-Code commands and extension commands flow in
 * through the shared registry (lib/dcode/extensions/runtime.ts).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandDefinition } from "@/lib/dcode/extensions/runtime";
import type { QuickPickItem } from "@/lib/dcode/extensions/types";
import { CommandIcon, SearchIcon } from "@/components/icons";

/** Subsequence scoring: consecutive chars and word starts score higher. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      if (ti === last + 1) score += 2;
      if (ti === 0 || /[\s\-._:/]/.test(t[ti - 1])) score += 3;
      last = ti;
      qi += 1;
    }
  }
  return qi === q.length ? score : -1;
}

interface CommandPaletteProps {
  open: boolean;
  commands: CommandDefinition[];
  onClose: () => void;
  onRun: (command: CommandDefinition) => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
  onRun,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const scored: Array<{ command: CommandDefinition; score: number }> = [];
    for (const command of commands) {
      const haystack = `${command.category ?? ""} ${command.title}`;
      const score = fuzzyScore(query, haystack);
      if (score >= 0) scored.push({ command, score });
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.command);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // Focus after the overlay mounts.
      const t = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query, commands]);

  if (!open) return null;

  const runAt = (i: number) => {
    const command = results[i];
    if (command) onRun(command);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d1220] shadow-2xl shadow-black/80"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) =>
              results.length === 0 ? 0 : (i - 1 + results.length) % results.length
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            runAt(index);
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4">
          <CommandIcon className="h-4 w-4 flex-shrink-0 text-cyan-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command…"
            spellCheck={false}
            aria-label="Command palette search"
            className="h-12 w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none"
          />
          <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            esc
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-zinc-600">
            No matching commands
            {query ? ` for “${query}”` : ""}
          </p>
        ) : (
          <ul ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
            {results.map((command, i) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => runAt(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] ${
                    i === index
                      ? "bg-cyan-500/10 text-cyan-200"
                      : "text-zinc-300"
                  }`}
                >
                  <span
                    className={`min-w-0 flex-1 truncate ${i === index ? "text-cyan-100" : ""}`}
                  >
                    {command.title}
                  </span>
                  {command.category && (
                    <span className="flex-shrink-0 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      {command.category}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-white/[0.06] bg-black/20 px-4 py-2 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1 font-mono">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1 font-mono">↵</kbd>
            run
          </span>
          <span className="ml-auto">Dashy Extensions commands appear here when enabled</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Generic quick pick (themes, extension toggles, …)                      */
/* ---------------------------------------------------------------------- */

interface QuickPickModalProps<T extends QuickPickItem> {
  title: string;
  items: T[];
  onSelect: (item: T | null) => void;
}

export function QuickPickModal<T extends QuickPickItem>({
  title,
  items,
  onSelect,
}: QuickPickModalProps<T>) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const scored: Array<{ item: T; score: number }> = [];
    for (const item of items) {
      const score = fuzzyScore(query, `${item.label} ${item.detail ?? ""} ${item.description ?? ""}`);
      if (score >= 0) scored.push({ item, score });
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
  }, [items, query]);

  useEffect(() => {
    setQuery("");
    setIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const pickAt = (i: number) => {
    const item = results[i];
    if (item) onSelect(item);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d1220] shadow-2xl shadow-black/80"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onSelect(null);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) =>
              results.length === 0 ? 0 : (i - 1 + results.length) % results.length
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            pickAt(index);
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-cyan-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={title}
            spellCheck={false}
            aria-label={title}
            className="h-12 w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-zinc-600">No matches</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1.5">
            {results.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pickAt(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                    i === index ? "bg-cyan-500/10" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] ${
                        i === index ? "text-cyan-100" : "text-zinc-200"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.description && (
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                        {item.description}
                      </span>
                    )}
                  </span>
                  {item.detail && (
                    <span className="flex-shrink-0 font-mono text-[10px] text-zinc-600">
                      {item.detail}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
