"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WorkerStatus } from "@/lib/ui/chat-client";
import { getUser, type DashyUser } from "@/lib/ui/auth";

interface Conversation {
  id: string;
  title: string;
  timestamp: string;
}

const MOCK_CONVERSATIONS: Conversation[] = [
  { id: "c1", title: "RAG pipeline architecture review", timestamp: "2h ago" },
  { id: "c2", title: "Draft launch announcement for v7", timestamp: "5h ago" },
  { id: "c3", title: "Explain vector embeddings simply", timestamp: "Yesterday" },
  { id: "c4", title: "Debug Cloudflare Worker CORS issue", timestamp: "Yesterday" },
  { id: "c5", title: "Weekly research digest — AI agents", timestamp: "Mon" },
  { id: "c6", title: "Compare dashy-superfast vs allround", timestamp: "Sun" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
  workerStatus: WorkerStatus;
  activeConversationId?: string;
  onSelectConversation?: (id: string) => void;
}

export function Sidebar({
  open,
  onClose,
  onNewChat,
  workerStatus,
  activeConversationId,
  onSelectConversation,
}: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>(MOCK_CONVERSATIONS);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [user, setUser] = useState<DashyUser | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === renamingId ? { ...c, title: renameValue.trim() } : c
        )
      );
    }
    setRenamingId(null);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
  };

  const statusLabel =
    workerStatus.state === "online"
      ? "Backend online"
      : workerStatus.state === "offline"
        ? "Backend unavailable"
        : "Backend not configured";

  const statusClass =
    workerStatus.state === "online"
      ? "online"
      : workerStatus.state === "offline"
        ? "offline"
        : "checking";

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
    : "?";

  return (
    <>
      <div
        className={`sidebar-overlay${open ? " visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="sidebar"
        className={`sidebar${open ? " open" : ""}`}
        aria-label="DashyCore navigation"
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="8" fill="currentColor" />
                <path d="M10 22V14l3.5 0 3.2 7 3.2-7H23v8h-3v-7l-3 6h-3l-3-6v7z" fill="#0a0a0f" />
              </svg>
            </div>
            <div className="brand-text">
              <span className="brand-name">DashyCore</span>
              <span className="brand-version">v7</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button sidebar-close"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="sidebar-actions">
          <button type="button" className="new-chat-button anim-pulse-glow" onClick={onNewChat}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>New Chat</span>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace">
          <div className="sidebar-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search conversations…"
              aria-label="Search past conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="nav-section">
            <h2 className="nav-heading">Recent</h2>
            <div className="conversation-list" aria-label="Recent conversations">
              {filtered.length === 0 ? (
                <p className="empty-hint">
                  {query ? "No matches found." : "No conversations yet."}
                </p>
              ) : (
                filtered.map((conv) => (
                  <div
                    key={conv.id}
                    role="button"
                    tabIndex={0}
                    className={`conversation-item${
                      conv.id === activeConversationId ? " active" : ""
                    }`}
                    onClick={() => onSelectConversation?.(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelectConversation?.(conv.id);
                    }}
                  >
                    {renamingId === conv.id ? (
                      <input
                        className="conversation-rename-input"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        aria-label="Rename conversation"
                      />
                    ) : (
                      <>
                        <div className="conversation-info">
                          <span className="conversation-title">{conv.title}</span>
                          <span className="conversation-time">{conv.timestamp}</span>
                        </div>
                        <div className="conversation-actions">
                          <button
                            type="button"
                            className="conversation-action"
                            aria-label={`Rename "${conv.title}"`}
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(conv);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="conversation-action danger"
                            aria-label={`Delete "${conv.title}"`}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteConversation(conv.id);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="nav-section">
            <h2 className="nav-heading">Workspaces</h2>
            <Link href="/dcode" className="dcode-shortcut">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
              </svg>
              <span>D-Code Workspace</span>
            </Link>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="model-status">
            <span className={`status-dot ${statusClass}`} aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>

          <Link href="/settings" className="nav-item settings-item" aria-label="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </Link>

          <div className="user-profile-card" title={user?.email ?? ""}>
            <span className="user-avatar" aria-hidden="true">{initials}</span>
            <div className="user-profile-info">
              <span className="user-profile-name">{user?.name ?? "Guest"}</span>
              <span className="user-profile-email">{user?.email ?? "Not signed in"}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}