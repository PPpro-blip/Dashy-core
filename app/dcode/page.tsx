"use client";

import { useState } from "react";

/**
 * D-Code Workspace — purple-themed developer environment preview.
 * D-Code activates when the Main AI backend is fully verified.
 */

interface FileNode {
  name: string;
  kind: "folder" | "file";
  ext?: string;
  children?: FileNode[];
}

const FILE_TREE: FileNode[] = [
  {
    name: "src",
    kind: "folder",
    children: [
      { name: "agent.core.ts", kind: "file", ext: "ts" },
      { name: "router.dash.ts", kind: "file", ext: "ts" },
      { name: "memory.rag.ts", kind: "file", ext: "ts" },
    ],
  },
  {
    name: "workers",
    kind: "folder",
    children: [
      { name: "flow-state.ts", kind: "file", ext: "ts" },
      { name: "ingest.ts", kind: "file", ext: "ts" },
    ],
  },
  {
    name: "ui",
    kind: "folder",
    children: [
      { name: "ChatShell.tsx", kind: "file", ext: "tsx" },
      { name: "globals.css", kind: "file", ext: "css" },
    ],
  },
  { name: "wrangler.toml", kind: "file", ext: "toml" },
];

const SAMPLE_CODE = `// agent.core.ts — D-Code Agent V2 (preview)
import { routeModel } from "./router.dash";
import { retrieveMemory } from "./memory.rag";

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  // 🧠 Planning — decompose the user goal into steps
  const plan = await planSteps(input.goal, {
    maxIterations: input.maxToolIterations ?? 5,
  });

  // 🔎 Memory Search — ground the plan in retrieved knowledge
  const memories = await retrieveMemory(input.query, {
    threshold: input.similarityThreshold ?? 0.7,
  });

  // Execute each planned step with the routed DASH model
  const results = [];
  for (const step of plan.steps) {
    const model = routeModel(step.complexity);
    results.push(await executeStep(step, model, memories));
  }

  return { status: "complete", results };
}`;

const TERMINAL_LINES = [
  { cls: "term-dim", text: "$ dcode agent --verify" },
  { cls: "term-info", text: "› Checking Main AI backend health…" },
  { cls: "term-ok", text: "✓ dashy-flow-state worker reachable" },
  { cls: "term-info", text: "› Validating DASH routing table…" },
  { cls: "term-ok", text: "✓ 3 models registered (superfast · allround · complexity)" },
  { cls: "term-info", text: "› Agent V2 runtime…" },
  { cls: "term-ok", text: "✓ Execution ready — awaiting backend verification gate" },
  { cls: "term-prompt", text: "dcode › _" },
];

function renderTree(nodes: FileNode[], depth = 0): React.ReactNode[] {
  return nodes.flatMap((node) => [
    node.kind === "folder" ? (
      <div key={node.name} className="filetree-folder" style={{ paddingLeft: depth * 12 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span>{node.name}/</span>
      </div>
    ) : (
      <FileRow key={node.name} node={node} depth={depth} />
    ),
    ...(node.children ? renderTree(node.children, depth + 1) : []),
  ]);
}

function FileRow({ node, depth }: { node: FileNode; depth: number }) {
  const [selected, setSelected] = useState(false);
  return (
    <button
      type="button"
      className={`filetree-file${selected ? " selected" : ""}`}
      style={{ paddingLeft: 24 + depth * 12 }}
      onClick={() => setSelected(true)}
    >
      <span>{node.name}</span>
      <span className="file-ext">{node.ext}</span>
    </button>
  );
}

/** Minimal token highlighter for the preview pane. */
function highlight(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex =
    /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(import|from|export|async|await|function|return|const|for|of|if|new|type|interface)\b|\b(\d+)\b|\b([A-Z][A-Za-z0-9_]*)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > last) parts.push(<span key={key++}>{line.slice(last, match.index)}</span>);
    const [full, com, str, kw, num, type] = match;
    const cls = com ? "tok-com" : str ? "tok-str" : kw ? "tok-kw" : num ? "tok-num" : type ? "tok-type" : "";
    parts.push(<span key={key++} className={cls}>{full}</span>);
    last = match.index + full.length;
  }
  if (last < line.length) parts.push(<span key={key++}>{line.slice(last)}</span>);
  return parts;
}

export default function DCodePage() {
  const codeLines = SAMPLE_CODE.split(/\r?\n/);

  return (
    <div className="dcode-app">
      {/* Top bar */}
      <div className="dcode-topbar">
        <div className="dcode-topbar-left">
          <div className="dcode-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="url(#dcode-grad)" />
              <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" transform="translate(4 4)" fill="none" stroke="#0b0c10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <defs>
                <linearGradient id="dcode-grad" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#00f2fe" />
                  <stop offset="1" stopColor="#9b51e0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <h1 className="dcode-title">D-Code</h1>
            <p className="dcode-subtitle">Developer workspace</p>
          </div>
        </div>
        <span className="dcode-status-badge">
          <span className="dcode-status-dot" aria-hidden="true" />
          AGENT V2 EXECUTION READY
        </span>
      </div>

      {/* Notice */}
      <div className="dcode-notice" role="note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          <strong>D-Code activates when the Main AI backend is fully verified.</strong>{" "}
          This workspace is a live preview — the editor, terminal, and agent runtime
          unlock once the verification gate passes.
        </span>
      </div>

      {/* Main split */}
      <div className="dcode-main">
        {/* File tree */}
        <aside className="dcode-filetree" aria-label="Project files">
          <h2 className="filetree-heading">Explorer</h2>
          {renderTree(FILE_TREE)}
        </aside>

        {/* Editor */}
        <section className="dcode-editor" aria-label="Code preview">
          <div className="dcode-editor-tabs">
            <span className="dcode-editor-tab selected">agent.core.ts</span>
            <span className="dcode-editor-tab">router.dash.ts</span>
            <span className="dcode-editor-tab">memory.rag.ts</span>
          </div>
          <div className="dcode-editor-body">
            {codeLines.map((line, i) => (
              <div className="code-line" key={i}>
                <span className="code-line-number">{i + 1}</span>
                <span className="code-line-content">{highlight(line)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Terminal */}
      <footer className="dcode-terminal" aria-label="Terminal preview">
        <div className="dcode-terminal-header">
          <span>TERMINAL — dcode-agent</span>
          <span>zsh · preview</span>
        </div>
        <div className="dcode-terminal-body">
          {TERMINAL_LINES.map((l, i) => (
            <div key={i} className={l.cls}>
              {l.text}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}