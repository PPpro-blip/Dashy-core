"use client";

/**
 * DashyCore v7 — clean placeholder for routes whose feature is still being
 * built. A real, navigable page (not a disabled sidebar button): explains
 * what the section will do, is honest about construction status, and links
 * back to the workspace. No fake functionality.
 */

import Link from "next/link";
import type { ComponentType } from "react";
import { MessageIcon } from "@/components/icons";

export function PlaceholderPage({
  Icon,
  title,
  tagline,
  description,
  points,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  tagline: string;
  description: string;
  points: string[];
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{tagline}</p>

      <section className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10">
          <Icon className="h-6 w-6 text-cyan-400" />
        </div>
        <p className="mt-4 text-base font-medium text-zinc-100">
          This section is being built
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
          {description}
        </p>

        <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
          {points.map((point) => (
            <li
              key={point}
              className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-2.5"
            >
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400/70" />
              <span className="text-[13px] leading-relaxed text-zinc-400">{point}</span>
            </li>
          ))}
        </ul>

        <Link
          href="/chat"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] shadow-lg shadow-cyan-500/20 transition-all hover:bg-cyan-400"
        >
          <MessageIcon className="h-4 w-4" />
          Back to chats
        </Link>
      </section>
    </div>
  );
}
