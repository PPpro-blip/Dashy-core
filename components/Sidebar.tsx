"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "./SignOutButton";
import { createClient } from "@/lib/supabase/client";

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const router = useRouter();

  const handleNewChat = () => {
    router.push("/chat");
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside
      className={`flex flex-col bg-[#0C0C0E] border-r border-neutral-800 transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Top section */}
      <div className="flex flex-col p-4">
        {/* New Chat button */}
        <button
          onClick={handleNewChat}
          className="flex items-center gap-3 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-all hover:bg-indigo-500 active:scale-[0.98]"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 flex-shrink-0"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {!isCollapsed && (
            <>
              <span>New Chat</span>
              <span className="ml-auto text-xs text-indigo-200/70">⌘K</span>
            </>
          )}
        </button>

        {/* Recent Conversations */}
        {!isCollapsed && (
          <div className="mt-6">
            <h3 className="mb-3 px-4 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
              Recent
            </h3>
            <div className="space-y-1">
              <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800/50 hover:text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 flex-shrink-0 text-neutral-500"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">Architecture analysis</span>
              </button>
              <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800/50 hover:text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 flex-shrink-0 text-neutral-500"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">Code review session</span>
              </button>
              <button className="w-full flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800/50 hover:text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 flex-shrink-0 text-neutral-500"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">Memory search</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation links */}
      <div className="flex-1 border-t border-neutral-800/50 p-4">
        <nav className="space-y-1">
          <button className="w-full flex items-center gap-3 rounded-lg bg-neutral-800/50 px-4 py-2.5 text-sm font-medium text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 flex-shrink-0"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {!isCollapsed && <span>Chat</span>}
          </button>

          <button
            disabled
            className="w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-800/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 flex-shrink-0"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            {!isCollapsed && (
              <>
                <span>D-Code</span>
                <span className="ml-auto rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                  SOON
                </span>
              </>
            )}
          </button>

          <button
            disabled
            className="w-full flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-800/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 flex-shrink-0"
            >
              <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
              <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
            </svg>
            {!isCollapsed && (
              <>
                <span>Memory / RAG</span>
                <span className="ml-auto rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
                  SOON
                </span>
              </>
            )}
          </button>
        </nav>
      </div>

      {/* Bottom section - User profile */}
      <div className="border-t border-neutral-800/50 p-4">
        {!isCollapsed && (
          <div className="mb-3 flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-medium text-white">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-white">User</p>
              <p className="truncate text-xs text-neutral-500">user@example.com</p>
            </div>
            <button className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex-1 flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 transition-transform ${isCollapsed ? "rotate-180" : ""}`}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          {isCollapsed ? (
            <button
              onClick={handleSignOut}
              className="flex-1 flex items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
              aria-label="Sign out"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          ) : (
            <SignOutButton />
          )}
        </div>
      </div>
    </aside>
  );
}
