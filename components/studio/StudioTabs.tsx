"use client";

/**
 * Studio section switcher — Generate ↔ Library.
 *
 * Studio owns its own sub-navigation instead of pushing every operation
 * into the global sidebar.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ImageIcon, SparklesIcon } from "@/components/icons";

const TABS = [
  { href: "/studio", label: "Generate", Icon: SparklesIcon, exact: true },
  { href: "/studio/library", label: "Library", Icon: ImageIcon, exact: false },
];

export function StudioTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Studio sections" className="flex gap-1.5">
      {TABS.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
              active
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-100"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
