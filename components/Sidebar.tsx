"use client";

/**
 * DashyCore v7 — workspace sidebar.
 *
 * ONE navigation surface, three presentations:
 *
 *   · desktop expanded  → 264px: icons + labels, two quiet group headings,
 *     D-Code / Studio as compact disclosures, recent chats, account card
 *   · desktop collapsed → 68px icon rail; every destination stays reachable,
 *     each icon has a tooltip on hover AND keyboard focus, and the two
 *     groups open a small flyout menu instead of flattening into an icon wall
 *   · mobile            → the expanded layout inside a slide-over drawer
 *
 * The item list comes from lib/navigation, so no feature can quietly gain a
 * second entry point. Width is the only thing that animates (180ms), and the
 * main workspace reflows with it because the shell is a plain flex row.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { RailGroup, RailTip } from "@/components/sidebar/RailFlyout";
import { RecentChats } from "@/components/sidebar/RecentChats";
import {
  NAV_SECTIONS,
  PRIMARY_NAV,
  isNavActive,
  type NavChild,
  type NavItem,
} from "@/lib/navigation";
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
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
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

/** Desktop widths. Narrow enough that the workspace stays the priority. */
const EXPANDED_WIDTH = "w-[264px]";
const RAIL_WIDTH = "w-[68px]";

const RAIL_ICON_CLASS = (active: boolean) =>
  `flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
    active
      ? "bg-cyan-500/12 text-cyan-300"
      : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
  }`;

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "D";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
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
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  /** Suppresses the width transition on first paint (no boot-time slide). */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

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

  const handleNewChat = useCallback(() => {
    emitNewChat();
    if (pathname !== "/chat") router.push("/chat");
    onNavigate?.();
  }, [onNavigate, pathname, router]);

  const handleOpenConversation = useCallback(
    (id: string) => {
      emitOpenConversation(id);
      if (pathname !== "/chat") router.push("/chat");
      onNavigate?.();
    },
    [onNavigate, pathname, router]
  );

  const handleDeleteConversation = useCallback((id: string) => {
    // Cloud delete (cascades messages) + local mirror cleanup, then notify.
    void deleteConversationAsync(id).finally(() => emitDeleteConversation(id));
  }, []);

  const settingsActive = pathname === "/settings" && !hash;
  const accountLabel = user?.name ?? "Account";

  /* ---------------------------------------------------------------------- */
  /* Shared chrome                                                           */
  /* ---------------------------------------------------------------------- */

  const brand = (
    <Link
      href="/chat"
      onClick={() => {
        emitNewChat();
        onNavigate?.();
      }}
      className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
    >
      <Image
        src="/icon-512.png"
        alt=""
        width={26}
        height={26}
        priority
        className="flex-shrink-0 rounded-lg object-contain"
      />
      <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
        DashyCore
      </span>
    </Link>
  );

  const accountCard = (
    <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2">
      <Link
        href="/settings#account"
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-xs font-semibold text-white">
          {user?.initials ?? "D"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-zinc-200">
            {user?.name ?? "Dashy user"}
          </span>
          <span className="block truncate text-[10px] text-zinc-500">
            {user?.email ?? "Signed in"}
          </span>
        </span>
      </Link>
      <SignOutButton iconOnly />
    </div>
  );

  const railItems = useMemo(
    () =>
      PRIMARY_NAV.map((item) => ({
        item,
        active: isNavActive(item, pathname, hash),
        children: (item.children ?? []).map((child) => ({
          ...child,
          active: isNavActive(child, pathname, hash),
        })),
      })),
    [pathname, hash]
  );

  /* ---------------------------------------------------------------------- */
  /* Rows (expanded / drawer)                                                */
  /* ---------------------------------------------------------------------- */

  const rowHeight = isDrawer ? "min-h-[44px]" : "min-h-[38px]";

  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${rowHeight} ${
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
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${rowHeight} ${
            active
              ? "bg-cyan-500/10 text-cyan-300"
              : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          }`}
        >
          <child.Icon className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{child.label}</span>
        </Link>
      </li>
    );
  };

  const renderItem = (item: NavItem) => {
    const active = isNavActive(item, pathname, hash);

    if (!item.children) {
      return (
        <li key={item.id}>
          <Link
            href={item.href ?? "/chat"}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={rowClass(active)}
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
          className={rowClass(active && !open)}
        >
          <item.Icon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{item.label}</span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 flex-shrink-0 text-zinc-600 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {open && (
          <ul
            id={`nav-group-${item.id}`}
            className="ml-[1.4rem] mt-0.5 space-y-0.5 border-l border-white/[0.07] pl-2"
          >
            {item.children.map(renderChild)}
          </ul>
        )}
      </li>
    );
  };

  /* ---------------------------------------------------------------------- */
  /* Shell                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * The <aside> owns the animated width; the inner column is pinned to the
   * TARGET width so icons never drift sideways while the panel resizes —
   * the box simply closes around them (and `overflow-hidden` clips the
   * labels on the way in). Tooltips/flyouts escape that clip via portals.
   */
  const asideClass = [
    "flex min-h-0 flex-col overflow-hidden bg-navy/95 backdrop-blur-2xl",
    isDrawer
      ? "h-full w-full"
      : `sticky top-0 h-screen flex-shrink-0 border-r border-white/[0.06] bg-navy/85 ${
          isRail ? RAIL_WIDTH : EXPANDED_WIDTH
        }`,
    !isDrawer && ready
      ? "transition-[width] duration-200 ease-out motion-reduce:transition-none"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const innerClass = `flex h-full min-h-0 flex-col ${
    isDrawer ? "w-full" : isRail ? RAIL_WIDTH : EXPANDED_WIDTH
  }`;

  return (
    <aside className={asideClass} data-state={isRail ? "collapsed" : "expanded"}>
      <div className={innerClass}>
        {/* ------------------------------ brand ----------------------------- */}
        {isRail ? (
          <div className="flex h-16 flex-shrink-0 items-center justify-center">
            {onToggleCollapsed ? (
              <RailTip label="Expand sidebar">
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                  className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  <Image
                    src="/icon-512.png"
                    alt=""
                    width={26}
                    height={26}
                    priority
                    className="rounded-lg object-contain transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0 [@media(hover:none)]:opacity-0"
                  />
                  {/* Pointer devices keep the brand mark and reveal the
                      control on hover; touch devices, which have no hover,
                      always show the explicit expand affordance. */}
                  <PanelLeftIcon className="absolute h-[18px] w-[18px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100" />
                </button>
              </RailTip>
            ) : (
              <Image
                src="/icon-512.png"
                alt="DashyCore"
                width={26}
                height={26}
                priority
                className="rounded-lg object-contain"
              />
            )}
          </div>
        ) : (
          <div className="flex h-16 flex-shrink-0 items-center gap-2 px-3">
            {brand}
            <div className="ml-auto flex items-center">
              {isDrawer ? (
                <button
                  type="button"
                  onClick={onNavigate}
                  aria-label="Close navigation"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
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
        )}

        {/* ---------------------------- new chat ---------------------------- */}
        {isRail ? (
          <div className="flex flex-shrink-0 justify-center pb-2">
            <RailTip label="New chat">
              <button
                type="button"
                onClick={handleNewChat}
                aria-label="New chat"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </RailTip>
          </div>
        ) : (
          <div className="flex-shrink-0 px-3 pb-2">
            <button
              type="button"
              onClick={handleNewChat}
              className={`group flex w-full items-center gap-2.5 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 text-[13px] font-semibold text-cyan-200 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                isDrawer ? "min-h-[44px]" : "min-h-[40px]"
              }`}
            >
              <PlusIcon className="h-4 w-4 flex-shrink-0 transition-transform duration-150 motion-safe:group-hover:rotate-90" />
              New Chat
            </button>
          </div>
        )}

        {/* --------------------------- navigation --------------------------- */}
        {isRail ? (
          <nav
            aria-label="Workspace"
            className="min-h-0 shrink overflow-y-auto py-1"
          >
            <ul className="flex flex-col items-center gap-1">
              {railItems.map(({ item, active, children }) => (
                <li key={item.id}>
                  {item.children ? (
                    <RailGroup
                      label={item.label}
                      Icon={item.Icon}
                      active={active}
                      items={children}
                      onNavigate={onNavigate}
                    />
                  ) : (
                    <RailTip label={item.label}>
                      <Link
                        href={item.href ?? "/chat"}
                        onClick={onNavigate}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        className={RAIL_ICON_CLASS(active)}
                      >
                        <item.Icon className="h-[18px] w-[18px]" />
                      </Link>
                    </RailTip>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          <nav aria-label="Workspace" className="min-h-0 shrink overflow-y-auto px-3">
            {NAV_SECTIONS.map((section, index) => (
              <div key={section.id} className={index === 0 ? "" : "mt-3"}>
                {section.label && (
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                    {section.label}
                  </p>
                )}
                <ul className="space-y-0.5">{section.items.map(renderItem)}</ul>
              </div>
            ))}
          </nav>
        )}

        {/* -------------------------- recent chats -------------------------- */}
        {isRail ? (
          <div className="flex-1" />
        ) : (
          <RecentChats
            conversations={conversations}
            activeId={pathname === "/chat" ? activeConversationId : null}
            onOpen={handleOpenConversation}
            onDelete={handleDeleteConversation}
          />
        )}

        {/* ----------------------- settings + account ----------------------- */}
        {isRail ? (
          <div className="flex flex-shrink-0 flex-col items-center gap-1 border-t border-white/[0.06] py-3">
            <RailTip label="Settings">
              <Link
                href="/settings"
                onClick={onNavigate}
                aria-label="Settings"
                aria-current={settingsActive ? "page" : undefined}
                className={RAIL_ICON_CLASS(settingsActive)}
              >
                <SettingsIcon className="h-[18px] w-[18px]" />
              </Link>
            </RailTip>
            <RailTip label={accountLabel}>
              <Link
                href="/settings#account"
                onClick={onNavigate}
                aria-label={`Account — ${user?.name ?? "Dashy user"}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-[11px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              >
                {user?.initials ?? "D"}
              </Link>
            </RailTip>
          </div>
        ) : (
          <div className="flex-shrink-0 border-t border-white/[0.06] p-3">
            <Link
              href="/settings"
              onClick={onNavigate}
              aria-current={settingsActive ? "page" : undefined}
              className={`${rowClass(settingsActive)} mb-1`}
            >
              <SettingsIcon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 truncate text-left">Settings</span>
            </Link>
            {accountCard}
          </div>
        )}
      </div>
    </aside>
  );
}
