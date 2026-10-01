"use client";

/**
 * DashyCore v7 — Dashy Agent (z.ai/glm-5) workspace.
 *
 * An interactive agent console that talks to the dashy-flow-state worker in
 * Agent Mode. Agent Mode returns a single JSON document (never SSE):
 *
 *   { success: true, mode: "agent", modelId, reply, memories: [], activity: [{ type, message, tool }] }
 *
 * The assistant reply is rendered as markdown; the `activity` timeline is
 * shown below it in an interactive, collapsible cyan "Agent Thought Log".
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { createClient } from "@/lib/supabase/client";
import {
  ChatClientError,
  sendChatMessage,
  type AgentActivity,
} from "@/lib/chat-client";
import {
  BotIcon,
  ChevronDownIcon,
  CodeIcon,
  LoaderIcon,
  SendIcon,
  SparklesIcon,
} from "@/components/icons";

/** The agent model requested from the dashy-flow-state worker. */
const AGENT_MODEL_ID = "z.ai/glm-5";

interface AgentTurn {
  role: "user" | "assistant";
  content: string;
  activity?: AgentActivity[];
  modelId?: string;
  error?: string;
}

export default function AgentsPage() {
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || !session?.user) return;
        setUserId(session.user.id);
        setAuthToken(session.access_token);
      } catch {
        // Auth is best-effort — Agent Mode still works with the session token.
      }
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const handleSend = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setBusy(true);

    try {
      const result = await sendChatMessage({
        message,
        model: AGENT_MODEL_ID,
        userId: userId ?? undefined,
        authToken: authToken ?? undefined,
        agentMode: true,
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.content,
          activity: result.activity,
          modelId: result.modelId ?? AGENT_MODEL_ID,
        },
      ]);
    } catch (err) {
      const messageText =
        err instanceof ChatClientError
          ? err.message
          : "Connection error to dashy-flow-state. Please try again.";
      setError(messageText);
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "", error: messageText },
      ]);
    } finally {
      setBusy(false);
    }
  }, [authToken, busy, input, userId]);

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
      {/* Hero */}
      <div className="flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 shadow-lg shadow-cyan-500/10">
            <BotIcon className="h-5 w-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-white">
              Dashy Agent <span className="text-cyan-400">(z.ai/glm-5)</span>
            </h1>
            <p className="text-xs text-zinc-500">
              Agent Mode · multi-step reasoning · memory + tool activity log
            </p>
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
              <SparklesIcon className="h-6 w-6 text-cyan-400" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-200">
              Ask the Dashy Agent anything
            </p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
              It plans, searches memory, calls tools and returns one final
              answer with a transparent thought log.
            </p>
          </div>
        ) : (
          turns.map((turn, index) => (
            <AgentTurnRow key={index} turn={turn} />
          ))
        )}

        {busy && (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-500">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            Agent is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 pt-4">
        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-cyan-400/30">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the Dashy Agent…"
            rows={1}
            disabled={busy}
            className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || busy}
            aria-label="Send to agent"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          >
            <SendIcon className="h-4 w-4" />
          </button>
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

/* ========================================================================== */
/* Turn row                                                                    */
/* ========================================================================== */

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
          <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
            <CodeIcon className="h-3 w-3" />
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
        {turn.activity && turn.activity.length > 0 && (
          <AgentThoughtLog activity={turn.activity} />
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Agent Thought Log                                                           */
/* ========================================================================== */

function AgentThoughtLog({ activity }: { activity: AgentActivity[] }) {
  const [open, setOpen] = useState(true);

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
          Agent Thought Log
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
          {open ? "Hide" : "Show"}
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-cyan-400/10 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {activity.map((step, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <span className="text-cyan-400/40" aria-hidden="true">
                    ➔
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <span className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                    [{step.type}]
                  </span>
                  {step.message && (
                    <span className="text-xs text-zinc-400">{step.message}</span>
                  )}
                  {step.tool && (
                    <span className="rounded-md border border-white/[0.08] bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                      {step.tool}
                    </span>
                  )}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
