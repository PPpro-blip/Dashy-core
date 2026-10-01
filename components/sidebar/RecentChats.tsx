"use client";

/**
 * DashyCore v7 — recent chats (expanded sidebar only).
 *
 * Lives in its own independently scrollable region so a long history never
 * pushes navigation, settings or the account card off screen. Hidden
 * entirely when the sidebar is collapsed — the rail keeps the Chats icon,
 * not a wall of chat icons.
 */

import { useMemo, useState } from "react";
import { MessageIcon, SearchIcon, TrashIcon } from "@/components/icons";
import type { Conversation } from "@/lib/conversations";

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

const MAX_VISIBLE = 20;

export function RecentChats({
  conversations,
  activeId,
  onOpen,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const visible = useMemo(() => {
    const filtered = query
      ? conversations.filter((c) => c.title.toLowerCase().includes(query))
      : conversations;
    return filtered.slice(0, MAX_VISIBLE);
  }, [conversations, query]);

  return (
    <div className="flex min-h-[6.5rem] flex-1 flex-col px-3 pt-3">
      <div className="flex-shrink-0">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-8 pr-3 text-[13px] text-zinc-200 placeholder-zinc-500 transition-colors focus:border-cyan-400/40 focus:outline-none"
          />
        </div>
        <p className="mt-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          Recent
        </p>
      </div>

      {/* Independently scrollable history. */}
      <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-zinc-600">
            {query ? "No matching chats" : "No chats yet"}
          </p>
        ) : (
          <ul className="space-y-0.5 pb-2">
            {visible.map((conversation) => {
              const isActive = activeId === conversation.id;
              return (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpen(conversation.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={`flex min-h-[38px] w-full items-center rounded-lg py-2 pl-2.5 pr-9 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                  </button>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0"
                  >
                    {relativeTime(conversation.updatedAt)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete chat: ${conversation.title}`}
                    onClick={() => onDelete(conversation.id)}
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-red-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 group-hover:opacity-100"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {conversations.length === 0 && !query && (
        <p className="flex-shrink-0 px-1 pb-2 text-[11px] leading-relaxed text-zinc-600">
          <MessageIcon className="mr-1 inline h-3 w-3 align-[-2px]" />
          Start a chat and it shows up here.
        </p>
      )}
    </div>
  );
}
