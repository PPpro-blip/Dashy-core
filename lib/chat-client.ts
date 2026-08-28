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

export interface ChatRequest {
  message: string;
  model: string;
  userId?: string;
  agentMode?: boolean;
  conversationId?: string;
  authToken?: string;
  signal?: AbortSignal;
}

export interface ChatMemory {
  content: string;
  title?: string;
  sourceType?: string;
  similarity?: number;
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
