"use client";

/**
 * DashyCore v7 — D-Code mock terminal (Ctrl + `).
 *
 * A VS Code-inspired bottom drawer. It is a pure UX terminal that reads and
 * writes ONLY to the D-Code project state held by DCodeWorkspace — there is
 * no real process execution, no shell, no sandbox. Supported commands are
 * help / ls / cat / pwd / clear / echo / open / whoami / date, plus a
 * remembered command history (up / down arrows) and a cyan
 * `dashy@dcode:~$` prompt.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DCodeFile } from "@/lib/dcode";
import { XIcon } from "@/components/icons";

export interface DCodeTerminalProps {
  /** Project files — powering `ls`, `cat` and `open`. */
  files: DCodeFile[];
  /** Project title — powering `pwd` (/dashy-workspace/<title>). */
  projectTitle: string;
  /** Authenticated user email — powering `whoami`. */
  userEmail: string | null;
  /** Switches the active editor file (called by `open <name>`). */
  onOpenFile: (id: string) => void;
  /** Closes the terminal drawer. */
  onClose: () => void;
  /** Applied to the drawer root so the workspace can size it (30%s). */
  className?: string;
}

interface TermLine {
  /** `prompt` lines echo the typed command; `output` are results. */
  kind: "prompt" | "output" | "error";
  text: string;
}

const PROMPT = "dashy@dcode:~$ ";

const HELP_TEXT = [
  "DashyCore D-Code terminal — available commands:",
  "",
  "  help            Show this help",
  "  ls              List all files in the current project",
  "  cat <file>      Print the contents of <file>",
  "  pwd             Print the current workspace path",
  "  clear           Clear the terminal",
  "  echo <text>     Print <text>",
  "  open <file>     Open <file> in the editor",
  "  whoami          Print the signed-in user",
  "  date            Print the current date and time",
  "",
].join("\n");

export function DCodeTerminal({
  files,
  projectTitle,
  userEmail,
  onOpenFile,
  onClose,
  className = "",
}: DCodeTerminalProps) {
  const [lines, setLines] = useState<TermLine[]>([
    { kind: "output", text: "DashyCore D-Code terminal. Type 'help' to get started." },
  ]);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Autoscroll to the newest line whenever output grows. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  /* Focus the input whenever the drawer opens. */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const appendPrompt = useCallback((cmd: string) => {
    setLines((prev) => [...prev, { kind: "prompt", text: `${PROMPT}${cmd}` }]);
  }, []);

  const appendOutput = useCallback((text: string, kind: TermLine["kind"] = "output") => {
    setLines((prev) => [...prev, ...text.split("\n").map((line) => ({ kind, text: line }))]);
  }, []);

  const handleCommand = useCallback(
    (raw: string) => {
      const cmd = raw.trim();
      // Always echo the command line (prompt + input).
      appendPrompt(raw);

      if (!cmd) return;

      const [name, ...rest] = cmd.split(/\s+/);
      const arg = rest.join(" ");

      switch (name.toLowerCase()) {
        case "help":
          appendOutput(HELP_TEXT);
          break;
        case "ls":
          if (files.length === 0) {
            appendOutput("No files in this project yet.");
          } else {
            files.forEach((file) => appendOutput(`  ${file.name}`));
          }
          break;
        case "cat": {
          if (!arg) {
            appendOutput("Usage: cat <filename>", "error");
            break;
          }
          const file = files.find((f) => f.name.toLowerCase() === arg.toLowerCase());
          if (!file) {
            appendOutput(`cat: ${arg}: No such file`, "error");
            break;
          }
          const content = file.content || "(empty file)";
          appendOutput(content);
          break;
        }
        case "pwd":
          appendOutput(`/dashy-workspace/${projectTitle || "untitled"}`);
          break;
        case "clear":
          setLines([]);
          return; // no echo of prompt above gets cleared with the rest
        case "echo":
          appendOutput(arg);
          break;
        case "open": {
          if (!arg) {
            appendOutput("Usage: open <filename>", "error");
            break;
          }
          const file = files.find((f) => f.name.toLowerCase() === arg.toLowerCase());
          if (!file) {
            appendOutput(`open: ${arg}: No such file`, "error");
            break;
          }
          onOpenFile(file.id);
          appendOutput(`Opened ${file.name} in the editor.`);
          break;
        }
        case "whoami":
          appendOutput(userEmail ?? "(signed out)");
          break;
        case "date":
          appendOutput(new Date().toLocaleString());
          break;
        default:
          appendOutput(`command not found: ${name}. Type 'help'.`, "error");
      }
    },
    [appendOutput, appendPrompt, files, onOpenFile, projectTitle, userEmail]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const trimmed = command.trim();
      if (trimmed) {
        setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 50));
      }
      setHistoryIndex(-1);
      handleCommand(command);
      setCommand("");
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setCommand(history[next] ?? "");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (history.length === 0 || historyIndex === -1) return;
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next >= 0 ? history[next] ?? "" : "");
      return;
    }
  };

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden border-t border-white/[0.06] bg-black/90 ${className}`}
      style={{ backgroundColor: "#05070d" }}
    >
      {/* Tab header */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0a0e1a] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-400">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          Terminal
        </span>
        <span className="font-mono text-[10px] text-zinc-600">Ctrl + `</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal (Ctrl + `)"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Output scroll area */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
        {lines.map((line, index) => (
          <div
            key={index}
            className={
              line.kind === "prompt"
                ? "whitespace-pre-wrap text-cyan-300"
                : line.kind === "error"
                  ? "whitespace-pre-wrap text-red-400"
                  : "whitespace-pre-wrap text-zinc-300"
            }
          >
            {line.text}
          </div>
        ))}
      </div>

      {/* Input row */}
      <div className="flex flex-shrink-0 items-center gap-0 border-t border-white/[0.06] px-3 py-1.5 font-mono text-[12px]">
        <span className="flex-shrink-0 text-cyan-300">{PROMPT}</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Terminal command"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Type 'help'…"
          className="min-w-0 flex-1 bg-transparent px-1 text-zinc-100 placeholder-zinc-600 outline-none"
        />
      </div>
    </div>
  );
}
