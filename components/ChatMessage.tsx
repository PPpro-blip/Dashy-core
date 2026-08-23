"use client";

import type { ChatMemory } from "@/lib/ui/chat-client";
import { getModel, type DashyModelId } from "@/lib/ui/models";
import { MessageContent } from "./MessageContent";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { AgentActivity } from "./AgentActivity";

export type ChatMessageData =
  | {
      id: string;
      role: "user";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      memories?: ChatMemory[];
      /** High-level status labels from the backend (safe — never raw CoT). */
      statusStates?: string[];
      /** Agent pipeline labels (🧠 Planning → 🔎 Memory Search → ✅ Complete). */
      activity?: string[];
      /** Whether this turn ran in Agent Mode. */
      agentMode?: boolean;
      modelId?: DashyModelId;
      pending?: boolean;
      error?: string;
    };

interface ChatMessageProps {
  message: ChatMessageData;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="message message-user">
        <div className="message-meta">
          <span className="message-role">You</span>
        </div>
        <div className="message-bubble">{message.content}</div>
      </div>
    );
  }

  const model = message.modelId ? getModel(message.modelId) : undefined;
  const showThinking =
    message.pending === true &&
    Boolean(model?.showsThinking);
  const showGenerating =
    message.pending === true &&
    !model?.showsThinking;

  return (
    <div className="message message-assistant">
      <div className="message-meta">
        <span className="message-role">
          {model ? model.name : "DashyCore"}
        </span>
        {message.agentMode && (
          <span className="agent-badge">AGENT MODE</span>
        )}
      </div>
      {message.error ? (
        <div className="error-message" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <div>
            <div className="error-message-title">Something went wrong</div>
            <div className="error-message-detail">{message.error}</div>
          </div>
        </div>
      ) : showThinking && !message.content ? (
        message.agentMode ? (
          <AgentActivity steps={message.activity} active={true} />
        ) : (
          <ThinkingIndicator statuses={message.statusStates} />
        )
      ) : showGenerating && !message.content ? (
        <div className="generating" role="status" aria-live="polite">
          <span className="generating-dot" aria-hidden="true" />
          <span>Generating…</span>
        </div>
      ) : (
        <div className="message-bubble">
          {message.content ? (
            <MessageContent content={message.content} memories={message.memories} />
          ) : (
            <div className="generating" role="status" aria-live="polite">
              <span className="generating-dot" aria-hidden="true" />
              <span>Generating…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}