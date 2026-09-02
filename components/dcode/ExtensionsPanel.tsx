"use client";

/**
 * DashyCore v7 — Extensions panel (Dashy Extensions).
 *
 * Lists the built-in first-party extensions with enable/disable toggles,
 * search filtering and a detail view of each manifest's contributions.
 * This is OUR curated web-safe marketplace format — there is no .vsix
 * install and no Microsoft Marketplace scraping.
 */

import { useMemo, useState } from "react";
import { BUILTIN_EXTENSIONS } from "@/lib/dcode/extensions/registry";
import { CheckIcon, PuzzleIcon, SearchIcon, SparklesIcon } from "@/components/icons";

interface ExtensionsPanelProps {
  /** Currently enabled extension ids. */
  enabled: string[];
  onToggle: (id: string, enabled: boolean) => void;
}

export function ExtensionsPanel({ enabled, onToggle }: ExtensionsPanelProps) {
  const [query, setQuery] = useState("");

  const extensions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUILTIN_EXTENSIONS;
    return BUILTIN_EXTENSIONS.filter((ext) =>
      [ext.manifest.name, ext.manifest.description, ext.manifest.id]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Extensions
      </p>

      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5">
          <SearchIcon className="h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search extensions…"
            spellCheck={false}
            aria-label="Search extensions"
            className="h-8 w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
          />
        </div>
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-2">
        {extensions.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-zinc-600">
            No extensions match “{query}”.
          </li>
        )}
        {extensions.map((ext) => {
          const isEnabled = enabled.includes(ext.manifest.id);
          const manifest = ext.manifest;
          const commandCount = manifest.contributes?.commands?.length ?? 0;
          const themeCount = manifest.contributes?.themes?.length ?? 0;
          return (
            <li
              key={manifest.id}
              className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]"
            >
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span
                  className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                    isEnabled
                      ? "bg-cyan-400/15 text-cyan-300"
                      : "bg-white/[0.04] text-zinc-500"
                  }`}
                >
                  <PuzzleIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-[13px] font-semibold text-zinc-100">
                      {manifest.name}
                    </h3>
                    <span className="flex-shrink-0 rounded border border-cyan-400/25 bg-cyan-400/10 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                      First party
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                    {manifest.description}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600">
                    {manifest.id} · v{manifest.version} · {manifest.author}
                  </p>
                  {(commandCount > 0 || themeCount > 0) && (
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Contributes{" "}
                      {[
                        commandCount > 0 ? `${commandCount} command${commandCount === 1 ? "" : "s"}` : "",
                        themeCount > 0 ? `${themeCount} theme${themeCount === 1 ? "" : "s"}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`${isEnabled ? "Disable" : "Enable"} ${manifest.name}`}
                  title={isEnabled ? "Disable — its commands leave the palette" : "Enable — its commands appear in the palette"}
                  onClick={() => onToggle(manifest.id, !isEnabled)}
                  className={`relative mt-1 h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                    isEnabled ? "bg-cyan-500" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      isEnabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-1.5 border-t border-white/[0.05] bg-black/20 px-3 py-1.5">
                <SparklesIcon className="h-3 w-3 text-cyan-400/70" />
                <span className="text-[10px] text-zinc-600">
                  {isEnabled ? "Active — commands are in the Command Palette" : "Disabled — commands hidden"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex-shrink-0 border-t border-white/[0.06] px-3 py-2">
        <p className="text-[10px] leading-relaxed text-zinc-600">
          <CheckIcon className="mr-1 inline h-3 w-3 text-cyan-400" />
          Dashy Extensions are curated and web-safe — no .vsix installs, no
          third-party marketplace. Coming: community extensions.
        </p>
      </div>
    </div>
  );
}
