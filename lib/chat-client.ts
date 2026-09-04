/**
 * DashyCore v7 — Chat client boundary to the live `dashy-flow-state`
 * Cloudflare Worker.
 *
 * This is the single source of truth for the chat wire contract, aligned
 * with `_reference/chat-client.reference.ts`:
 *
 *   POST {base}/chat
 *   Body: { message, model, userId?, agentMode?, conversation_id? }
 *   Auth: `Authorization: Bearer <supabase access token>`
 *
 * The worker may respond in any of these shapes — all are handled here:
 *   1. SSE (`text/event-stream`) with `data:`-prefixed JSON payloads
 *   2. SSE with OpenAI-style `choices[].delta.content` payloads
 *   3. Newline-delimited JSON events (`{ delta, content, status, ... }`)
 *   4. Plain token text stream (raw text lines, no JSON envelope)
 *   5. A single JSON document (`{ reply | content | response | text, ... }`)
 *
 * This client NEVER fabricates content. If the worker is unreachable or
 * the response is empty, it throws a typed `ChatClientError` with a safe,
 * user-facing message.
 */

export const DASHY_FLOW_STATE_URL =
  process.env.NEXT_PUBLIC_DASHY_FLOW_STATE_URL ??
  "https://dashy-flow-state.kamleshprathampandey.workers.dev";

export const DASHY_DIGEST_URL =
  process.env.NEXT_PUBLIC_DASHY_DIGEST_URL ??
  "https://dashy-digest.kamleshprathampandey.workers.dev";

export interface ChatHistoryEntry {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  message: string;
  model: string;
  userId?: string;
  agentMode?: boolean;
  conversationId?: string;
  authToken?: string;
  signal?: AbortSignal;
  /**
   * FULL prior turn history for the active conversation, in send order,
   * ending with the latest user message. Sent alongside `message` (which
   * stays the latest user turn for backward compatibility) so the worker
   * can reconstruct the whole thread — no earlier turns are dropped.
   */
  history?: ChatHistoryEntry[];
}

export interface ChatMemory {
  content: string;
  title?: string;
  sourceType?: string;
  similarity?: number;
}

/**
 * One entry in the worker's agent-mode `activity` timeline.
 *
 * Contract: `activity: [{ type, message, tool }]`.
 */
export interface AgentActivity {
  type: string;
  message?: string;
  tool?: string;
}

export interface ChatCallbacks {
  onDelta?: (text: string) => void;
  onStatus?: (statuses: string[]) => void;
  onMemory?: (memories: ChatMemory[]) => void;
  onDone?: (conversationId?: string) => void;
}

export interface ChatResult {
  content: string;
  conversationId?: string;
  memories: ChatMemory[];
  statusStates: string[];
  /** Agent routing mode reported by the worker ("agent" | "standard" …). */
  mode?: string;
  /** Model id actually used by the worker router. */
  modelId?: string;
  /** Agent pipeline timeline: `[{ type, message, tool }]`. */
  activity?: AgentActivity[];
}

export class ChatClientError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "network"
      | "unauthorized"
      | "rate_limited"
      | "server"
      | "empty"
      | "aborted",
    public readonly status?: number
  ) {
    super(message);
    this.name = "ChatClientError";
  }
}

/** Supabase stores browser sessions under `sb-*` keys in localStorage. */
export function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const token =
          (parsed?.access_token as string | undefined) ??
          ((parsed?.[key] as Record<string, unknown> | undefined)
            ?.access_token as string | undefined);
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

type UnknownRecord = Record<string, unknown>;

/** Extracts a string from the many field names the worker may use. */
function pickString(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function normalizeMemories(raw: unknown): ChatMemory[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ChatMemory => {
      const mem = (item ?? {}) as UnknownRecord;
      const payload = (mem.payload ?? {}) as UnknownRecord;
      const content =
        pickString(mem, ["content", "text"]) ??
        pickString(payload, ["text", "sourceText", "content"]) ??
        "";
      return {
        content,
        title:
          pickString(mem, ["title"]) ?? pickString(payload, ["title", "source"]),
        sourceType: pickString(mem, ["source_type", "sourceType"]),
        similarity:
          typeof mem.similarity === "number"
            ? (mem.similarity as number)
            : typeof mem.score === "number"
              ? (mem.score as number)
              : undefined,
      };
    })
    .filter((m) => m.content.length > 0);
}

function extractStatuses(obj: UnknownRecord): string[] {
  if (Array.isArray(obj.status_states)) {
    return (obj.status_states as unknown[]).filter(
      (s): s is string => typeof s === "string"
    );
  }
  if (Array.isArray(obj.activity)) {
    return (obj.activity as unknown[]).filter(
      (s): s is string => typeof s === "string"
    );
  }
  if (typeof obj.status === "string") return [obj.status];
  return [];
}

/**
 * Normalizes the agent-mode `activity` timeline into a stable shape.
 * Accepts both the contract objects `{ type, message, tool }` and plain
 * strings so older worker versions remain understandable.
 */
function normalizeActivity(raw: unknown): AgentActivity[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): AgentActivity | null => {
      if (typeof item === "string") {
        return { type: "step", message: item };
      }
      const obj = item as UnknownRecord;
      if (!obj || typeof obj !== "object") return null;
      const type = pickString(obj, ["type", "kind"]);
      return {
        type: type ?? "step",
        message: pickString(obj, ["message", "text", "description"]),
        tool: pickString(obj, ["tool", "toolName", "name"]),
      };
    })
    .filter((activity): activity is AgentActivity => activity !== null);
}

/**
 * Parses a single agent-mode JSON document into a ChatResult.
 *
 * The worker contract is:
 *   { success: true, mode: "agent", modelId, reply, memories: [], activity: [{ type, message, tool }] }
 */
function parseAgentResponse(raw: UnknownRecord): ChatResult {
  if (typeof raw.error === "string" && raw.error.length > 0) {
    throw new ChatClientError(raw.error, "server");
  }

  const content =
    pickString(raw, ["reply", "content", "response", "text"]) ?? "";
  const activity = normalizeActivity(raw.activity);

  if (!content && activity.length === 0) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty"
    );
  }

  return {
    content,
    conversationId: extractConversationId(raw),
    memories: normalizeMemories(raw.memories),
    statusStates: extractStatuses(raw),
    mode: pickString(raw, ["mode"]),
    modelId: pickString(raw, ["modelId", "model_id", "model"]),
    activity,
  };
}

/**
 * Reads Agent Mode as a standard JSON POST response (no SSE parsing).
 * Defensively handles text/plain or mislabelled SSE bodies too, using the
 * final `data:` JSON frame when necessary.
 */
async function readAgentModeResponse(res: Response): Promise<ChatResult> {
  const contentType = res.headers.get("content-type") ?? "";
  let raw: unknown;

  if (contentType.includes("application/json")) {
    try {
      raw = await res.json();
    } catch {
      throw new ChatClientError(
        "The backend returned malformed data.",
        "server",
        res.status
      );
    }
  } else {
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) {
      throw new ChatClientError(
        "The assistant returned an empty response. Please try again.",
        "empty"
      );
    }

    if (trimmed.startsWith("{")) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        throw new ChatClientError(
          "The backend returned malformed data.",
          "server",
          res.status
        );
      }
    } else {
      // Mislabeled SSE: use the last `data:`-framed JSON document.
      const frames = trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:") || line.startsWith("{"))
        .map((line) => line.replace(/^data:\s*/, ""));
      const last = frames[frames.length - 1];
      if (!last) {
        throw new ChatClientError(
          "The assistant returned an empty response. Please try again.",
          "empty"
        );
      }
      try {
        raw = JSON.parse(last);
      } catch {
        throw new ChatClientError(
          "The backend returned malformed data.",
          "server",
          res.status
        );
      }
    }
  }

  if (typeof raw !== "object" || raw === null) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty"
    );
  }

  return parseAgentResponse(raw as UnknownRecord);
}

function extractConversationId(obj: UnknownRecord): string | undefined {
  return pickString(obj, ["conversation_id", "conversationId", "id"]);
}

/**
 * Parses ONE parsed-JSON event and reports whatever it contains.
 * Returns the delta text (if any) so callers can accumulate.
 */
function handleJsonEvent(
  event: UnknownRecord,
  cb: ChatCallbacks,
  state: { conversationId?: string }
): string {
  let delta = "";

  const directDelta = pickString(event, ["delta", "content", "reply", "response", "text"]);
  if (directDelta) delta = directDelta;

  // OpenAI-compatible envelope: { choices: [{ delta: { content }, message: { content } }] }
  if (!delta && Array.isArray(event.choices)) {
    const first = (event.choices as unknown[])[0] as UnknownRecord | undefined;
    const innerDelta = (first?.delta ?? {}) as UnknownRecord;
    const innerMessage = (first?.message ?? {}) as UnknownRecord;
    delta = pickString(innerDelta, ["content"]) ?? pickString(innerMessage, ["content"]) ?? "";
  }

  const statuses = extractStatuses(event);
  if (statuses.length > 0) cb.onStatus?.(statuses);

  const memories = normalizeMemories(event.memories);
  if (memories.length > 0) cb.onMemory?.(memories);

  const conversationId = extractConversationId(event);
  if (conversationId) state.conversationId = conversationId;

  if (typeof event.error === "string" && event.error.length > 0) {
    throw new ChatClientError(event.error, "server");
  }

  if (event.done === true) {
    cb.onDone?.(state.conversationId);
  }

  return delta;
}

/**
 * Pushes a single text line through the parser. Handles `data:` prefixes,
 * `event:` names, `[DONE]`, JSON payloads and raw text payloads.
 */
function processStreamLine(
  line: string,
  cb: ChatCallbacks,
  state: { conversationId?: string; done: boolean; text: string }
): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return;

  // Capture SSE event names (e.g. `event: delta`) — informational only.
  if (trimmed.startsWith("event:")) return;

  let payload = trimmed;
  if (payload.startsWith("data:")) {
    payload = payload.slice(5).trimStart();
  }

  if (payload === "[DONE]") {
    state.done = true;
    cb.onDone?.(state.conversationId);
    return;
  }

  // Try JSON payload first (covers `data: {...}` SSE and NDJSON).
  if (payload.startsWith("{") || payload.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Malformed JSON — fall through and treat the raw text as a delta.
      parsed = undefined;
    }
    if (parsed && typeof parsed === "object") {
      const delta = handleJsonEvent(parsed as UnknownRecord, cb, state);
      if (delta) {
        state.text += delta;
        cb.onDelta?.(delta);
      }
      return;
    }
  }

  // Plain token text — stream it verbatim.
  state.text += payload;
  cb.onDelta?.(payload);
}

/**
 * Consumes a streaming response body token-by-token.
 *
 * The reader treats each newline-terminated line as an event. A partial
 * line that never terminates (raw token streams without newlines) is
 * flushed as plain text on every chunk.
 */
async function consumeStream(
  res: Response,
  cb: ChatCallbacks
): Promise<ChatResult> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty"
    );
  }

  const decoder = new TextDecoder();
  const state = { conversationId: undefined as string | undefined, done: false, text: "" };
  const memories: ChatMemory[] = [];
  let buffer = "";

  const wrappedCallbacks: ChatCallbacks = {
    onDelta: cb.onDelta,
    onStatus: cb.onStatus,
    onMemory: (mems) => {
      memories.push(...mems);
      cb.onMemory?.(mems);
    },
    onDone: cb.onDone,
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Line-oriented protocols (SSE / NDJSON) terminate events with \n.
    if (buffer.includes("\n")) {
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processStreamLine(line, wrappedCallbacks, state);
      if (state.done) break;
      continue;
    }

    // No newline yet: either a partial event or a raw token stream.
    // If it doesn't look like the start of a JSON/SSE frame, flush it as text.
    const probe = buffer.trimStart();
    if (
      probe.length > 0 &&
      !probe.startsWith("{") &&
      !probe.startsWith("[") &&
      !probe.startsWith("data:") &&
      !probe.startsWith("event:") &&
      !probe.startsWith(":")
    ) {
      state.text += buffer;
      cb.onDelta?.(buffer);
      buffer = "";
    }
  }
  if (buffer.trim().length > 0) processStreamLine(buffer, wrappedCallbacks, state);

  if (!state.text) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty"
    );
  }

  cb.onDone?.(state.conversationId);

  return {
    content: state.text,
    conversationId: state.conversationId,
    memories,
    statusStates: [],
  };
}

/**
 * Multi-turn context hardening.
 * ---
 * The live `dashy-flow-state` worker is a single-`message` endpoint (see
 * `_reference/chat-client.reference.ts`): it reads the `message` string and
 * does NOT consume the additive `messages` array. To guarantee the model sees
 * every prior turn (no "what item?" multi-turn regression), for the normal
 * streaming path we fold the WHOLE thread into `message` while still emitting
 * the structured `messages` array for any worker that does read it.
 */

/** In-flight typing placeholder / empty bubbles — never forward as history. */
function isPlaceholderContent(content: string): boolean {
  const trimmed = (content ?? "").trim();
  return trimmed.length === 0 || trimmed === "..." || trimmed === "…";
}

/** Keep at most this many of the most recent turns (oldest dropped first). */
const MAX_HISTORY_TURNS = 40;
/** Keep the conversational window under ~100k chars, dropping oldest first. */
const MAX_HISTORY_CHARS = 100_000;

type WireMessage = { role: "user" | "assistant" | "system"; content: string };

/**
 * Normalizes a thread into the worker's `messages` shape: keeps only ranked
 * roles with real content, filters out placeholder/empty assistant bubbles,
 * and caps the payload size. The latest (current) user turn is never dropped.
 */
function buildWireMessages(history: ChatHistoryEntry[]): WireMessage[] {
  const cleaned: WireMessage[] = [];
  for (const entry of history) {
    const role =
      entry.role === "system" ? "system" : entry.role === "assistant" ? "assistant" : "user";
    const content = (entry.content ?? "").trim();
    if (!content) continue; // skip empty / image-only stubs so roles stay valid
    if (role === "assistant" && isPlaceholderContent(content)) continue;
    cleaned.push({ role, content });
  }

  let start = 0;
  // Turn cap: keep the most recent MAX_HISTORY_TURNS entries.
  if (cleaned.length > MAX_HISTORY_TURNS) start = cleaned.length - MAX_HISTORY_TURNS;
  // Char cap: keep dropping the OLDEST until under budget (final turn preserved).
  let total = cleaned.slice(start).reduce((n, m) => n + m.content.length, 0);
  while (total > MAX_HISTORY_CHARS && start < cleaned.length - 1) {
    total -= cleaned[start].content.length;
    start++;
  }
  return cleaned.slice(start);
}

/** Renders a normalized thread as a readable transcript for the `message` field. */
function transcriptOfThread(messages: WireMessage[]): string {
  return messages
    .map((m) =>
      m.role === "user"
        ? `User: ${m.content}`
        : m.role === "assistant"
          ? `Assistant: ${m.content}`
          : `System: ${m.content}`
    )
    .join("\n\n");
}

/**
 * Sends a message to the dashy-flow-state worker and streams the reply.
 *
 * @throws {ChatClientError} with a safe user-facing message on failure.
 */
export async function sendChatMessage(
  request: ChatRequest,
  callbacks: ChatCallbacks = {}
): Promise<ChatResult> {
  const base = DASHY_FLOW_STATE_URL.replace(/\/$/, "");
  const token = request.authToken || getSessionToken();

  // Normalize the full thread so the structured `messages` array and the
  // reference worker's `message` field both carry the same context. Some
  // callers (chat page) already append the current user turn to history;
  // others (voice page) pass only prior turns. Rebuild the thread so it
  // ALWAYS ends with the latest user message and never duplicates it.
  const currentText = (request.message ?? "").trim();
  const baseMessages = request.history ? buildWireMessages(request.history) : [];
  let priorMessages = baseMessages;
  const lastBase = baseMessages[baseMessages.length - 1];
  if (lastBase && lastBase.role === "user" && lastBase.content === currentText) {
    priorMessages = baseMessages.slice(0, -1);
  }
  const threadMessages: WireMessage[] = currentText
    ? [...priorMessages, { role: "user" as const, content: currentText }]
    : priorMessages;
  const hasHistory = threadMessages.length > 1;

  // On the normal streaming path `message` carries the ENTIRE thread so a
  // single-`message` worker still sees every prior turn. The agent/JSON path
  // and the first turn keep the plain latest user line.
  const wireMessage =
    !request.agentMode && hasHistory
      ? transcriptOfThread(threadMessages)
      : request.message;

  let res: Response;
  try {
    res = await fetch(`${base}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream, text/plain",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: wireMessage,
        model: request.model,
        ...(request.userId ? { userId: request.userId } : {}),
        ...(request.agentMode !== undefined
          ? { agentMode: request.agentMode }
          : {}),
        ...(request.conversationId
          ? { conversation_id: request.conversationId }
          : {}),
        // Additive field: full conversation history (all user+assistant turns
        // in order, placeholder-stripped and capped), ending with the latest
        // user message. The core contract fields above are unchanged, and the
        // SSE response handling is untouched.
        ...(!request.agentMode && threadMessages.length > 0 ? { messages: threadMessages } : {}),
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatClientError("Request stopped.", "aborted");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ChatClientError("Request stopped.", "aborted");
    }
    throw new ChatClientError(
      "Could not reach the dashy-flow-state backend. Check your connection and try again.",
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
      "You're sending messages too quickly. Please wait a moment and retry.",
      "rate_limited",
      res.status
    );
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    // Best-effort: surface the worker's own error message when present.
    let message = `The backend could not process your request (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as UnknownRecord;
      if (typeof body.error === "string" && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ChatClientError(message, "server", res.status);
  }

  if (request.agentMode) {
    // Agent Mode always returns a standard JSON object (never SSE), so skip
    // the streaming parser entirely and return the parsed payload.
    return readAgentModeResponse(res);
  }

  if (contentType.includes("text/event-stream")) {
    return consumeStream(res, callbacks);
  }

  if (contentType.includes("application/json")) {
    const raw = (await res.json()) as UnknownRecord;
    const state = { conversationId: undefined as string | undefined, done: false, text: "" };
    const delta = handleJsonEvent(raw, callbacks, state);
    if (delta) {
      callbacks.onDelta?.(delta);
      state.text = delta;
    }
    if (state.text.length === 0) {
      throw new ChatClientError(
        "The assistant returned an empty response. Please try again.",
        "empty"
      );
    }
    callbacks.onDone?.(state.conversationId);
    return {
      content: state.text,
      conversationId: state.conversationId,
      memories: normalizeMemories(raw.memories),
      statusStates: extractStatuses(raw),
      mode: pickString(raw, ["mode"]),
      modelId: pickString(raw, ["modelId", "model_id", "model"]),
      activity: normalizeActivity(raw.activity),
    };
  }

  // Fallback: plain text response body — emit as a single delta.
  const text = await res.text();
  if (!text.trim()) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty"
    );
  }
  callbacks.onDelta?.(text);
  callbacks.onDone?.();
  return { content: text, memories: [], statusStates: [] };
}

/**
 * Agent Mode JSON client — used only by `/agents`.
 *
 * Live worker contract (plain JSON, never SSE):
 *   POST {base}/chat
 *   Body: { userId, agentMode: true, message, messages, model }
 *   Response: { success, mode: "agent", modelId, reply, memories, activity }
 *
 * `gameMode` is never sent. `userId` is required.
 */
export const AGENT_MODEL_ID = "z-ai/glm-5";

export interface AgentRequest {
  message: string;
  userId: string;
  authToken?: string;
  /** Full thread in send order, ending with the latest user turn. */
  history?: ChatHistoryEntry[];
  signal?: AbortSignal;
  model?: string;
}

export async function sendAgentMessage(
  request: AgentRequest
): Promise<ChatResult> {
  if (!request.userId) {
    throw new ChatClientError(
      "Please log in to use Agent mode",
      "unauthorized"
    );
  }

  const base = DASHY_FLOW_STATE_URL.replace(/\/$/, "");
  const token = request.authToken || getSessionToken();
  const currentText = (request.message ?? "").trim();
  if (!currentText) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty"
    );
  }

  const baseMessages = request.history ? buildWireMessages(request.history) : [];
  let priorMessages = baseMessages;
  const lastBase = baseMessages[baseMessages.length - 1];
  if (lastBase && lastBase.role === "user" && lastBase.content === currentText) {
    priorMessages = baseMessages.slice(0, -1);
  }
  const threadMessages: WireMessage[] = [
    ...priorMessages,
    { role: "user", content: currentText },
  ];

  let res: Response;
  try {
    res = await fetch(`${base}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        userId: request.userId,
        agentMode: true,
        message: currentText,
        messages: threadMessages,
        model: request.model ?? AGENT_MODEL_ID,
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatClientError("Request stopped.", "aborted");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ChatClientError("Request stopped.", "aborted");
    }
    throw new ChatClientError(
      "Could not reach the dashy-flow-state backend. Check your connection and try again.",
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
      "You're sending messages too quickly. Please wait a moment and retry.",
      "rate_limited",
      res.status
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ChatClientError(
      res.ok
        ? "The backend returned malformed data."
        : `The backend could not process your request (HTTP ${res.status}).`,
      "server",
      res.status
    );
  }

  if (typeof raw !== "object" || raw === null) {
    throw new ChatClientError(
      "The assistant returned an empty response. Please try again.",
      "empty",
      res.status
    );
  }

  const obj = raw as UnknownRecord;
  if (typeof obj.error === "string" && obj.error.length > 0) {
    throw new ChatClientError(obj.error, "server", res.status);
  }
  if (!res.ok) {
    throw new ChatClientError(
      `The backend could not process your request (HTTP ${res.status}).`,
      "server",
      res.status
    );
  }

  return parseAgentResponse(obj);
}

/**
 * Lightweight reachability check for the flow-state worker.
 * Any HTTP response counts as "reachable"; only network failure is offline.
 */
export async function checkWorkerStatus(): Promise<
  { state: "online" } | { state: "offline"; error: string }
> {
  const base = DASHY_FLOW_STATE_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${base}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return { state: "online" };
  } catch {
    return { state: "offline", error: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
