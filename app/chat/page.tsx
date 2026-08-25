"use client";

/**
 * Phase 1 chat placeholder canvas
 * Minimal placeholder with welcome text and quick action pills
 */
export default function ChatPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      {/* Welcome text */}
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white md:text-3xl">
          What are we building today?
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Start a conversation or choose a quick action below
        </p>
      </div>

      {/* Quick action pills */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button className="rounded-full border border-neutral-700 bg-neutral-900/50 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white">
          Analyze architecture
        </button>
        <button className="rounded-full border border-neutral-700 bg-neutral-900/50 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white">
          Search workspace memory
        </button>
        <button className="rounded-full border border-neutral-700 bg-neutral-900/50 px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white">
          Draft code
        </button>
      </div>
    </div>
  );
}