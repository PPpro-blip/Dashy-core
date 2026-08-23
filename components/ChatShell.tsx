"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ModelSelector } from "./ModelSelector";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage, type ChatMessageData } from "./ChatMessage";
import { EmptyState } from "./EmptyState";
import { useToast } from "./ToastProvider";
import { DEFAULT_MODEL, type DashyModelId } from "@/lib/ui/models";
import { getUserId, getSettings } from "@/lib/ui/auth";
import {
  sendChatMessage,
  getWorkerStatus,
  type ChatStreamEvent,
  type WorkerStatus,
  ChatClientError,
} from "@/lib/ui/chat-client";

interface ChatShellProps {
  initialModel?: DashyModelId;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ChatShell({ initialModel }: ChatShellProps) {
  const [modelId, setModelId] = useState<DashyModelId>(initialModel ?? DEFAULT_MODEL);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({
    state: "online",
  });
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [title, setTitle] = useState("New chat");
  const [editingTitle, setEditingTitle] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Hydrate persisted preferences (default model / agent mode).
  useEffect(() => {
    const settings = getSettings();
    if (
      settings.defaultModel === "dashy-complexity" ||
      settings.defaultModel === "dashy-allround" ||
      settings.defaultModel === "dashy-superfast"
    ) {
      setModelId(settings.defaultModel);
    }
    setAgentMode(settings.agentModeDefault);
  }, []);

  // Check Worker health on mount.
  useEffect(() => {
    let cancelled = false;
    getWorkerStatus().then((status) => {
      if (!cancelled) setWorkerStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll to bottom whenever messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Close the options menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  const commitTitle = () => {
    setTitle((prev) => prev.trim() || "New chat");
    setEditingTitle(false);
  };

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.pending ? { ...m, pending: false } : m
      )
    );
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (sending) return;

      const userMessage: ChatMessageData = {
        id: uid(),
        role: "user",
        content: text,
      };
      const assistantId = uid();

      const assistantMessage: ChatMessageData = {
        id: assistantId,
        role: "assistant",
        content: "",
        modelId,
        pending: true,
        memories: undefined,
        statusStates: undefined,
        activity: undefined,
        agentMode,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setSending(true);
      setTitle((prev) => (prev === "New chat" ? text.slice(0, 48) : prev));

      const controller = new AbortController();
      abortRef.current = controller;

      const isTargetAssistant = (
        m: ChatMessageData
      ): m is Extract<ChatMessageData, { role: "assistant" }> =>
        m.role === "assistant" && m.id === assistantId;

      const updateAssistant = (
        prev: ChatMessageData[],
        update: (m: Extract<ChatMessageData, { role: "assistant" }>) => Extract<ChatMessageData, { role: "assistant" }>
      ): ChatMessageData[] =>
        prev.map((m) => (isTargetAssistant(m) ? update(m) : m));

      const onEvent = (event: ChatStreamEvent) => {
        if (event.type === "delta") {
          setMessages((prev) =>
            updateAssistant(prev, (m) => ({
              ...m,
              content: m.content + event.text,
            }))
          );
        } else if (event.type === "status") {
          setMessages((prev) =>
            updateAssistant(prev, (m) => ({
              ...m,
              statusStates: [
                ...(m.statusStates ?? []),
                ...event.statuses.filter((s) => !m.statusStates?.includes(s)),
              ],
              ...(event.statuses.some((s) => s.includes("Planning") || s.includes("Memory") || s.includes("Complete"))
                ? { activity: event.statuses }
                : {}),
            }))
          );
        } else if (event.type === "memory") {
          setMessages((prev) =>
            updateAssistant(prev, (m) => ({
              ...m,
              memories: [
                ...(m.memories ?? []),
                ...event.memories.filter(
                  (mem) =>
                    !m.memories?.some(
                      (existing) => existing.content === mem.content
                    )
                ),
              ],
            }))
          );
        }
      };

      try {
        const response = await sendChatMessage(
          {
            message: text,
            model: modelId,
            conversationId,
            userId: getUserId(),
            agentMode,
          },
          onEvent
        );

        if (response.conversationId) {
          setConversationId(response.conversationId);
        }
        setMessages((prev) =>
          updateAssistant(prev, (m) => ({
            ...m,
            content: response.content || m.content,
            pending: false,
            memories:
              response.memories && response.memories.length > 0
                ? response.memories
                : m.memories,
            statusStates:
              response.statusStates && response.statusStates.length > 0
                ? response.statusStates
                : m.statusStates,
            activity:
              response.activity && response.activity.length > 0
                ? response.activity
                : m.activity,
          }))
        );
      } catch (err) {
        const message =
          err instanceof ChatClientError
            ? err.message
            : "Something went wrong. Please try again.";

        // Elegant error toast — never crash the UI.
        toast(message, "error");

        setMessages((prev) =>
          updateAssistant(prev, (m) => ({
            ...m,
            pending: false,
            error: message,
          }))
        );
      } finally {
        abortRef.current = null;
        setSending(false);
      }
    },
    [sending, modelId, conversationId, agentMode, toast]
  );

  const handleNewChat = useCallback(() => {
    handleStop();
    setMessages([]);
    setConversationId(undefined);
    setTitle("New chat");
    setSidebarOpen(false);
  }, [handleStop]);

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Conversation link copied to clipboard.", "success");
    } catch {
      toast("Could not copy link. Clipboard unavailable.", "warning");
    }
  }, [toast]);

  const handleExport = useCallback(() => {
    const md = messages
      .map((m) => {
        const who = m.role === "user" ? "**You**" : "**DashyCore**";
        return `${who}\n\n${m.role === "assistant" && m.error ? `⚠️ ${m.error}` : m.content}`;
      })
      .join("\n\n---\n\n");
    const blob = new Blob([`# ${title}\n\n${md}\n`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w\s-]/g, "").trim() || "conversation"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
    toast("Conversation exported as Markdown.", "success");
  }, [messages, title, toast]);

  const hasMessages = messages.length > 0;

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        workerStatus={workerStatus}
      />

      <main className="main">
        <header className="chat-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>

          <div className="chat-header-left">
            {editingTitle ? (
              <div className="chat-header-title-editable">
                <input
                  ref={titleInputRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  aria-label="Conversation title"
                />
              </div>
            ) : (
              <button
                type="button"
                className="chat-header-title-editable"
                onClick={() => setEditingTitle(true)}
                aria-label="Edit conversation title"
              >
                <span className="chat-header-title">{title}</span>
                <svg className="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            )}
          </div>

          {/* Agent Mode toggle */}
          <div className="agent-toggle" title="Agent Mode — multi-step agentic pipeline">
            <span className={`agent-badge${agentMode ? "" : " hidden"}`}>
              AGENT MODE ON • GLM-5
            </span>
            <button
              type="button"
              className="agent-switch"
              role="switch"
              aria-checked={agentMode}
              aria-label="Toggle Agent Mode"
              disabled={sending}
              onClick={() => {
                setAgentMode((v) => !v);
                toast(
                  !agentMode
                    ? "Agent Mode enabled — GLM-5 pipeline active."
                    : "Agent Mode disabled.",
                  "info"
                );
              }}
            />
          </div>

          <ModelSelector
            selected={modelId}
            onSelect={setModelId}
            disabled={sending}
          />

          <button type="button" className="share-button" onClick={handleShare}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
            </svg>
            <span>Share</span>
          </button>

          <div className="header-menu" ref={menuRef}>
            <button
              type="button"
              className="icon-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Conversation options"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </button>
            {menuOpen && (
              <div className="header-menu-dropdown" role="menu">
                <button
                  type="button"
                  className="menu-option"
                  role="menuitem"
                  onClick={() => {
                    setEditingTitle(true);
                    setMenuOpen(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  Rename chat
                </button>
                <button
                  type="button"
                  className="menu-option"
                  role="menuitem"
                  onClick={handleExport}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Export as Markdown
                </button>
                <button
                  type="button"
                  className="menu-option danger"
                  role="menuitem"
                  onClick={() => {
                    handleNewChat();
                    setMenuOpen(false);
                    toast("Conversation cleared.", "info");
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Clear conversation
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-messages" aria-live="polite">
            {!hasMessages ? (
              <EmptyState onSuggestion={handleSend} modelId={modelId} />
            ) : (
              messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))
            )}
          </div>
        </div>

        <ChatComposer
          onSend={handleSend}
          onStop={handleStop}
          sending={sending}
          onAttach={() =>
            toast("Document upload & digest is coming soon.", "info")
          }
          onVoice={() => toast("Voice input is coming soon.", "info")}
        />
      </main>
    </div>
  );
}