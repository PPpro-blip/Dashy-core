"use client";

/**
 * DashyCore v7 — /share (THE Share Hub route).
 *
 * Thin route wrapper: all behaviour lives in the single canonical
 * <ShareHub /> (components/share/ShareHub). Entry points everywhere in the
 * workspace link here with ?sourceType=…&sourceId=… to pre-select their
 * exact source. /share-hub redirects here (next.config.mjs).
 */

import { Suspense } from "react";
import { ShareHub } from "@/components/share/ShareHub";
import { LoaderIcon } from "@/components/icons";

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-zinc-500">
          <LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />
          Opening Share Hub…
        </div>
      }
    >
      <ShareHub />
    </Suspense>
  );
}
