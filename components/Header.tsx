"use client";

import Image from "next/image";

interface HeaderProps {
  sessionTitle?: string;
}

export function Header({ sessionTitle }: HeaderProps = {}) {
  return (
    <header className="h-16 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-6 flex items-center justify-between text-zinc-200">
      <div className="flex items-center gap-3">
        <Image
          src="/icon-512.png"
          alt="DashyCore"
          width={26}
          height={26}
          className="rounded-md object-contain md:hidden"
        />
        <h2 className="text-sm font-medium text-zinc-300">
          {sessionTitle || "Intelligence Workspace"}
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>flow-state online</span>
        </div>
      </div>
    </header>
  );
}