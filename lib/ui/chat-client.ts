/**
 * DashyCore v7 — Chat client.
 *
 * Client-side boundary to the real `dashy-flow-state` Cloudflare Worker
 * (the chat/model/RAG endpoint). Configured via NEXT_PUBLIC_DASHY_FLOW_STATE_URL.
 *
 * AUTH: Uses Supabase Auth — the browser session access token is sent as a
 * Bearer token, matching the existing worker/ingest.ts contract.
 *
 * This client never fabricates content. If the Worker is unreachable or
 * unconfigured, it fails with a clear, user-safe error.
 */

import type { DashyModelId } from "./models";

export interface ChatRequest {
  message: string;
  model: DashyModelId;
  conversationId?: string;
  /** Stable per-browser user id (from lib/ui/auth). */
  userId?: string;
  /** Agent Mode flag — sent to the worker for agentic routing. */
  agentMode?: boolean;
}

export interface ChatMemory {
  content: string;
  title?: string;
  sourceType?: string;
  similarity?: number;
}

export interface ChatResponse {
  content: string;
  done: boolean;
  model?: string;
  memories?: ChatMemory[];
  statusStates?: string[];
  error?: string;
  conversationId?: string;
  /** Agent pipeline labels: e.g. ["🧠 Planning", "🔎 Memory Search", "✅ Complete"]. */
  activity?: string[];
  /** Routing mode reported by the backend ("agent" | "standard" …). */
  mode?: string;
  /** Model id actually used by the router. */
  modelId?: string;
}

export type WorkerStatus =
  | { state: "online" }
  | { state: "offline"; error?: string }
  | { state: "unconfigured" };

export type ChatStreamEvent =
  | { type: "status"; statuses: string[] }
  | { type: "delta"; text: string }
  | { type: "memory"; memories: ChatMemory[] }
  | { type: "done"; conversationId?: string }
  | { type: "error"; message: string };

export class ChatClientError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "unconfigured"
      | "unauthorized"
      | "rate_limited"
      | "worker_error"
      | "network"
      | "empty"
      | "server",
    public readonly status?: number
  ) {
    super(message);
    this.name = "ChatClientError";
  }
}

function workerUrl(): string {
  const url = process.env.NEXT_PUBLIC_DASHY_FLOW_STATE_URL ?? "";
  if (!url.trim()) {
    throw new ChatClientError(
      "The chat backend is not configured. Set NEXT_PUBLIC_DASHY_FLOW_STATE_URL.",
      "unconfigured"
    );
  }
  return url.replace(/\/$/, "");
}

function getSessionToken(): string {
  // Supabase Auth stores sessions in localStorage under `sb-`-prefixed keys.
  if (typeof window === "undefined") return "";
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const token =
          parsed?.access_token ?? parsed?.[key]?.access_token;
        if (token) return token;
      } catch {
        // Skip unparsable entries.
      }
    }
  } catch {
    // localStorage unavailable (privacy mode, SSR).
  }
  return "";
}

function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseChatResponse(raw: unknown): ChatResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new ChatClientError("The backend returned an empty response.", "empty");
  }

  const obj = raw as Record<string, unknown>;

  const content =
    typeof obj.reply === "string"
      ? obj.reply
      : typeof obj.content === "string"
        ? obj.content
        : typeof obj.response === "string"
          ? obj.response
          : typeof obj.text === "string"
            ? obj.text
            : "";

  const memories = Array.isArray(obj.memories)
    ? (obj.memories as unknown[]).map((m) => {
        const mem = (m ?? {}) as Record<string, unknown>;
        return {
          content:
            typeof mem.content === "string"
              ? mem.content
              : typeof mem.text === "string"
                ? mem.text
                : "",
          title: typeof mem.title === "string" ? mem.title : undefined,
          sourceType:
            typeof mem.source_type === "string" ? mem.source_type : undefined,
          similarity:
            typeof mem.similarity === "number" ? mem.similarity : undefined,
        };
      }).filter((m) => m.content.length > 0)
    : [];

  const statuses = Array.isArray(obj.status_states)
    ? (obj.status_states as unknown[]).filter((s): s is string => typeof s === "string")
    : typeof obj.status === "string"
      ? [obj.status]
      : [];

  // Agent activity timeline labels (safe, high-level only).
  const activity = Array.isArray(obj.activity)
    ? (obj.activity as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  return {
    content,
    done: obj.done !== false,
    model:
      typeof obj.model === "string"
        ? obj.model
        : typeof obj.modelId === "string"
          ? obj.modelId
          : typeof obj.model_id === "string"
            ? obj.model_id
            : undefined,
    memories,
    statusStates: statuses,
    error: typeof obj.error === "string" ? obj.error : undefined,
    conversationId:
      typeof obj.conversation_id === "string"
        ? obj.conversation_id
        : typeof obj.conversationId === "string"
          ? obj.conversationId
          : undefined,
    activity,
    mode: typeof obj.mode === "string" ? obj.mode : undefined,
    modelId:
      typeof obj.modelId === "string"
        ? obj.modelId
        : typeof obj.model_id === "string"
          ? obj.model_id
          : undefined,
  };
}

export function getWorkerStatus(): Promise<WorkerStatus> {
  const url = process.env.NEXT_PUBLIC_DASHY_FLOW_STATE_URL ?? "";
  if (!url.trim()) {
    return Promise.resolve({ state: "unconfigured" });
  }
  return fetch(`${url.replace(/\/$/, "")}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  })
    .then((res) =>
      res.ok
        ? { state: "online" as const }
        : { state: "offline" as const, error: `HTTP ${res.status}` }
    )
    .catch(() => ({ state: "offline" as const }));
}

export async function sendChatMessage(
  request: ChatRequest,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<ChatResponse> {
  const url = workerUrl();

  let res: Response;
  try {
    res = await fetch(`${url}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        message: request.message,
        model: request.model,
        ...(request.userId ? { userId: request.userId } : {}),
        ...(request.agentMode !== undefined
          ? { agentMode: request.agentMode }
          : {}),
        ...(request.conversationId
          ? { conversation_id: request.conversationId }
          : {}),
      }),
    });
  } catch {
    throw new ChatClientError(
      "Could not reach the DashyCore backend. Check your network connection.",
      "network"
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new ChatClientError(
      "Your session has expired. Please sign in again.",
      "unauthorized",
      res.status
    );
  }

  if (res.status === 429) {
    throw new ChatClientError(
      "You are sending messages too quickly. Please wait and retry.",
      "rate_limited",
      res.status
    );
  }

  if (!res.ok) {
    throw new ChatClientError(
      "The backend could not process your request. Please try again.",
      "server",
      res.status
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return consumeStream(res, onEvent);
  }

  if (!contentType.includes("application/json")) {
    throw new ChatClientError(
      "The backend returned an unexpected response format.",
      "server",
      res.status
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ChatClientError("The backend returned malformed data.", "server", res.status);
  }

  const parsed = parseChatResponse(raw);
  if (parsed.memories && parsed.memories.length > 0) {
    onEvent?.({ type: "memory", memories: parsed.memories });
  }
  if (parsed.activity && parsed.activity.length > 0) {
    onEvent?.({ type: "status", statuses: parsed.activity });
  } else if (parsed.statusStates && parsed.statusStates.length > 0) {
    onEvent?.({ type: "status", statuses: parsed.statusStates });
  }
  if (parsed.done) {
    onEvent?.({ type: "done", conversationId: parsed.conversationId });
  }
  return parsed;
}

async function consumeStream(
  res: Response,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<ChatResponse> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new ChatClientError("The backend returned an empty stream.", "empty");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finalConversationId: string | undefined;
  const finalMemories: ChatMemory[] = [];

  const processEvent = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (typeof event !== "object" || event === null) return;
      const e = event as Record<string, unknown>;

      if (typeof e.delta === "string" && e.delta.length > 0) {
        fullText += e.delta;
        onEvent?.({ type: "delta", text: e.delta });
      }
      if (typeof e.content === "string" && e.content.length > 0) {
        fullText += e.content;
        onEvent?.({ type: "delta", text: e.content });
      }
      if (typeof e.status === "string") {
        onEvent?.({ type: "status", statuses: [e.status] });
      }
      if (Array.isArray(e.memories)) {
        const mems = (e.memories as unknown[])
          .map((m) => {
            const mem = (m ?? {}) as Record<string, unknown>;
            return {
              content: typeof mem.content === "string" ? mem.content : "",
              title: typeof mem.title === "string" ? mem.title : undefined,
            };
          })
          .filter((m) => m.content.length > 0);
        finalMemories.push(...mems);
        onEvent?.({ type: "memory", memories: mems });
      }
      if (typeof e.conversation_id === "string") {
        finalConversationId = e.conversation_id;
      }
      if (e.done === true) {
        onEvent?.({ type: "done", conversationId: finalConversationId });
      }
    } catch {
      // Skip malformed chunks; never crash consumer.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processEvent(line);
  }
  if (buffer.length > 0) processEvent(buffer);

  if (!fullText) {
    throw new ChatClientError("The assistant returned an empty response.", "empty");
  }

  onEvent?.({ type: "done", conversationId: finalConversationId });

  return {
    content: fullText,
    done: true,
    memories: finalMemories,
    conversationId: finalConversationId,
  };
}