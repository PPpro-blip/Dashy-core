"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const CHAT_WORKER_URL = "https://dashy-flow-state.kamleshprathampandey.workers.dev";

const MODEL_OPTIONS = [
  { id: "dashy-allround", name: "Dashy Allround", badge: "Default" },
  { id: "dashy-superfast", name: "Dashy Superfast", badge: "Groq 120B" },
  { id: "dashy-complexity", name: "Dashy Complexity", badge: "Qwen 27B" },
];

const QUICK_ACTIONS = [
  { label: "Code", prompt: "Help me write clean Next.js 15 TypeScript code.", icon: "</>" },
  { label: "Analyze", prompt: "Can you analyze system architecture and performance bottlenecks?", icon: "📐" },
  { label: "Memory", prompt: "Search workspace memory for my recent notes and project docs.", icon: "🧠" },
  { label: "Write", prompt: "Help me draft a technical proposal and handoff documentation.", icon: "✏️" },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState("dashy-allround");
  const [userDisplayName, setUserDisplayName] = useState<string>("pro player");
  const [userId, setUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabase = createClient();

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "pro player";
        setUserDisplayName(name);
      }
    }
    getUser();
  }, [supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const promptText = (textToSend || input).trim();
    if (!promptText || isStreaming) return;

    setInput("");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: promptText,
      timestamp: Date.now(),
    };

    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch(CHAT_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: selectedModel,
          userId: userId || undefined,
        }),
      });

      if (!response.ok) throw new Error(`Worker status ${response.status}`);
      if (!response.body) throw new Error("No response body stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let accumulatedContent = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6);
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }

              try {
                const parsed = JSON.parse(dataStr);
                const token = parsed.content || parsed.text || parsed.delta || "";
                accumulatedContent += token;
              } catch {
                accumulatedContent += dataStr;
              }

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: accumulatedContent } : m
                )
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("SSE Streaming Error:", error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: "⚠️ Connection error to dashy-flow-state. Please try again." }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-zinc-950 text-zinc-100 max-w-4xl mx-auto w-full px-4 py-6">
      {/* Active Conversation Messages View */}
      {messages.length > 0 ? (
        <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar pb-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className="flex items-start gap-3 max-w-[85%]">
                {msg.role === "assistant" && (
                  <Image
                    src="/icon-512.png"
                    alt="AI"
                    width={28}
                    height={28}
                    className="rounded-lg mt-0.5 object-contain flex-shrink-0"
                  />
                )}
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-none shadow-lg shadow-indigo-950/20"
                      : "bg-zinc-900/90 border border-zinc-800/80 text-zinc-200 rounded-tl-none"
                  }`}
                >
                  {msg.content === "" && msg.role === "assistant" ? (
                    <div className="flex items-center gap-1.5 py-1">
                      <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        /* CLAUDE-STYLE HERO CENTERPIECE */
        <div className="flex-1 flex flex-col items-center justify-center -mt-8 space-y-8">
          {/* Greeting Header */}
          <div className="flex items-center gap-3">
            <Image
              src="/icon-512.png"
              alt="DashyCore Logo"
              width={42}
              height={40}
              priority
              className="rounded-xl object-contain drop-shadow-[0_0_15px_rgba(168,85,247,0.3)]"
            />
            <h1 className="text-3xl md:text-4xl font-serif tracking-tight text-zinc-100">
              Hey there, <span className="text-white font-medium">{userDisplayName}</span>
            </h1>
          </div>

          {/* HERO INPUT CARD (CLAUDE-STYLE) */}
          <div className="w-full max-w-2xl bg-zinc-900/90 border border-zinc-800/90 rounded-2xl p-4 shadow-2xl shadow-black/60 focus-within:border-zinc-700 transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask DashyCore anything or type / for skills..."
              rows={3}
              disabled={isStreaming}
              className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none"
            />

            {/* Controls Bar Inside Input Card */}
            <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60 mt-1">
              <div className="flex items-center gap-2">
                {/* RAG Attachment trigger */}
                <button
                  type="button"
                  title="Upload Context Document"
                  className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all text-xs flex items-center justify-center"
                >
                  <span className="text-base font-light">+</span>
                </button>

                {/* Mode Pill */}
                <div className="flex items-center bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-0.5 text-xs text-zinc-400">
                  <span className="px-2.5 py-1 bg-zinc-800 text-zinc-200 rounded-md font-medium">
                    Chat
                  </span>
                  <span className="px-2.5 py-1 hover:text-zinc-200 transition-all cursor-not-allowed opacity-50">
                    Cowork
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Model Dropdown Picker */}
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-700 font-medium cursor-pointer"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id} className="bg-zinc-900 text-zinc-200">
                      {m.name} ({m.badge})
                    </option>
                  ))}
                </select>

                {/* Send Button */}
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!input.trim() || isStreaming}
                  className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all disabled:opacity-30 disabled:hover:bg-indigo-600"
                >
                  {isStreaming ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Sleek Action Pills Under Input */}
          <div className="flex flex-wrap justify-center gap-2.5 max-w-2xl">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => handleSendMessage(action.prompt)}
                disabled={isStreaming}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-800/80 hover:border-zinc-700 text-xs text-zinc-300 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <span className="font-mono text-zinc-400">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating Bottom Input Bar when conversation is active */}
      {messages.length > 0 && (
        <div className="pt-3 border-t border-zinc-800/80 bg-zinc-950">
          <div className="relative flex items-center bg-zinc-900/90 border border-zinc-800 rounded-xl px-4 py-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask DashyCore anything... (Shift+Enter for newline)"
              rows={1}
              disabled={isStreaming}
              className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none pr-10"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!input.trim() || isStreaming}
              className="absolute right-3 p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all disabled:opacity-30"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}