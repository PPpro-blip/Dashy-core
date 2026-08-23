"use client";

import type { ChatMemory } from "@/lib/ui/chat-client";

interface MemoryIndicatorProps {
  memories: ChatMemory[];
  open: boolean;
  onToggle: () => void;
}

export function MemoryIndicator({ memories, open, onToggle }: MemoryIndicatorProps) {
  const label =
    memories.length === 1
      ? "1 relevant memory"
      : `${memories.length} relevant memories`;

  return (
    <button
      type="button"
      className="memory-indicator"
      aria-expanded={open}
      aria-controls={`memory-context-${memories.length}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
      <span>{label}</span>
      <svg className={`memory-chevron${open ? " is-open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}