"use client";

/**
 * DashyCore v7 — /share (global Share Hub entry).
 *
 * Renders THE Share Hub (components/share/ShareHub) as a focused page with
 * no pre-selected source, so the first question is "what are you sharing?".
 * Contextual entry points render the exact same component inside a drawer.
 */

import { ShareHub } from "@/components/share/ShareHub";

export default function ShareHubPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-0 py-0 sm:px-4 sm:py-6">
      <div className="overflow-hidden rounded-none border-0 border-white/[0.06] bg-white/[0.015] sm:rounded-2xl sm:border">
        <ShareHub variant="page" />
      </div>
    </div>
  );
}
