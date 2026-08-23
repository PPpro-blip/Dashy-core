"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import type { Components } from "react-markdown";
import type { ChatMemory } from "@/lib/ui/chat-client";
import { MemoryIndicator } from "./MemoryIndicator";

interface MessageContentProps {
  content: string;
  memories?: ChatMemory[];
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    return props?.children ? extractText(props.children) : "";
  }
  return "";
}

function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — ignore silently.
    }
  };

  return (
    <button
      type="button"
      className={`copy-button${copied ? " copied" : ""}`}
      onClick={handleCopy}
      aria-label={copied ? "Copied to clipboard" : "Copy code to clipboard"}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || "code"}</span>
        <CodeCopyButton code={code} />
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (
      child &&
      typeof child === "object" &&
      "props" in child &&
      typeof child.props === "object" &&
      child.props !== null
    ) {
      const props = child.props as { className?: string; children?: React.ReactNode };
      const className = props.className ?? "";
      const match = /language-([\w-]+)/.exec(className);
      const language = match?.[1] ?? "";
      const code = extractText(props.children);
      return <CodeBlock language={language} code={code} />;
    }
    return <pre>{children}</pre>;
  },
};

export function MessageContent({ content, memories }: MessageContentProps) {
  const [memoryOpen, setMemoryOpen] = useState(false);

  const rendered = useMemo(
    () => (
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight, rehypeSanitize]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    ),
    [content]
  );

  return (
    <div className="message-content">
      {rendered}
      {memories && memories.length > 0 && (
        <div className="message-memory">
          <MemoryIndicator
            memories={memories}
            open={memoryOpen}
            onToggle={() => setMemoryOpen((v) => !v)}
          />
          {memoryOpen && (
            <div className="memory-context" role="region" aria-label="Retrieved context">
              <div className="memory-context-header">
                {memories.length === 1
                  ? "1 relevant memory"
                  : `${memories.length} relevant memories`}
              </div>
              {memories.map((memory, i) => (
                <div className="memory-context-item" key={i}>
                  {memory.content}
                  <span className="memory-source">
                    {memory.title || memory.sourceType || `Source ${i + 1}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}