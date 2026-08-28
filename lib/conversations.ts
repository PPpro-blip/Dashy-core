/**
 * DashyCore v7 — local chat-history store.
 *
 * The live schema has no `conversations` table yet (only `documents` /
 * `document_chunks`), so history is persisted per-browser in localStorage
 * and shared between the chat page and the sidebar through custom DOM
 * events. Swapping the storage layer for Supabase later only touches this
 * module.
 */

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
