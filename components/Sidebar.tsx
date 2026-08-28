"use client";

/**
 * DashyCore v7 — workspace sidebar (old peak Dashy style).
 *
 * - Brand row (logo + DashyCore)
 * - Big cyan "+ New Chat" button
 * - Search chats input (local filter of recent conversations)
 * - Nav: Chats · Projects · Knowledge · Memory · Agents · Voice · Settings
 * - Recent chats from localStorage history (click to resume, hover delete)
 * - Profile card: avatar initials, name, email, inline sign-out control
 *
 * No version footer badge — matching old peak Dashy.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import {
  deleteConversation,
  emitDeleteConversation,
  emitNewChat,
  emitOpenConversation,
  EVENTS,
  listConversations,
  type Conversation,
} from "@/lib/conversations";
import {
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  FolderIcon,
  MessageIcon,
  MicIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from "@/components/icons";

interface ProfileUser {
  name: string;
  email: string;
  initials: string;
}

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "D";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");

  const activeConversationId =
    typeof window !== "undefined"
      ? (() => {
          try {
            return window.localStorage.getItem("dashycore:active-conversation") ?? null;
          } catch {
            return null;
          }
        })()
      : null;

  const refreshConversations = useCallback(() => {
    setConversations(listConversations());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const supabase = createClient();
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (cancelled || !authUser) return;
        const name =
          (authUser.user_metadata?.full_name as string | undefined) ||
          (authUser.user_metadata?.name as string | undefined) ||
          authUser.email?.split("@")[0] ||
          "Dashy user";
        setUser({
          name,
          email: authUser.email ?? "",
          initials: initialsFor(name, authUser.email ?? ""),
        });
      } catch {
        // Profile card degrades to placeholders.
      }
    }
    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshConversations();
    window.addEventListener(EVENTS.CONVERSATIONS_UPDATED, refreshConversations);
    return () => {
      window.removeEventListener(EVENTS.CONVERSATIONS_UPDATED, refreshConversations);
    };
  }, [refreshConversations]);

  const handleNewChat = () => {
    emitNewChat();
    if (pathname !== "/chat") router.push("/chat");
  };

  const handleOpenConversation = (id: string) => {
    emitOpenConversation(id);
    if (pathname !== "/chat") router.push("/chat");
  };

  const handleDeleteConversation = (id: string) => {
    deleteConversation(id);
    emitDeleteConversation(id);
  };

  const query = search.trim().toLowerCase();
  const filteredConversations = query
    ? conversations.filter((c) => c.title.toLowerCase().includes(query))
    : conversations;

  const navItemClass = (active: boolean, disabled = false) =>
    `mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
      disabled
        ? "cursor-not-allowed text-zinc-600"
        : active
          ? "bg-cyan-500/10 text-cyan-300"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
    }`;

  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-shrink-0 flex-col border-r border-white/[0.06] bg-navy/85 backdrop-blur-2xl">
      {/* Brand */}
      <div className="flex h-16 flex-shrink-0 items-center gap-2 px-4">
        <Link
          href="/chat"
          onClick={() => emitNewChat()}
          className="flex items-center gap-2.5"
        >
          <Image
            src="/icon-512.png"
            alt="DashyCore logo"
            width={28}
            height={28}
            priority
            className="rounded-lg object-contain"
          />
          <span className="text-base font-semibold tracking-[-0.03em] text-white">
            DashyCore
          </span>
        </Link>
      </div>

      {/* + New Chat */}
      <div className="flex-shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={handleNewChat}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 hover:shadow-cyan-400/25 active:scale-[0.98]"
        >
          <PlusIcon className="h-4 w-4 transition-transform group-hover:rotate-90" />
          New Chat
        </button>
      </div>

      {/* Search chats */}
      <div className="flex-shrink-0 px-3 pb-3">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search chats"
            className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-8 pr-3 text-sm text-zinc-200 placeholder-zinc-500 transition-colors focus:border-cyan-400/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Nav sections */}
      <nav className="flex-shrink-0 px-3">
        <Link href="/chat" className={navItemClass(pathname === "/chat")}>
          <MessageIcon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">Chats</span>
        </Link>
        <div className="flex items-center">
          <button
            type="button"
            disabled
            title="Projects are coming soon"
            className={navItemClass(false, true)}
          >
            <FolderIcon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Projects</span>
            <ComingSoonBadge />
          </button>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            disabled
            title="Knowledge is coming soon"
            className={navItemClass(false, true)}
          >
            <BookOpenIcon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Knowledge</span>
            <ComingSoonBadge />
          </button>
        </div>
        <Link href="/settings#memory" className={navItemClass(pathname === "/settings" && typeof window !== "undefined" && window.location.hash.includes("memory"))}>
          <BrainIcon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">Memory</span>
        </Link>
        <div className="flex items-center">
          <button
            type="button"
            disabled
            title="Agents are coming soon"
            className={navItemClass(false, true)}
          >
            <BotIcon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Agents</span>
            <ComingSoonBadge />
          </button>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            disabled
            title="Voice is coming soon"
            className={navItemClass(false, true)}
          >
            <MicIcon className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Voice</span>
            <ComingSoonBadge />
          </button>
        </div>
        <Link href="/settings" className={navItemClass(pathname === "/settings" && typeof window !== "undefined" && !window.location.hash.includes("memory"))}>
          <SettingsIcon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">Settings</span>
        </Link>
      </nav>

      {/* Recent chats */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.06] px-3 pt-3">
        <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Recent chats
        </p>
        {filteredConversations.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <MessageIcon className="mx-auto mb-2 h-8 w-8 text-zinc-700" />
            <p className="text-xs text-zinc-500">
              {query ? "No matching chats" : "No chats yet"}
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5 pb-3">
            {filteredConversations.slice(0, 14).map((conversation) => {
              const isActive =
                activeConversationId === conversation.id && pathname === "/chat";
              return (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleOpenConversation(conversation.id)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                    }`}
                  >
                    <MessageIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{conversation.title}</span>
                      <span className="block text-[10px] text-zinc-600">
                        {relativeTime(conversation.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${conversation.title}`}
                    onClick={() => handleDeleteConversation(conversation.id)}
                    className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded-md bg-[#0d1020]/90 p-1 text-zinc-500 transition-colors hover:text-red-400 group-hover:block"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Profile card */}
      <div className="flex-shrink-0 border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-xs font-semibold text-white">
            {user?.initials ?? "D"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-200">
              {user?.name ?? "Dashy user"}
            </p>
            <p className="truncate text-[10px] text-zinc-500">
              {user?.email ?? "Loading…"}
            </p>
          </div>
          <SignOutButton iconOnly />
        </div>
      </div>
    </aside>
  );
}

function ComingSoonBadge() {
  return (
    <span className="flex-shrink-0 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
      Soon
    </span>
  );
}
