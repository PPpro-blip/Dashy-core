"use client";

/**
 * DashyCore v7 — D-Code developer CLI terminal (Ctrl + `).
 *
 * A VS Code-inspired bottom drawer. It is a pure UX emulator that reads and
 * writes ONLY to the D-Code project state held by DCodeWorkspace — there is
 * no real shell or process execution, no sandbox, nothing leaves the browser.
 *
 * Supported commands (see `help`):
 *   ls, cat, pwd, clear, echo, open, whoami, date
 *   npm install / npm i          realistic package-install log stream
 *   npm run dev / npm run build  Next.js dev-server / production-build logs
 *   git status / add / commit -m / push   simulated git over project state
 *   wrangler deploy              Cloudflare Worker deployment logs
 *   node <file>                  safe sandboxed eval of small JS files
 *
 * Long commands stream their output line-by-line (like a real shell) while
 * the input row shows a busy state. Command history (up/down) is remembered.
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
  "    pwd                Print the workspace path",
  "    echo <text>        Print text",
  "    whoami             Print the signed-in user",
  "    date               Print current date/time",
  "    clear              Clear the terminal",
  "",
  "  npm",
  "    npm install        Simulate dependency installation",
  "    npm run dev        Simulate the Next.js dev server",
  "    npm run build      Simulate a production build",
  "",
  "  git",
  "    git status         Show modified / new files in this project",
  "    git add            Stage all changes",
  "    git commit -m \"…\"  Commit staged changes",
  "    git push           Push to origin/main",
  "",
  "  Deploy & run",
  "    wrangler deploy    Simulate a Cloudflare Worker deployment",
  "    node <file>        Run a small JS file in a safe sandbox",
  "",
];

/** Slugifies the project title for worker/path names. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "dashy-project";
}

function fakeSha(): string {
  return Math.random().toString(16).slice(2, 9);
}

/** Random-ish but plausible install stat line. */
function installStats(): string {
  const packages = 96 + Math.floor(Math.random() * 120);
  const seconds = (0.8 + Math.random() * 2.4).toFixed(1);
  return `added ${packages} packages, and audited ${packages + 1} packages in ${seconds}s`;
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
  /** Commits made locally but not "pushed" yet. */
  const [ahead, setAhead] = useState(0);

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

  const tick = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => setTimeout(() => resolve(undefined), ms)),
    []
  );

  /** Streams an array of [text, kind] lines with small realistic delays. */
  const stream = useCallback(
    async (entries: Array<[string, LineKind?]>, delay = 240) => {
      for (const [text, kind] of entries) {
        emit(text, kind ?? "output");
        await tick(delay);
      }
    },
    [emit, tick]
  );

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

  /* ------------------------------ node sandbox ---------------------------- */

  /**
   * Safely "runs" a small JavaScript file: files that touch browser/node
   * globals (or are too large) are refused — their source is printed
   * instead. Otherwise the source is evaluated in a `new Function` sandbox
   * with a capturing console.
   */
  const runNodeFile = useCallback(
    (file: DCodeFile) => {
      const name = file.name.toLowerCase();
      const isJs = /\.(js|mjs|cjs)$/.test(name);

      if (isBinaryPath(file.name) || file.content.startsWith("data:")) {
        emit(
          `node: ${file.name}: binary asset (${formatBytes(
            dataUrlByteSize(file.content)
          )}, Base64) — use 'open ${file.name}' to preview it.`,
          "error"
        );
        return;
      }

      if (!isJs) {
        if (/\.(ts|tsx)$/.test(name)) {
          emit(
            "node: TypeScript isn't executed by node directly (build first, or use tsx). File contents:",
            "error"
          );
        } else {
          emit(`node: ${file.name}: only .js files run in this sandbox. Printing contents:`, "error");
        }
        emit(file.content.slice(0, 4000));
        return;
      }

      if (file.content.length > 2000) {
        emit("node: file too large for the sandbox — printing source:", "muted");
        emit(file.content.slice(0, 4000));
        return;
      }

      const blocked =
        /\b(window|document|globalThis|process|require|import\s|import\(|eval\s*\(|fetch\s*\(|localStorage|sessionStorage|self\b|Function\s*\(|WebAssembly)\b/;
      if (blocked.test(file.content)) {
        emit(
          "node: this file uses browser/node APIs unavailable in the sandbox — printing source:",
          "muted"
        );
        emit(file.content.slice(0, 4000));
        return;
      }

      const out: string[] = [];
      const format = (v: unknown): string => {
        if (typeof v === "string") return v;
        try {
          return JSON.stringify(v);
        } catch {
          return String(v);
        }
      };
      const consoleShim = {
        log: (...args: unknown[]) => out.push(args.map(format).join(" ")),
        info: (...args: unknown[]) => out.push(args.map(format).join(" ")),
        warn: (...args: unknown[]) => out.push(args.map(format).join(" ")),
        error: (...args: unknown[]) => out.push(args.map(format).join(" ")),
      };

      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function(
          "console",
          `"use strict";\n${file.content}`
        ) as (c: unknown) => unknown;
        const result = fn(consoleShim);
        if (out.length > 0) {
          out.slice(0, 50).forEach((line) => emit(line));
        }
        if (result !== undefined) {
          emit(format(result), "success");
        }
        if (out.length === 0 && result === undefined) {
          emit(`(node: ${file.name} ran with no output)`, "muted");
        }
      } catch (error) {
        emit(
          `node: ${error instanceof Error ? error.message : "evaluation failed"}`,
          "error"
        );
      }
    },
    [emit]
  );

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
          emit(`/dashy-workspace/${slugify(projectTitle)}`);
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
        case "node": {
          if (!rest) {
            await stream([
              ["Welcome to Node.js v22.14.0 (D-Code simulated runtime).", "muted"],
              ["Type 'node <file>.js' to run a project file.", "muted"],
            ]);
            return;
          }
          const fileName = rest.split(/\s+/)[0] ?? "";
          const file = filesRef.current.find(
            (f) => f.name.toLowerCase() === fileName.toLowerCase()
          );
          if (!file) {
            emit(`node: ${fileName}: No such file`, "error");
            return;
          }
          runNodeFile(file);
          return;
        }
        default:
          break;
      }

      /* ---- npm ---- */
      if (lower === "npm") {
        const sub = (restParts[0] ?? "").toLowerCase();
        if (sub === "install" || sub === "i") {
          setBusy(true);
          await stream([
            ["npm install", "accent"],
            ["[1/4] Resolving packages..."],
            ["[2/4] Fetching packages..."],
            ["[3/4] Linking dependencies..."],
            ["[4/4] Building fresh packages..."],
            [installStats(), "success"],
            ["found 0 vulnerabilities", "success"],
          ]);
          setBusy(false);
          return;
        }
        if (sub === "run" && (restParts[1] ?? "") === "dev") {
          setBusy(true);
          await stream([
            [`> ${slugify(projectTitle)}@1.0.0 dev`, "muted"],
            ["> next dev", "muted"],
            [""],
            ["   ▲ Next.js 15.1.6", "accent"],
            ["   - Local:        http://localhost:3000"],
            ["   - Environments: .env.local"],
            [""],
            [" ✓ Ready in 820 ms", "success"],
            [" ○ Compiling / ..."],
            [" ✓ Compiled / in 640 ms", "success"],
            [""],
            ["(simulated dev server — it keeps running until you close the terminal)", "muted"],
          ], 300);
          setBusy(false);
          return;
        }
        if (sub === "run" && (restParts[1] ?? "") === "build") {
          setBusy(true);
          await stream([
            [`> ${slugify(projectTitle)}@1.0.0 build`, "muted"],
            ["> next build", "muted"],
            [""],
            ["   ▲ Next.js 15.1.6", "accent"],
            ["   Creating an optimized production build ..."],
            [" ✓ Compiled successfully", "success"],
            ["   Linting and checking validity of types ..."],
            ["   Collecting page data ..."],
            ["   Generating static pages (5/5) ..."],
            [" ✓ Generated all static pages", "success"],
            [""],
            [" Route (app)                              Size     Addons"],
            [" ─ ○ /                                  5.2 kB          "],
            [" ─ ○ /d-code                           18.4 kB         "],
            [" ƒ /api/chat                           1.1 kB          "],
            [""],
            [" ✓  Built in 4.2s", "success"],
          ], 260);
          setBusy(false);
          return;
        }
        emit(`npm: unknown script "${rest}". Try 'npm install', 'npm run dev' or 'npm run build'.`, "error");
        return;
      }

      /* ---- wrangler (also `npx wrangler …`) ---- */
      if (lower === "wrangler" || lower === "npx") {
        const args = lower === "npx" ? restParts.slice(1) : restParts;
        const action = (args[0] ?? "").toLowerCase();
        if (lower === "npx" && (restParts[0] ?? "").toLowerCase() !== "wrangler") {
          emit(`npx: '${rest}' isn't part of the simulated CLI. Try 'wrangler deploy'.`, "error");
          return;
        }
        if (action !== "deploy" && action !== "publish") {
          emit("Usage: wrangler deploy", "error");
          return;
        }
        const slug = slugify(projectTitle);
        setBusy(true);
        await stream(
          [
            [" ⛅️ wrangler 3.95.0 (simulated)", "accent"],
            ["Total Upload: 42.1 KiB / gzip: 13.2 KiB"],
            [`Uploaded ${slug} (1.8s)`],
            [`Published ${slug} (3.4s)`, "success"],
            [""],
            [`  https://${slug}.workers.dev`, "accent"],
            [`Current Deployment ID: ${fakeSha()}-${fakeSha()}`],
          ],
          280
        );
        setBusy(false);
        return;
      }

      /* ---- git ---- */
      if (lower === "git") {
        const sub = (restParts[0] ?? "").toLowerCase();
        const { untracked, modified } = workingTree();

        if (sub === "status" || sub === "") {
          const branch = "main";
          emit(`On branch ${branch}`, "accent");
          if (ahead > 0) {
            emit(
              `Your branch is ahead of 'origin/${branch}' by ${ahead} commit${
                ahead === 1 ? "" : "s"
              }.`
            );
            emit('  (use "git push" to publish your commits)', "muted");
          } else {
            emit(`Your branch is up to date with 'origin/${branch}'.`);
          }
          emit("");
          if (modified.length === 0 && untracked.length === 0) {
            emit("nothing to commit, working tree clean", "success");
          } else {
            if (modified.length > 0) {
              emit("Changes not staged for commit:");
              emit('  (use "git add <file>..." to update what will be committed)', "muted");
              modified.forEach((f) => emit(`\tmodified:   ${f.name}`, "error"));
              emit("");
            }
            if (untracked.length > 0) {
              emit("Untracked files:");
              emit('  (use "git add <file>..." to include in what will be committed)', "muted");
              untracked.forEach((f) => emit(`\t${f.name}`, "success"));
            }
          }
          return;
        }

        if (sub === "add") {
          const count = modified.length + untracked.length;
          if (count === 0) {
            emit("nothing to add — working tree clean");
          } else {
            emit(`Staged ${count} file${count === 1 ? "" : "s"} for commit.`, "success");
          }
          return;
        }

        if (sub === "commit") {
          const msgMatch = raw.match(/-m\s+(['"])([\s\S]*?)\1/);
          const message = msgMatch?.[2]?.trim();
          if (!message) {
            emit("Aborting commit: provide a message with git commit -m \"<message>\".", "error");
            return;
          }
          const changed = modified.length + untracked.length;
          if (changed === 0) {
            emit("nothing to commit, working tree clean");
            return;
          }
          const sha = fakeSha();
          setBaseline(filesRef.current.map((f) => ({ ...f })));
          setAhead((n) => n + 1);
          setBusy(true);
          await stream(
            [
              [`[main ${sha}] ${message}`, "success" as LineKind],
              [
                ` ${changed} file${changed === 1 ? "" : "s"} changed, ${
                  10 + Math.floor(Math.random() * 200)
                } insertions(+), ${Math.floor(Math.random() * 20)} deletions(-)`,
              ],
              ...untracked.map(
                (f) => [` create mode 100644 ${f.name}`, "muted" as LineKind] as [string, LineKind]
              ),
            ],
            180
          );
          setBusy(false);
          return;
        }

        if (sub === "push") {
          if (ahead === 0) {
            emit("Everything up-to-date", "success");
            return;
          }
          const count = ahead;
          setAhead(0);
          setBusy(true);
          await stream(
            [
              ["Enumerating objects: 14, done."],
              ["Counting objects: 100% (14/14), done."],
              ["Delta compression using up to 8 threads"],
              ["Compressing objects: 100% (8/8), done."],
              ["Writing objects: 100% (9/9), 2.13 KiB | 1.06 MiB/s, done."],
              ["Total 9 (delta 4), reused 0 (delta 0), pack-reused 0"],
              [`To https://github.com/ppro-blip/${slugify(projectTitle)}.git`, "muted"],
              [`   ${fakeSha()}..${fakeSha()}  main -> main`, "accent"],
              [""],
              [`✓ Pushed ${count} commit${count === 1 ? "" : "s"} to origin/main`, "success"],
            ],
            200
          );
          setBusy(false);
          return;
        }

        emit(`git: '${sub || ""}' is not a simulated command. Try: status, add, commit -m, push.`, "error");
        return;
      }

      emit(`command not found: ${name}. Type 'help'.`, "error");
    },
    [
      ahead,
      baseline,
      emit,
      onOpenFile,
      projectTitle,
      runNodeFile,
      stream,
      tick,
      userEmail,
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
