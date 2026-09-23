"use client";

/**
 * DashyCore v7 — Dashy Agent workspace (`/agents`).
 *
 * Talks to dashy-flow-state in Agent Mode: a single JSON POST
 * (`agentMode: true`, `userId` required, full `messages[]` thread).
 * Never SSE. Never gameMode. Never Pollinations.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { createClient } from "@/lib/supabase/client";
import {
  AGENT_MODEL_ID,
  ChatClientError,
  sendAgentMessage,
  type AgentActivity,
  type ChatMemory,
} from "@/lib/chat-client";
import { useToast } from "@/components/Toast";
import {
  BotIcon,
  ChevronDownIcon,
  LoaderIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
} from "@/components/icons";

const DISPLAY_MODEL = "z.ai/glm-5";
const LOGIN_TOAST = "Please log in to use Agent mode";

interface AgentTurn {
  role: "user" | "assistant";
  content: string;
  activity?: AgentActivity[];
  memories?: ChatMemory[];
  modelId?: string;
  error?: string;
}

const STARTER_PROMPTS = [
  {
    label: "Search my docs for…",
    prompt: "Search my docs for the most recent notes and summarize them.",
  },
  {
    label: "Summarize what you know about…",
    prompt: "Summarize what you know about me from memory.",
  },
  {
    label: "What can you recall?",
    prompt: "What do you remember about my projects?",
  },
];

function storageKey(userId: string): string {
  return `dashycore:agent-thread:${userId}`;
}

function loadThread(userId: string): AgentTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (turn): turn is AgentTurn =>
        Boolean(turn) &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string"
    );
  } catch {
    return [];
  }
}

function saveThread(userId: string, turns: AgentTurn[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(turns));
  } catch {
    // Best-effort persistence — quota / private mode.
  }
}

export default function AgentsPage() {
  const toast = useToast();
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [headerModel, setHeaderModel] = useState(DISPLAY_MODEL);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<AgentTurn[]>([]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (session?.user) {
          setUserId(session.user.id);
          setAuthToken(session.access_token);
        } else {
          setUserId(null);
          setAuthToken(null);
        }
      } catch {
        if (!cancelled) {
          setUserId(null);
          setAuthToken(null);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setHydrated(false);
      return;
    }
    setTurns(loadThread(userId));
    setHydrated(true);
  }, [userId]);

  useEffect(() => {
    if (!userId || !hydrated) return;
    saveThread(userId, turns);
  }, [turns, userId, hydrated]);

  useEffect(() => {
    const last = [...turns].reverse().find((t) => t.role === "assistant" && t.modelId);
    if (last?.modelId) setHeaderModel(last.modelId);
  }, [turns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 38), 160)}px`;
  }, [input]);

  const handleSend = useCallback(
    async (preset?: string) => {
      const message = (preset ?? input).trim();
      if (!message || busy) return;

      if (!authReady) return;
      if (!userId) {
        toast.error(LOGIN_TOAST);
        setError(LOGIN_TOAST);
        return;
      }

      setInput("");
      setError(null);

      const userTurn: AgentTurn = { role: "user", content: message };
      const nextTurns = [...turnsRef.current, userTurn];
      setTurns(nextTurns);
      turnsRef.current = nextTurns;
      setBusy(true);

      const history = nextTurns
        .filter((t) => !t.error && t.content.trim().length > 0)
        .map((t) => ({ role: t.role, content: t.content }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await sendAgentMessage({
          message,
          userId,
          authToken: authToken ?? undefined,
          history,
          signal: controller.signal,
          model: AGENT_MODEL_ID,
        });
        const assistant: AgentTurn = {
          role: "assistant",
          content: result.content,
          activity: result.activity,
          memories: result.memories,
          modelId: result.modelId ?? AGENT_MODEL_ID,
        };
        const withReply = [...turnsRef.current, assistant];
        setTurns(withReply);
        turnsRef.current = withReply;
        if (assistant.modelId) setHeaderModel(assistant.modelId);
      } catch (err) {
        if (err instanceof ChatClientError && err.kind === "aborted") {
          return;
        }
        const messageText =
          err instanceof ChatClientError
            ? err.message
            : "Connection error to dashy-flow-state. Please try again.";
        setError(messageText);
        const failTurn: AgentTurn = {
          role: "assistant",
          content: "",
          error: messageText,
        };
        const withError = [...turnsRef.current, failTurn];
        setTurns(withError);
        turnsRef.current = withError;
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [authReady, authToken, busy, input, toast, userId]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-3xl flex-col px-6 py-6">
      <div className="flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 shadow-lg shadow-cyan-500/10">
            <BotIcon className="h-5 w-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-white">
              Dashy Agent
            </h1>
            <p className="truncate text-xs text-zinc-500">{headerModel}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
              <SparklesIcon className="h-6 w-6 text-cyan-400" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-200">
              Ask the Dashy Agent anything
            </p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
              It searches your memory, then returns one answer with a
              transparent activity log.
            </p>
            <div className="mt-6 flex w-full max-w-md flex-col gap-2">
              {STARTER_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => void handleSend(item.prompt)}
                  disabled={busy}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:border-cyan-400/30 hover:bg-cyan-500/5 hover:text-cyan-200 disabled:opacity-50"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, index) => <AgentTurnRow key={index} turn={turn} />)
        )}

        {busy && (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            <span className="flex items-center gap-1.5">
              Agent is thinking
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0.3s]" />
              </span>
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 pt-4">
        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-cyan-400/30">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the Dashy Agent…"
            rows={1}
            disabled={busy}
            className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none disabled:opacity-60"
          />
          {busy ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop agent"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20"
            >
              <SquareIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || busy}
              aria-label="Send to agent"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300"
          >
            {error}
          </p>
        )}
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          Dashy Agent can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}

function AgentTurnRow({ turn }: { turn: AgentTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-cyan-400/15 bg-cyan-500/10 px-4 py-3 text-sm leading-relaxed text-zinc-100">
          <p className="whitespace-pre-wrap">{turn.content}</p>
        </div>
      </div>
    );
  }

  if (turn.error) {
    return (
      <div className="flex justify-start">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500">
          <BotIcon className="h-4 w-4 text-white" />
        </div>
        <div className="ml-3 max-w-[85%] rounded-2xl rounded-tl-sm border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200">
          ⚠️ {turn.error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500">
        <BotIcon className="h-4 w-4 text-white" />
      </div>
      <div className="ml-3 max-w-[85%] min-w-0 space-y-2">
        {turn.modelId && (
          <span className="inline-flex items-center rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
            {turn.modelId}
          </span>
        )}
        <div className="rounded-2xl rounded-tl-sm border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div className="md-prose">
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={{
                a: (props) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
              }}
            >
              {turn.content}
            </Markdown>
          </div>
        </div>
        {turn.memories && turn.memories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {turn.memories.map((memory, index) => (
              <span
                key={index}
                title={memory.content.slice(0, 240)}
                className="inline-flex max-w-full items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300"
              >
                Used memory
                {memory.title ? `: ${memory.title}` : ""}
              </span>
            ))}
          </div>
        )}
        {turn.activity && turn.activity.length > 0 && (
          <AgentActivityLog activity={turn.activity} />
        )}
      </div>
    </div>
  );
}

function AgentActivityLog({ activity }: { activity: AgentActivity[] }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-400/20 bg-cyan-500/[0.04]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-cyan-500/[0.06]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        <span className="text-xs font-semibold text-cyan-300">
          Agent activity
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
          {activity.length} {activity.length === 1 ? "step" : "steps"}
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-cyan-400/10 px-3 py-2.5">
          {activity.map((step, index) => (
            <div key={index} className="flex items-start gap-2 text-xs">
              <span className="mt-px flex-shrink-0 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                {step.type}
              </span>
              {step.message && (
                <span className="min-w-0 flex-1 leading-relaxed text-zinc-400">
                  {step.message}
                </span>
              )}
              {step.tool && (
                <span className="flex-shrink-0 rounded-md border border-white/[0.08] bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  {step.tool}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
