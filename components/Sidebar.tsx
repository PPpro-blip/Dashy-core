"use client";

import Link from "next/navigation";
import Image from "next/image";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { name: "Chat", href: "/chat", icon: "💬" },
  { name: "Settings", href: "/settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800/80 flex flex-col justify-between h-screen p-4 text-zinc-300">
      <div className="space-y-6">
        {/* BRAND LOGO WITH REAL ICON-512.PNG */}
        <div className="flex items-center gap-3 px-2 py-1">
          <Image
            src="/icon-512.png"
            alt="DashyCore Logo"
            width={32}
            height={32}
            priority
            className="rounded-lg object-contain shadow-md shadow-purple-950/40"
          />
          <span className="font-semibold text-lg text-white tracking-tight">
            DashyCore
          </span>
        </div>

        {/* NAVIGATION LINKS */}
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-zinc-900 text-white border border-zinc-800 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.name}</span>
              </a>
            );
          })}
        </nav>
      </div>

      {/* FOOTER BADGE */}
      <div className="p-3 bg-zinc-900/50 border border-zinc-800/60 rounded-xl text-xs text-zinc-500 font-mono flex items-center justify-between">
        <span>DashyCore v7</span>
        <span className="text-emerald-400 font-medium">v7.0.0</span>
      </div>
    </aside>
  );
}