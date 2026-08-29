/**
 * DashyCore v7 — chat-history store (cloud-first, local fallback).
 *
 * Storage strategy:
 *   - Signed in  → Supabase `conversations` + `messages` tables (RLS-scoped
 *     to the auth user; see supabase/migrations/20260829000000_…). Chats
 *     roam across devices.
 *   - Signed out → per-browser localStorage, exactly as before.
 *   - Cloud errors degrade gracefully to localStorage so the UI never
 *     loses a chat outright.
 *
 * The async facade (`*Async` functions) picks the backend at call time.
 * The synchronous localStorage functions remain exported for the signed-out
 * path. The sidebar and chat page talk to each other through the same DOM
 * events as before — event names and interactions are unchanged.
 */

import { createClient } from "@/lib/supabase/client";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** Dashy model id used for this assistant reply (display badge). */
  model?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: HistoryMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "dashycore:conversations:v1";
const MAX_CONVERSATIONS = 50;

export const EVENTS = {
  NEW_CHAT: "dashy:new-chat",
  OPEN_CONVERSATION: "dashy:open-conversation",
  DELETE_CONVERSATION: "dashy:delete-conversation",
  CONVERSATIONS_UPDATED: "dashy:conversations-updated",
  CHAT_TITLE: "dashy:chat-title",
} as const;

/* ========================================================================== */
/* localStorage backend (signed-out fallback)                                  */
/* ========================================================================== */

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function listConversations(): Conversation[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c): c is Conversation => Boolean(c && typeof (c as Conversation).id === "string"))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getConversation(id: string): Conversation | null {
  return listConversations().find((c) => c.id === id) ?? null;
}

function persist(conversations: Conversation[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Storage full or unavailable — history is best-effort.
  }
  window.dispatchEvent(new CustomEvent(EVENTS.CONVERSATIONS_UPDATED));
}

export function saveConversation(conversation: Conversation): void {
  const existing = listConversations();
  const index = existing.findIndex((c) => c.id === conversation.id);
  if (index >= 0) {
    existing[index] = conversation;
  } else {
    existing.unshift(conversation);
  }
  persist(existing.slice(0, MAX_CONVERSATIONS));
}

export function deleteConversation(id: string): void {
  persist(listConversations().filter((c) => c.id !== id));
}

export function newConversationId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return random;
}

/* ========================================================================== */
/* Supabase backend (cloud chats)                                              */
/* ========================================================================== */

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string | null;
}

/** Returns the Supabase client + user id when signed in, else null. */
async function cloudSession(): Promise<{ userId: string } | null> {
  if (typeof window === "undefined") return null;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return { userId: user.id };
  } catch {
    // No session / Supabase not configured — stay local.
    return null;
  }
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function rowToConversation(row: ConversationRow, messages: HistoryMessage[] = []): Conversation {
  return {
    id: row.id,
    title: row.title ?? "New Chat",
    model: "",
    messages,
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : 0,
  };
}

function rowToMessage(row: MessageRow): HistoryMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    timestamp: row.created_at ? Date.parse(row.created_at) : 0,
    model: row.model ?? undefined,
  };
}

/**
 * Guarantees strictly-increasing timestamps so cloud `created_at` ordering
 * always matches the in-memory send order (client messages can share a ms).
 */
function withOrderedTimestamps(messages: HistoryMessage[]): HistoryMessage[] {
  let last = 0;
  return messages.map((message) => {
    last = Math.max(last + 1, message.timestamp);
    return last === message.timestamp ? message : { ...message, timestamp: last };
  });
}

/**
 * Lists conversations for the active user.
 * Cloud when signed in (titles only — messages load on open), else localStorage.
 */
export async function listConversationsAsync(): Promise<Conversation[]> {
  const session = await cloudSession();
  if (!session) return listConversations();

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(MAX_CONVERSATIONS);
    if (error) throw error;
    return (data as ConversationRow[]).map((row) => rowToConversation(row));
  } catch (error) {
    console.warn("[conversations] cloud list failed, using local:", error);
    return listConversations();
  }
}

/**
 * Loads one conversation with its full message thread.
 * Cloud when signed in, else localStorage. Messages are returned in send order.
 */
export async function getConversationAsync(id: string): Promise<Conversation | null> {
  const session = await cloudSession();
  if (!session) return getConversation(id);

  try {
    const supabase = createClient();
    const [{ data: convRows, error: convError }, { data: msgRows, error: msgError }] =
      await Promise.all([
        supabase
          .from("conversations")
          .select("id, title, created_at, updated_at")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("id, conversation_id, role, content, model, created_at")
          .eq("conversation_id", id)
          .order("created_at", { ascending: true }),
      ]);
    if (convError) throw convError;
    if (msgError) throw msgError;
    if (!convRows) return null;

    const conversationRow = convRows as ConversationRow;
    const messages = (msgRows as MessageRow[]).map(rowToMessage);
    const conversation = rowToConversation(conversationRow, messages);
    conversation.model =
      [...messages].reverse().find((m) => m.model)?.model ?? "";
    return conversation;
  } catch (error) {
    console.warn("[conversations] cloud load failed, trying local:", error);
    return getConversation(id);
  }
}

/**
 * Persists a conversation (upsert) and syncs its messages.
 *
 * Cloud when signed in: the conversation row is upserted, every message is
 * upserted by id, and remote messages that no longer exist locally (e.g. a
 * regenerated assistant turn) are removed. Falls back to localStorage when
 * signed out or on cloud failure.
 */
export async function saveConversationAsync(conversation: Conversation): Promise<void> {
  const session = await cloudSession();
  if (!session) {
    saveConversation(conversation);
    return;
  }

  try {
    const supabase = createClient();
    const messages = withOrderedTimestamps(conversation.messages);

    const { error: convError } = await supabase
      .from("conversations")
      .upsert(
        {
          id: conversation.id,
          user_id: session.userId,
          title: conversation.title,
          created_at: toIso(conversation.createdAt),
          updated_at: toIso(conversation.updatedAt),
        },
        { onConflict: "id" }
      );
    if (convError) throw convError;

    if (messages.length > 0) {
      const rows = messages.map((message) => ({
        id: message.id,
        conversation_id: conversation.id,
        role: message.role,
        content: message.content,
        model: message.model ?? null,
        created_at: toIso(message.timestamp),
      }));
      const { error: upsertError } = await supabase
        .from("messages")
        .upsert(rows, { onConflict: "id" });
      if (upsertError) throw upsertError;

      // Remove remote turns that were dropped locally (regenerate / delete).
      const keptIds = messages.map((m) => `"${m.id}"`).join(",");
      const { error: pruneError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversation.id)
        .not("id", "in", `(${keptIds})`);
      if (pruneError) throw pruneError;
    } else {
      const { error: clearError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversation.id);
      if (clearError) throw clearError;
    }

    window.dispatchEvent(new CustomEvent(EVENTS.CONVERSATIONS_UPDATED));
  } catch (error) {
    console.warn("[conversations] cloud save failed, mirroring to local:", error);
    saveConversation(conversation);
  }
}

/**
 * Deletes a conversation everywhere it exists (cloud cascade + local).
 */
export async function deleteConversationAsync(id: string): Promise<void> {
  const session = await cloudSession();
  if (!session) {
    deleteConversation(id);
    return;
  }

  try {
    const supabase = createClient();
    // Messages cascade on delete (FK on delete cascade).
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.warn("[conversations] cloud delete failed:", error);
  } finally {
    // Always clear the local mirror too so neither backend holds a ghost.
    deleteConversation(id);
  }
}

/* ========================================================================== */
/* Cross-component events (unchanged contract)                                 */
/* ========================================================================== */

function emit(name: string, detail?: unknown): void {
  if (!canUseStorage()) return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function emitNewChat(): void {
  emit(EVENTS.NEW_CHAT);
}

export function emitOpenConversation(id: string): void {
  emit(EVENTS.OPEN_CONVERSATION, { id });
}

export function emitDeleteConversation(id: string): void {
  emit(EVENTS.DELETE_CONVERSATION, { id });
}

export function emitChatTitle(title: string): void {
  emit(EVENTS.CHAT_TITLE, { title });
}

export function titleFromContent(content: string, max = 42): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}
