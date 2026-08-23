"use client";

import { useEffect, useRef, useState } from "react";

interface ChatComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  sending: boolean;
  disabled?: boolean;
  onAttach?: () => void;
  onVoice?: () => void;
}

export function ChatComposer({
  onSend,
  onStop,
  sending,
  disabled = false,
  onAttach,
  onVoice,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea as content grows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Focus on mount.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  const handleSubmit = () => {
    const text = value.trim();
    if (!text || sending || disabled) return;
    onSend(text);
    setValue("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="composer-area">
      <div className="composer">
        <textarea
          ref={textareaRef}
          id="composer-input"
          className="composer-input"
          rows={1}
          placeholder="Ask anything…"
          aria-label="Message input"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="composer-actions">
          <div className="composer-tools">
            <button
              type="button"
              className="composer-tool"
              onClick={onAttach}
              aria-label="Attach document (coming soon)"
              title="Attach document — coming soon"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="button"
              className="composer-tool"
              onClick={onVoice}
              aria-label="Voice input (coming soon)"
              title="Voice input — coming soon"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
              </svg>
            </button>
          </div>

          <span className="composer-hint">
            Enter to send · Shift+Enter for newline
          </span>

          {sending ? (
            <button
              type="button"
              className="stop-button"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={`send-button${canSend ? " glow-ready" : ""}`}
              onClick={handleSubmit}
              disabled={!canSend}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <p className="composer-disclaimer">
        DashyCore v7 may make mistakes. Verify important info.
      </p>
    </div>
  );
}