"use client";

/**
 * DashyCore v7 — workspace sidebar.
 *
 * ONE navigation surface, three presentations:
 *   · desktop expanded  → icon + label, hierarchy (D-Code ▸ Editor/Projects/
 *     Analytics, Studio ▸ Generate/Library), recent chats, profile card
 *   · desktop collapsed → icon rail; every destination stays reachable and
 *     gets a tooltip on hover AND keyboard focus
 *   · mobile            → the expanded layout inside a slide-over drawer
 *
 * The item list itself comes from lib/navigation so no feature can quietly
 * gain a second entry point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { PRIMARY_NAV, isNavActive, type NavChild, type NavItem } from "@/lib/navigation";
import {
  deleteConversationAsync,
  emitDeleteConversation,
  emitNewChat,
  emitOpenConversation,
  EVENTS,
  listConversationsAsync,
  type Conversation,
} from "@/lib/conversations";
import {
  ChevronDownIcon,
  MessageIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";

interface ProfileUser {
  name: string;
  email: string;
  initials: string;
}

export interface SidebarProps {
  /** Icon-rail mode (desktop/tablet only — the drawer is always expanded). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Drawer mode adds a close button and closes on navigation. */
  variant?: "docked" | "drawer";
  onNavigate?: () => void;
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

/** Tooltip shown next to collapsed icons — visible on hover AND focus. */
function RailTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/[0.08] bg-[#151a33] px-2.5 py-1.5 text-xs font-medium text-zinc-100 opacity-0 shadow-xl shadow-black/50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 peer-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  variant = "docked",
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isDrawer = variant === "drawer";
  const isRail = collapsed && !isDrawer;

  const [user, setUser] = useState<ProfileUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  /* Track the URL hash (settings#memory vs plain settings) reactively. */
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  /* Auto-open the group that owns the current route. */
  useEffect(() => {
    const active = PRIMARY_NAV.filter(
      (item) => item.children && isNavActive(item, pathname, hash)
    ).map((item) => item.id);
    if (active.length === 0) return;
    setOpenGroups((prev) =>
      active.every((id) => prev.includes(id)) ? prev : [...new Set([...prev, ...active])]
    );
  }, [pathname, hash]);

  /* Track which conversation the chat page has open (UI state only). */
  useEffect(() => {
    const readActive = () => {
      try {
        setActiveConversationId(
          window.localStorage.getItem("dashycore:active-conversation") ?? null
        );
      } catch {
        setActiveConversationId(null);
      }
    };
    readActive();
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      setActiveConversationId(detail?.id ?? null);
    };
    window.addEventListener(EVENTS.OPEN_CONVERSATION, onOpen);
    window.addEventListener(EVENTS.NEW_CHAT, readActive);
    window.addEventListener(EVENTS.CONVERSATIONS_UPDATED, readActive);
    return () => {
      window.removeEventListener(EVENTS.OPEN_CONVERSATION, onOpen);
      window.removeEventListener(EVENTS.NEW_CHAT, readActive);
      window.removeEventListener(EVENTS.CONVERSATIONS_UPDATED, readActive);
    };
  }, []);

  /* Cloud-first list: Supabase conversations when signed in, else local. */
  const refreshConversations = useCallback(() => {
    listConversationsAsync()
      .then(setConversations)
      .catch(() => undefined);
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
    onNavigate?.();
  };

  const handleOpenConversation = (id: string) => {
    emitOpenConversation(id);
    if (pathname !== "/chat") router.push("/chat");
    onNavigate?.();
  };

  const handleDeleteConversation = (id: string) => {
    // Cloud delete (cascades messages) + local mirror cleanup, then notify.
    void deleteConversationAsync(id).finally(() => emitDeleteConversation(id));
  };

  const query = search.trim().toLowerCase();
  const filteredConversations = query
    ? conversations.filter((c) => c.title.toLowerCase().includes(query))
    : conversations;

  /** Collapsed rail: every leaf destination, flattened, nothing unreachable. */
  const railItems = useMemo(() => {
    const items: { id: string; label: string; href: string; Icon: NavItem["Icon"]; match?: string[]; exact?: boolean }[] = [];
    for (const item of PRIMARY_NAV) {
      if (item.children) {
        for (const child of item.children) {
          items.push({ ...child, label: `${item.label} · ${child.label}` });
        }
      } else {
        items.push(item);
      }
    }
    return items;
  }, []);

  /* ------------------------------ rail mode ------------------------------ */

  if (isRail) {
    return (
      <nav
        aria-label="Workspace"
        className="sticky top-0 flex h-screen w-[68px] flex-shrink-0 flex-col items-center border-r border-white/[0.06] bg-navy/85 backdrop-blur-2xl"
      >
        <div className="flex h-16 flex-shrink-0 items-center">
          <Link
            href="/chat"
            onClick={() => emitNewChat()}
            aria-label="DashyCore — new chat"
            className="group relative flex h-9 w-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <Image
              src="/icon-512.png"
              alt=""
              width={28}
              height={28}
              priority
              className="rounded-lg object-contain"
            />
            <RailTooltip label="DashyCore" />
          </Link>
        </div>

        <button
          type="button"
          onClick={handleNewChat}
          aria-label="New chat"
          className="group relative mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500 text-[#06202a] shadow-lg shadow-cyan-500/20 transition-colors hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <PlusIcon className="h-4 w-4" />
          <RailTooltip label="New chat" />
        </button>

        <ul className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pb-3">
          {railItems.map((item) => {
            const active = isNavActive(item, pathname, hash);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                    active
                      ? "bg-cyan-500/12 text-cyan-300"
                      : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
                  }`}
                >
                  <item.Icon className="h-[18px] w-[18px]" />
                  <RailTooltip label={item.label} />
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-shrink-0 flex-col items-center gap-1 border-t border-white/[0.06] py-3">
          <Link
            href="/settings"
            onClick={onNavigate}
            aria-label="Settings"
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
              pathname === "/settings" && !hash
                ? "bg-cyan-500/12 text-cyan-300"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
            }`}
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
            <RailTooltip label="Settings" />
          </Link>
          <Link
            href="/settings#account"
            onClick={onNavigate}
            aria-label={`Account — ${user?.name ?? "Dashy user"}`}
            className="group relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-[11px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            {user?.initials ?? "D"}
            <RailTooltip label={user?.name ?? "Account"} />
          </Link>
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expand sidebar"
              aria-expanded={false}
              className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <PanelLeftIcon className="h-4 w-4" />
              <RailTooltip label="Expand sidebar" />
            </button>
          )}
        </div>
      </nav>
    );
  }

  /* ---------------------------- expanded mode ---------------------------- */

  const navItemClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
      active
        ? "bg-cyan-500/10 text-cyan-300"
        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
    }`;

  const renderChild = (child: NavChild) => {
    const active = isNavActive(child, pathname, hash);
    return (
      <li key={child.id}>
        <Link
          href={child.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex w-full items-center gap-2.5 rounded-lg py-2 pl-3 pr-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
            active
              ? "bg-cyan-500/10 text-cyan-300"
              : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          }`}
        >
          <child.Icon className="h-3.5 w-3.5 flex-shrink-0" />
          {child.label}
        </Link>
      </li>
    );
  };

  return (
    <aside
      className={`flex h-full min-h-0 w-full flex-col bg-navy/95 backdrop-blur-2xl ${
        isDrawer
          ? ""
          : "sticky top-0 h-screen w-64 flex-shrink-0 border-r border-white/[0.06] bg-navy/85"
      }`}
    >
      {/* Brand */}
      <div className="flex h-16 flex-shrink-0 items-center gap-2 px-4">
        <Link
          href="/chat"
          onClick={() => {
            emitNewChat();
            onNavigate?.();
          }}
          className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          <Image
            src="/icon-512.png"
            alt=""
            width={28}
            height={28}
            priority
            className="rounded-lg object-contain"
          />
          <span className="truncate text-base font-semibold tracking-[-0.03em] text-white">
            DashyCore
          </span>
        </Link>

        <div className="ml-auto flex items-center">
          {isDrawer ? (
            <button
              type="button"
              onClick={onNavigate}
              aria-label="Close navigation"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <XIcon className="h-4 w-4" />
            </button>
          ) : (
            onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
                aria-expanded
                title="Collapse sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              >
                <PanelLeftIcon className="h-4 w-4" />
              </button>
            )
          )}
        </div>
      </div>

      {/* + New Chat */}
      <div className="flex-shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={handleNewChat}
          className="group flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400 hover:shadow-cyan-400/25 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <PlusIcon className="h-4 w-4 transition-transform motion-safe:group-hover:rotate-90" />
          New Chat
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Workspace" className="flex-shrink-0 px-3">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const active = isNavActive(item, pathname, hash);
            if (!item.children) {
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={navItemClass(active)}
                  >
                    <item.Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 truncate text-left">{item.label}</span>
                  </Link>
                </li>
              );
            }

            const open = openGroups.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) =>
                      prev.includes(item.id)
                        ? prev.filter((id) => id !== item.id)
                        : [...prev, item.id]
                    )
                  }
                  aria-expanded={open}
                  aria-controls={`nav-group-${item.id}`}
                  className={navItemClass(active && !open)}
                >
                  <item.Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1 truncate text-left">{item.label}</span>
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 flex-shrink-0 text-zinc-600 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {open && (
                  <ul
                    id={`nav-group-${item.id}`}
                    className="ml-[1.35rem] space-y-0.5 border-l border-white/[0.07] pl-2"
                  >
                    {item.children.map(renderChild)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Recent chats */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.06] px-3 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Recent chats
          </p>
        </div>

        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search chats"
            className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-8 pr-3 text-sm text-zinc-200 placeholder-zinc-500 transition-colors focus:border-cyan-400/40 focus:outline-none"
          />
        </div>

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
                    className={`flex w-full items-center gap-2 rounded-xl py-2.5 pl-2.5 pr-9 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
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
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-[#0d1020]/90 p-1.5 text-zinc-500 opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 group-hover:opacity-100 md:p-1"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Settings + account */}
      <div className="flex-shrink-0 border-t border-white/[0.06] p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={pathname === "/settings" && !hash ? "page" : undefined}
          className={`${navItemClass(pathname === "/settings" && !hash)} mb-2`}
        >
          <SettingsIcon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1 truncate text-left">Settings</span>
        </Link>

        <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2">
          <Link
            href="/settings#account"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-xs font-semibold text-white">
              {user?.initials ?? "D"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-zinc-200">
                {user?.name ?? "Dashy user"}
              </span>
              <span className="block truncate text-[10px] text-zinc-500">
                {user?.email ?? "Loading…"}
              </span>
            </span>
          </Link>
          <SignOutButton iconOnly />
        </div>
      </div>
    </aside>
  );
}
