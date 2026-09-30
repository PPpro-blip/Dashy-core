"use client";

/**
 * Dashy Studio — Generate | Library tab bar.
 *
 * Real routes (matching lib/navigation's Studio children), not local state:
 * /studio is the Generate tab, /studio/library the Library tab.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ImageIcon, SparklesIcon } from "@/components/icons";

const TABS = [
  { href: "/studio", label: "Generate", Icon: SparklesIcon },
  { href: "/studio/library", label: "Library", Icon: ImageIcon },
] as const;

export function StudioTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Studio sections"
      className="flex w-fit gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-md"
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
              active
                ? "bg-cyan-400/15 text-cyan-200 shadow-lg shadow-cyan-950/40"
                : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
