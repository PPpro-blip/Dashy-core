"use client";

interface HeaderProps {
  sessionTitle?: string;
}

export function Header({ sessionTitle = "New Chat" }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 bg-[#09090b]/80 px-4 py-3 backdrop-blur-md">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-medium text-white">{sessionTitle}</h1>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        {/* Active Model Badge */}
        <div className="flex items-center gap-2 rounded-full border border-neutral-700/50 bg-neutral-900/50 px-3 py-1.5">
          <span className="text-xs font-medium text-neutral-300">dashy-allround</span>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-xs text-neutral-400">Active</span>
        </div>

        {/* System Status */}
        <div className="flex items-center gap-2 rounded-full border border-neutral-700/50 bg-neutral-900/50 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs text-neutral-400">Online</span>
        </div>
      </div>
    </header>
  );
}
