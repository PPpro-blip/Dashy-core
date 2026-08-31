"use client";

/**
 * DashyCore v7 — chat workspace (old peak Dashy aesthetic).
 *
 * - Hero: logo mark, "How can I help you today?", 2×2 action cards
 * - Bottom-anchored input bar: attach (dashy-digest) + textarea + cyan send
 * - Real streaming from the dashy-flow-state worker via lib/chat-client
 *   (POST /chat · { message, model, userId, agentMode, conversation_id,
 *   messages } — `messages` carries the FULL prior turn history)
 * - Model is a workspace-wide preference owned by the header selector
 * - Conversations persist cloud-first (Supabase when signed in, else
 *   localStorage) and sync with the sidebar via events
 * - Code blocks offer Copy + "Open in D-Code" (hands the snapshot to the
 *   D-Code editor via sessionStorage; streaming is untouched)
 */

import { useCallback, useEffect, isValidElement, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { createClient } from "@/lib/supabase/client";
import { getDashySession } from "@/lib/auth-session";
import { DCODE_INCOMING_KEY } from "@/lib/dcode";
import {
  ChatClientError,
  sendChatMessage,
  type ChatHistoryEntry,
} from "@/lib/chat-client";
import {
  EVENTS,
  emitChatTitle,
  getConversationAsync,
  newConversationId,
  saveConversationAsync,
  titleFromContent,
  type Conversation,
  type HistoryMessage,
} from "@/lib/conversations";
import { getModelById } from "@/lib/models";
import { getStoredModel, MODEL_CHANGED_EVENT } from "@/lib/preferences";
import { AttachmentButton } from "@/components/AttachmentButton";
import { useToast } from "@/components/Toast";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ImageIcon,
  LightbulbIcon,
  RefreshIcon,
  RocketIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  UserIcon,
} from "@/components/icons";

const ACTIONS = [
  {
    // Generates an image through the zero-cost pollinations <IMG> engine —
    // no text model call, no dashy-flow-state round-trip.
    title: "Create AI art",
    desc: "A cyberpunk cat in neon rain",
    prompt: "A cyberpunk cat in neon rain",
    Icon: ImageIcon,
    image: true,
  },
  {
    title: "Write code",
    desc: "Build a Python web scraper",
    prompt: "Write a complete Python web scraper with error handling and comments",
    Icon: CodeIcon,
  },
  {
    title: "Learn something",
    desc: "Explain quantum entanglement simply",
    prompt: "Explain quantum entanglement like I am 10 years old",
    Icon: LightbulbIcon,
  },
  {
    title: "Get productive",
    desc: "Plan a startup pitch deck",
    prompt: "Help me plan a startup pitch deck with key sections",
    Icon: RocketIcon,
  },
];

const ACTIVE_CONVERSATION_KEY = "dashycore:active-conversation";

function markActiveConversation(id: string | null): void {
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
  } catch {
    // Best-effort only.
  }
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(() => getStoredModel());
  const [statuses, setStatuses] = useState<string[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HistoryMessage[]>([]);
  /** Title / creation time of the active conversation (cloud-agnostic). */
  const activeTitleRef = useRef<string>("New Chat");
  const activeCreatedAtRef = useRef<number>(Date.now());
  const toast = useToast();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ---------------------------------- auth --------------------------------- */

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      // Shared resolver: local cookie session first, auth-server lookup as
      // a fallback. Uploads and chat sends both need a real userId.
      const session = await getDashySession();
      if (!cancelled && session?.userId) setUserId(session.userId);
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------- shared model preference ----------------------- */

  useEffect(() => {
    const onModelChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ model?: string }>).detail;
      if (detail?.model) setSelectedModel(detail.model);
    };
    window.addEventListener(MODEL_CHANGED_EVENT, onModelChanged);
    return () => window.removeEventListener(MODEL_CHANGED_EVENT, onModelChanged);
  }, []);

  /* ------------------------------ textarea size ---------------------------- */

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const next = Math.min(Math.max(textarea.scrollHeight, 36), 200);
    textarea.style.height = `${next}px`;
  }, [input]);

  /* ------------------------------- auto-scroll ----------------------------- */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, statuses]);

  /* ---------------------------- lifecycle helpers -------------------------- */

  const startNewChat = useCallback((focus: boolean) => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    setStatuses([]);
    setInput("");
    setActiveConversationId(null);
    markActiveConversation(null);
    activeTitleRef.current = "New Chat";
    activeCreatedAtRef.current = Date.now();
    emitChatTitle("DashyCore");
    if (focus) {
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    // Cloud-first load (Supabase when signed in, localStorage otherwise).
    const conversation = await getConversationAsync(id);
    if (!conversation) return;
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setStatuses([]);
    setMessages(conversation.messages);
    setActiveConversationId(conversation.id);
    markActiveConversation(conversation.id);
    activeTitleRef.current = conversation.title;
    activeCreatedAtRef.current = conversation.createdAt || Date.now();
    emitChatTitle(conversation.title);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const onNewChat = () => startNewChat(true);
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id) void openConversation(detail.id);
    };
    const onDelete = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && detail.id === activeConversationId) {
        startNewChat(false);
      }
    };
    window.addEventListener(EVENTS.NEW_CHAT, onNewChat);
    window.addEventListener(EVENTS.OPEN_CONVERSATION, onOpen);
    window.addEventListener(EVENTS.DELETE_CONVERSATION, onDelete);
    return () => {
      window.removeEventListener(EVENTS.NEW_CHAT, onNewChat);
      window.removeEventListener(EVENTS.OPEN_CONVERSATION, onOpen);
      window.removeEventListener(EVENTS.DELETE_CONVERSATION, onDelete);
    };
  }, [activeConversationId, openConversation, startNewChat]);

  /* ----------------------- "/" focuses the composer ------------------------ */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* ------------------------------- streaming ------------------------------- */

  const persistConversation = useCallback(
    (conversationId: string, msgs: HistoryMessage[], model: string, title?: string) => {
      if (title) activeTitleRef.current = title;
      const conversation: Conversation = {
        id: conversationId,
        title: activeTitleRef.current,
        model,
        messages: msgs,
        createdAt: activeCreatedAtRef.current,
        updatedAt: Date.now(),
      };
      // Cloud-first: Supabase when signed in, localStorage when signed out.
      void saveConversationAsync(conversation);
      return conversation;
    },
    []
  );

  /**
   * Streams an assistant reply from the real dashy-flow-state worker into
   * the given assistant message bubble, token by token.
   *
   * `history` is the FULL conversation thread (all prior user+assistant
   * turns in order, ending with the current user message) and is sent on
   * every request so the worker sees the entire conversation — no earlier
   * turns are dropped.
   */
  const streamAssistantReply = useCallback(
    async (
      promptText: string,
      assistantMessageId: string,
      conversationId: string,
      model: string,
      history: ChatHistoryEntry[],
      authToken?: string
    ): Promise<void> => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStatuses([]);

      try {
        await sendChatMessage(
          {
            message: promptText,
            model,
            userId: userId ?? undefined,
            agentMode: false,
            conversationId,
            history,
            authToken,
            signal: controller.signal,
          },
          {
            onDelta: (delta) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, content: m.content + delta }
                    : m
                )
              );
            },
            onStatus: (next) => setStatuses(next.slice(-4)),
            onDone: () => {
              setStatuses([]);
            },
          }
        );
      } catch (error) {
        if (error instanceof ChatClientError && error.kind === "aborted") {
          // User pressed stop — keep whatever has streamed so far.
        } else {
          const message =
            error instanceof ChatClientError
              ? error.message
              : "Connection error to dashy-flow-state. Please try again.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    content:
                      m.content.length > 0
                        ? `${m.content}\n\n> ⚠️ ${message}`
                        : `⚠️ ${message}`,
                  }
                : m
            )
          );
          toast.error("Message failed", message);
        }
      } finally {
        abortControllerRef.current = null;
        setIsStreaming(false);
        persistConversation(conversationId, messagesRef.current, model);
      }
    },
    [persistConversation, toast, userId]
  );

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const promptText = (textToSend ?? input).trim();
      if (!promptText || isStreaming) return;

      setInput("");
      setStatuses([]);

      let conversationId = activeConversationId;
      if (!conversationId) {
        conversationId = newConversationId();
        setActiveConversationId(conversationId);
        markActiveConversation(conversationId);
      }

      const userMessage: HistoryMessage = {
        id: newConversationId(),
        role: "user",
        content: promptText,
        timestamp: Date.now(),
      };
      const assistantMessage: HistoryMessage = {
        id: newConversationId(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        model: selectedModel,
      };

      const withUserMessage = [...messages, userMessage, assistantMessage];
      setMessages(withUserMessage);

      // FULL-HISTORY payload: every prior turn of this conversation
      // (user + assistant, in send order) plus the message being sent
      // right now. Nothing is truncated and no earlier turns are dropped.
      const history: ChatHistoryEntry[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: promptText },
      ];

      // Title the conversation from its first user message (stable across
      // turns, independent of which backend stores the thread).
      const firstUserMessage = messages.find((m) => m.role === "user");
      const title = firstUserMessage
        ? titleFromContent(firstUserMessage.content)
        : titleFromContent(promptText);
      emitChatTitle(title);
      persistConversation(conversationId, withUserMessage, selectedModel, title);

      let authToken: string | undefined;
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        authToken = session?.access_token;
      } catch {
        // Token lookup is best-effort; the client falls back to localStorage.
      }

      setIsStreaming(true);
      await streamAssistantReply(
        promptText,
        assistantMessage.id,
        conversationId,
        selectedModel,
        history,
        authToken
      );
    },
    [
      activeConversationId,
      input,
      isStreaming,
      messages,
      persistConversation,
      selectedModel,
      streamAssistantReply,
    ]
  );

  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      if (isStreaming) return;
      const index = messages.findIndex((m) => m.id === assistantMessageId);
      if (index <= 0) return;
      const userMessage = messages[index - 1];
      if (!userMessage || userMessage.role !== "user") return;

      const freshAssistant: HistoryMessage = {
        id: newConversationId(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        model: selectedModel,
      };
      const withoutOld = messages
        .filter((m) => m.id !== assistantMessageId)
        .concat(freshAssistant);
      setMessages(withoutOld);

      const conversationId = activeConversationId ?? newConversationId();
      if (!activeConversationId) {
        setActiveConversationId(conversationId);
        markActiveConversation(conversationId);
      }
      persistConversation(conversationId, withoutOld, selectedModel);

      // FULL-HISTORY payload for regeneration: every turn before the one
      // being regenerated, ending with its user message — identical to
      // what a fresh send of that message would carry.
      const history: ChatHistoryEntry[] = messages
        .slice(0, index)
        .map((m) => ({ role: m.role, content: m.content }));

      setIsStreaming(true);
      void streamAssistantReply(
        userMessage.content,
        freshAssistant.id,
        conversationId,
        selectedModel,
        history
      );
    },
    [
      activeConversationId,
      isStreaming,
      messages,
      persistConversation,
      selectedModel,
      streamAssistantReply,
    ]
  );

  const handleCopy = useCallback(
    async (content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Copy failed", "Clipboard access was denied.");
      }
    },
    [toast]
  );

  /**
   * Zero-cost <IMG> engine (pollinations.ai) — NO dashy-flow-state call.
   * Takes the composer prompt, then immediately appends a user message and an
   * assistant message that renders the generated image as markdown.
   */
  const handleGenerateImage = useCallback(
    (promptFromComposer?: string) => {
      const prompt = (promptFromComposer ?? input).trim();
      if (!prompt || isStreaming) {
        if (!prompt) {
          toast.error(
            "Describe an image first",
            "Type what you want to generate, then tap the <IMG> button."
          );
        }
        return;
      }

      setInput("");
      setStatuses([]);

      let conversationId = activeConversationId;
      if (!conversationId) {
        conversationId = newConversationId();
        setActiveConversationId(conversationId);
        markActiveConversation(conversationId);
      }

      const engine = "img" as const;
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        prompt
      )}?width=1024&height=1024&nologo=true&seed=${Math.floor(
        Math.random() * 100000
      )}`;

      const userMessage: HistoryMessage = {
        id: newConversationId(),
        role: "user",
        content: prompt,
        timestamp: Date.now(),
      };
      const assistantMessage: HistoryMessage = {
        id: newConversationId(),
        role: "assistant",
        content: `![<IMG> generated](${imageUrl})`,
        timestamp: Date.now(),
        engine,
      };

      const withMessages = [...messages, userMessage, assistantMessage];
      setMessages(withMessages);

      const firstUserMessage = messages.find((m) => m.role === "user");
      const title = firstUserMessage
        ? titleFromContent(firstUserMessage.content)
        : titleFromContent(prompt);
      emitChatTitle(title);
      persistConversation(conversationId, withMessages, selectedModel, title);

      toast.success(
        "<IMG> engine",
        `Rendering “${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}” — it may take a moment to load.`
      );
    },
    [activeConversationId, input, isStreaming, messages, persistConversation, selectedModel, toast]
  );

  /**
   * Hands a fenced code block to D-Code: stashes the snapshot in
   * sessionStorage and opens a scratch project seeded with it. Purely
   * client-side — the SSE stream is untouched.
   */
  const handleOpenInDcode = useCallback(
    (code: string, language: string) => {
      try {
        window.sessionStorage.setItem(
          DCODE_INCOMING_KEY,
          JSON.stringify({ code, language })
        );
      } catch {
        // Storage unavailable — D-Code will open with the starter file.
      }
      router.push("/d-code");
    },
    [router]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {messages.length === 0 ? (
        /* ------------------------------- HERO ------------------------------- */
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4">
          <Image
            src="/icon-512.png"
            alt="DashyCore"
            width={64}
            height={64}
            priority
            className="mb-6 rounded-2xl object-contain shadow-lg shadow-cyan-500/20"
          />

          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            How can I help you <span className="text-gradient">today?</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Ask me anything, get creative, write code, or explore ideas
          </p>

          {/* 2x2 action cards */}
          <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            {ACTIONS.map(({ title, desc, prompt, Icon, image }) => (
              <button
                key={title}
                type="button"
                onClick={() => {
                  if (image) {
                    handleGenerateImage(prompt);
                  } else {
                    void handleSend(prompt);
                  }
                }}
                disabled={isStreaming}
                className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all hover:border-cyan-400/30 hover:bg-white/[0.04] hover:shadow-lg hover:shadow-cyan-500/5 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                  <Icon className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-100">{title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>
                </div>
                <ArrowUpRightIcon className="h-4 w-4 flex-shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-400" />
              </button>
            ))}
          </div>

          <p className="mt-8 text-xs text-zinc-600">
            Press{" "}
            <kbd className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              /
            </kbd>{" "}
            to focus input
          </p>
        </div>
      ) : (
        /* ---------------------------- MESSAGE THREAD ------------------------ */
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              isStreaming={isStreaming}
              statuses={statuses}
              onCopy={() => void handleCopy(message.content)}
              onOpenInDcode={handleOpenInDcode}
              onRegenerate={() => handleRegenerate(message.id)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* --------------------- BOTTOM-ANCHORED INPUT BAR --------------------- */}
      <div className="flex-shrink-0 border-t border-white/[0.06] bg-navy/70 p-4 backdrop-blur-2xl">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.1] bg-white/[0.045] px-3 py-2.5 shadow-inner shadow-black/10 transition-colors focus-within:border-cyan-400/60 focus-within:ring-4 focus-within:ring-cyan-400/10">
            <AttachmentButton
              userId={userId}
              disabled={isStreaming}
              className="h-8 w-8 flex-shrink-0"
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message DashyCore…"
              rows={1}
              disabled={isStreaming}
              className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => handleGenerateImage()}
              disabled={!input.trim() || isStreaming}
              aria-label="Generate image with <IMG> Engine"
              title="Generate image with <IMG> Engine"
              className="flex h-9 flex-shrink-0 items-center gap-1 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-2.5 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ImageIcon className="h-4 w-4" />
              IMG
            </button>
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generating"
                title="Stop generating"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20"
              >
                <SquareIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim() || isStreaming}
                aria-label="Send message"
                title="Send message"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-600">
            DashyCore can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Message row (old peak style)                                               */
/* ========================================================================== */

function MessageRow({
  message,
  isStreaming,
  statuses,
  onCopy,
  onOpenInDcode,
  onRegenerate,
}: {
  message: HistoryMessage;
  isStreaming: boolean;
  statuses: string[];
  onCopy: () => void;
  onOpenInDcode: (code: string, language: string) => void;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const isAssistantEmpty = !isUser && message.content.length === 0;
  const isThisStreaming = !isUser && isStreaming;
  const modelLabel = message.model ? getModelById(message.model).label : null;

  const handleCopyClick = async () => {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`group flex w-full gap-3 px-4 py-4 ${isUser ? "justify-end" : "justify-start"}`}>
      {/* Assistant avatar */}
      {!isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500">
          <SparklesIcon className="h-4 w-4 text-white" />
        </div>
      )}

      <div className={`max-w-[85%] min-w-0 space-y-2 ${isUser ? "flex flex-col items-end" : ""}`}>
        {/* Model / engine badge */}
        {!isUser && (modelLabel || message.engine === "img") && (
          <div className="flex items-center gap-2">
            {message.engine === "img" ? (
              <span className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                &lt;IMG&gt; engine
              </span>
            ) : modelLabel ? (
              <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                {modelLabel}
              </span>
            ) : null}
          </div>
        )}

        {/* Streaming status line (worker statuses when available) */}
        {!isUser && isThisStreaming && statuses.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-zinc-600 border-t-cyan-400" />
            <span className="text-xs text-zinc-500">{statuses[statuses.length - 1]}</span>
          </div>
        )}

        {/* Bubble */}
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm border border-cyan-400/15 bg-cyan-500/10 px-4 py-3 text-sm leading-relaxed text-zinc-100">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : isAssistantEmpty ? (
          <div className="rounded-2xl rounded-tl-sm border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex min-h-[20px] items-center gap-1.5 py-0.5">
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0.15s]" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0.3s]" />
            </div>
          </div>
        ) : (
          <div className="relative rounded-2xl rounded-tl-sm border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="md-prose">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                components={{
                  a: (props) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                  code: (props) => <CodeSpan {...props} />,
                  pre: (props) => <PreBlock {...props} onOpenInDcode={onOpenInDcode} />,
                  img: (props) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      {...props}
                      loading="lazy"
                      alt={props.alt || "<IMG> generated"}
                      className="my-2 max-w-full rounded-xl border border-white/[0.08] object-contain transition-colors hover:border-cyan-400/50"
                    />
                  ),
                }}
              >
                {message.content}
              </Markdown>
              {isThisStreaming && (
                <span className="stream-cursor ml-0.5 inline-block h-4 w-[7px] translate-y-[3px] rounded-[2px] bg-cyan-400/80" />
              )}
            </div>

            {/* Copy / Regenerate — reveal on hover */}
            {!isThisStreaming && (
              <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-[#0d1020]/95 p-0.5 opacity-0 shadow-lg shadow-black/40 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => void handleCopyClick()}
                  title={copied ? "Copied" : "Copy response"}
                  aria-label="Copy response"
                  className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  {copied ? (
                    <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <CopyIcon className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onRegenerate}
                  title="Regenerate response"
                  aria-label="Regenerate response"
                  className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-500">
          <UserIcon className="h-4 w-4 text-white" />
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Markdown helpers                                                           */
/* ========================================================================== */

/** Recovers the raw text of a code element (works mid-stream). */
function textFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (isValidElement(children)) {
    return textFromChildren(
      (children.props as { children?: ReactNode }).children
    );
  }
  return "";
}

/** Extracts the fenced-block language (e.g. "language-ts" → "ts"). */
function languageFromNode(children: ReactNode): string {
  if (isValidElement(children)) {
    const className =
      (children.props as { className?: string }).className ?? "";
    const match = /language-([\w+#.-]+)/.exec(className);
    if (match) return match[1];
  }
  return "";
}

/**
 * `code` renderer — styled chip for inline code, plain element for fenced
 * blocks (the surrounding PreBlock provides the block chrome).
 */
function CodeSpan(props: React.HTMLAttributes<HTMLElement>) {
  const { className, children, ...rest } = props;
  const raw = typeof children === "string" ? children : "";
  const isBlock =
    (typeof className === "string" && className.includes("language-")) ||
    raw.includes("\n");
  if (isBlock) {
    return (
      <code {...rest} className={className}>
        {children}
      </code>
    );
  }
  return (
    <code
      {...rest}
      className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5 font-mono text-[12.5px] text-cyan-200"
    >
      {children}
    </code>
  );
}

/**
 * Fenced code block: header bar with the language label (left) and Copy +
 * "Open in D-Code" actions (right). The snapshots are taken from the
 * currently rendered children, so both work while the block is still
 * streaming in.
 */
function PreBlock({
  onOpenInDcode,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  onOpenInDcode: (code: string, language: string) => void;
}) {
  const { children, ...rest } = props;
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);

  const language = languageFromNode(children);
  const code = textFromChildren(children);

  const handleCopyClick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — leave the button in its default state.
    }
  };

  const handleOpenInDcode = () => {
    onOpenInDcode(code, language);
    setOpened(true);
    window.setTimeout(() => setOpened(false), 2000);
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleOpenInDcode}
            title={
              opened ? "Opening in D-Code…" : "Open this code in the D-Code editor"
            }
            aria-label="Open in D-Code editor"
            className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 font-sans text-[10px] font-medium transition-colors ${
              opened
                ? "text-cyan-300"
                : "text-zinc-500 hover:bg-white/[0.06] hover:text-cyan-300"
            }`}
          >
            <CodeIcon className="h-3 w-3" />
            {opened ? "Opening…" : "Open in D-Code"}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyClick()}
            title={copied ? "Copied!" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code to clipboard"}
            className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 font-sans text-[10px] font-medium transition-colors ${
              copied
                ? "text-emerald-400"
                : "text-zinc-500 hover:bg-white/[0.06] hover:text-cyan-300"
            }`}
          >
            {copied ? (
              <CheckIcon className="h-3 w-3" />
            ) : (
              <CopyIcon className="h-3 w-3" />
            )}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        {...rest}
        className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-zinc-200"
      >
        {children}
      </pre>
    </div>
  );
}
