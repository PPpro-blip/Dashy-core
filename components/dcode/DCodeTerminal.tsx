"use client";

/**
 * DashyCore v7 — D-Code developer CLI terminal (Ctrl + `).
 *
 * Read-only project inspection commands run against the in-memory workspace.
 * No project JavaScript, shell commands, package scripts, Git mutations, or
 * deployment commands execute here; commands requiring execution say so.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DCodeFile } from "@/lib/dcode";
import {
  dataUrlByteSize,
  formatBytes,
  isBinaryPath,
  isImagePath,
} from "@/lib/dcode-binary";
import { XIcon } from "@/components/icons";

export interface DCodeTerminalProps {
  /** Project files — powering `ls`, `cat`, `open`, `node` and `git status`. */
  files: DCodeFile[];
  /** Project title — powering `pwd` and deployment/path names. */
  projectTitle: string;
  /** Authenticated user email — powering `whoami`. */
  userEmail: string | null;
  /** Switches the active editor file (called by `open <name>`). */
  onOpenFile: (id: string) => void;
  /** Closes the terminal drawer. */
  onClose: () => void;
  /** Applied to the drawer root so the workspace can size it (30%). */
  className?: string;
}

type LineKind =
  | "prompt"
  | "output"
  | "error"
  | "success"
  | "muted"
  | "accent";

interface TermLine {
  kind: LineKind;
  text: string;
}

const PROMPT = "dashy@dcode:~$ ";

const HELP_TEXT = [
  "DashyCore D-Code terminal — available commands:",
  "",
  "  Files & workspace",
  "    ls                 List project files",
  "    cat <file>         Print a file's contents",
  "    open <file>        Open a file in the editor",
  "    pwd                Show the workspace display label (not a shell path)",
  "    echo <text>        Print text",
  "    whoami             Print the signed-in user",
  "    date               Print current date/time",
  "    clear              Clear the terminal",
  "",
  "  git status         Inspect this project's saved-file baseline (simulated, read-only)",
  "",
  "  Execution is unavailable: node, npm, git mutations, and deployment",
  "  require an isolated runtime or real backend, neither of which is connected.",
  "  No project JavaScript is executed by this terminal.",
  "",
];

/** Makes the saved-file inspection path readable without claiming a real cwd. */
function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "dashy-project";
}

export function DCodeTerminal({
  files,
  projectTitle,
  userEmail,
  onOpenFile,
  onClose,
  className = "",
}: DCodeTerminalProps) {
  const [lines, setLines] = useState<TermLine[]>([
    {
      kind: "accent",
      text: "DashyCore D-Code terminal — type 'help' for commands. This is a simulated CLI.",
    },
  ]);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(false);

  /** Committed snapshot of the files (baseline for `git status`). */
  const [baseline, setBaseline] = useState<DCodeFile[]>(files);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /* Autoscroll to the newest line whenever output grows. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  /* Focus the input whenever the drawer opens. */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const emit = useCallback((text: string, kind: LineKind = "output") => {
    if (!aliveRef.current) return;
    setLines((prev) => [
      ...prev,
      ...text.split("\n").map((line) => ({ kind, text: line })),
    ]);
  }, []);

  /* ------------------------------ git helpers ----------------------------- */

  const workingTree = useCallback(() => {
    const current = filesRef.current;
    const base = new Map(baseline.map((f) => [f.name, f.content]));
    const untracked = current.filter((f) => !base.has(f.name));
    const modified = current.filter(
      (f) => base.has(f.name) && base.get(f.name) !== f.content
    );
    return { current, untracked, modified };
  }, [baseline]);

  /* ------------------------------ unavailable execution ------------------ */

  const unavailable = useCallback((operation: string) => {
    emit(`${operation}: execution is unavailable. This terminal only inspects project files; no shell, package manager, Git remote, deployer, or isolated runtime is connected.`, "error");
  }, [emit]);

  /* ------------------------------ command runner -------------------------- */

  const runCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      emit(`${PROMPT}${raw}`, "prompt");
      if (!cmd) return;

      const [name, ...restParts] = cmd.split(/\s+/);
      const rest = restParts.join(" ");
      const lower = name.toLowerCase();

      /* ---- simple / instant commands ---- */
      switch (lower) {
        case "help":
          emit(HELP_TEXT.join("\n"));
          return;
        case "clear":
          setLines([]);
          return;
        case "pwd":
          emit(`Workspace label: /dashy-workspace/${slugify(projectTitle)} (display only; no shell filesystem is connected).`, "muted");
          return;
        case "echo":
          emit(rest);
          return;
        case "whoami":
          emit(userEmail ?? "(signed out)");
          return;
        case "date":
          emit(new Date().toLocaleString());
          return;
        case "ls": {
          const current = filesRef.current;
          if (current.length === 0) {
            emit("No files in this project yet.");
            return;
          }
          current.forEach((file) => {
            if (file.content.startsWith("data:") || isImagePath(file.name)) {
              emit(
                `  ${file.name}  ${
                  file.content.startsWith("data:")
                    ? `(binary · ${formatBytes(dataUrlByteSize(file.content))} · base64)`
                    : "(svg · text)"
                }`,
                "muted"
              );
            } else {
              emit(`  ${file.name}`);
            }
          });
          return;
        }
        case "cat": {
          if (!rest) {
            emit("Usage: cat <filename>", "error");
            return;
          }
          const file = filesRef.current.find(
            (f) => f.name.toLowerCase() === rest.toLowerCase()
          );
          if (!file) {
            emit(`cat: ${rest}: No such file`, "error");
            return;
          }
          if (file.content.startsWith("data:")) {
            emit(
              `cat: ${file.name}: binary file (${formatBytes(
                dataUrlByteSize(file.content)
              )}, Base64 data URL) — use 'open ${file.name}' to preview.`,
              "muted"
            );
            return;
          }
          emit(file.content || "(empty file)");
          return;
        }
        case "open": {
          if (!rest) {
            emit("Usage: open <filename>", "error");
            return;
          }
          const file = filesRef.current.find(
            (f) => f.name.toLowerCase() === rest.toLowerCase()
          );
          if (!file) {
            emit(`open: ${rest}: No such file`, "error");
            return;
          }
          onOpenFile(file.id);
          emit(`Opened ${file.name} in the editor.`, "success");
          return;
        }
        case "node":
          unavailable("node");
          return;
        default:
          break;
      }

      /* ---- execution commands are intentionally unavailable ---- */
      if (lower === "npm") {
        unavailable("npm");
        return;
      }
      if (lower === "wrangler" || lower === "npx") {
        unavailable(lower === "npx" ? "npx" : "wrangler");
        return;
      }

      /* ---- read-only simulated Git status; no repository/remote exists ---- */
      if (lower === "git") {
        const sub = (restParts[0] ?? "").toLowerCase();
        if (sub !== "status" && sub !== "") {
          unavailable(`git ${sub}`);
          return;
        }
        const { untracked, modified } = workingTree();
        emit("Simulated project-file status (not a real Git repository):", "accent");
        if (modified.length === 0 && untracked.length === 0) {
          emit("No file differences from the workspace's initial snapshot.", "muted");
        } else {
          modified.forEach((file) => emit(`  modified: ${file.name}`, "output"));
          untracked.forEach((file) => emit(`  new: ${file.name}`, "output"));
        }
        return;
      }

      emit(`command not found: ${name}. Type 'help'.`, "error");
    },
    [
      baseline,
      emit,
      onOpenFile,
      projectTitle,
      unavailable,
      userEmail,
      workingTree,
    ]
  );

  const handleSubmit = useCallback(
    (raw: string) => {
      if (busyRef.current) return;
      const trimmed = raw.trim();
      if (trimmed) {
        setHistory((prev) =>
          [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 50)
        );
      }
      setHistoryIndex(-1);
      setCommand("");
      busyRef.current = true;
      setBusy(true);
      void runCommand(raw).finally(() => {
        busyRef.current = false;
        setBusy(false);
        inputRef.current?.focus();
      });
    },
    [runCommand]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit(command);
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

  const lineClass = (kind: LineKind): string => {
    switch (kind) {
      case "prompt":
        return "whitespace-pre-wrap text-cyan-300";
      case "error":
        return "whitespace-pre-wrap text-red-400";
      case "success":
        return "whitespace-pre-wrap text-emerald-400";
      case "muted":
        return "whitespace-pre-wrap text-zinc-600";
      case "accent":
        return "whitespace-pre-wrap text-cyan-400";
      default:
        return "whitespace-pre-wrap text-zinc-300";
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
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed"
      >
        {lines.map((line, index) => (
          <div key={index} className={lineClass(line.kind)}>
            {line.text || "\u00a0"}
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
          disabled={busy}
          placeholder={busy ? "running…" : "Type 'help'…"}
          className="min-w-0 flex-1 bg-transparent px-1 text-zinc-100 placeholder-zinc-600 outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
}
