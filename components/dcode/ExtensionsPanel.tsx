"use client";

/**
 * DashyCore v7 — Extensions panel (Dashy Extensions).
 *
 * Two tabs:
 *   - INSTALLED: enable/disable toggles, version/author, uninstall (disable).
 *     Built-ins are always listed (labelled "Built-in") — uninstall just
 *     disables and removes them from the enabled set.
 *   - DISCOVER: the curated, third-party-feel marketplace. Search + category
 *     chips + Install/Installed cards. Data source is the local catalog
 *     (lib/dcode/extensions/catalog.ts).
 *
 * HONEST: this is OUR web-safe extension format. There is no .vsix install and
 * no Open VSX/Microsoft Marketplace — a real desktop extension cannot run in a
 * browser tab, so we ship native equivalents (Agent Code ≈ Cline, Pair Coder ≈
 * Roo). Install = enable a first-party module and register its commands live.
 */

import { useMemo, useState } from "react";
import { BUILTIN_EXTENSIONS } from "@/lib/dcode/extensions/registry";
import {
  CATALOG_CATEGORIES,
  DISCOVER_CATALOG,
  type CatalogCategory,
} from "@/lib/dcode/extensions/catalog";
import { EXTENSIONS_HONEST_BANNER } from "@/lib/dcode/extensions";
import {
  CheckIcon,
  DownloadIcon,
  InfoIcon,
  PuzzleIcon,
  SearchIcon,
  SparklesIcon,
} from "@/components/icons";

interface ExtensionsPanelProps {
  /** Currently enabled extension ids. */
  enabled: string[];
  onToggle: (id: string, enabled: boolean) => void;
}

type Tab = "installed" | "discover";

export function ExtensionsPanel({ enabled, onToggle }: ExtensionsPanelProps) {
  const [tab, setTab] = useState<Tab>("installed");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Extensions
      </p>

      {/* Honest banner */}
      <div className="mx-2.5 mb-2 flex items-start gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-2">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-cyan-300" />
        <p className="text-[10px] leading-relaxed text-cyan-100/80">
          {EXTENSIONS_HONEST_BANNER}
        </p>
      </div>

      {/* Tabs */}
      <div className="mx-2.5 mb-2 flex gap-1 rounded-lg border border-white/[0.06] bg-black/20 p-0.5">
        {(["installed", "discover"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors ${
              tab === t
                ? "bg-cyan-500/15 text-cyan-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "installed" ? (
        <InstalledTab enabled={enabled} onToggle={onToggle} />
      ) : (
        <DiscoverTab enabled={enabled} onToggle={onToggle} />
      )}
    </div>
  );
}

/* ------------------------------- installed ---------------------------- */

function InstalledTab({ enabled, onToggle }: ExtensionsPanelProps) {
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
    <>
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5">
          <SearchIcon className="h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search installed…"
            spellCheck={false}
            aria-label="Search installed extensions"
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
                  className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-base ${
                    isEnabled
                      ? "bg-cyan-400/15 text-cyan-300"
                      : "bg-white/[0.04] text-zinc-500"
                  }`}
                >
                  {manifest.icon ?? <PuzzleIcon className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-[13px] font-semibold text-zinc-100">
                      {manifest.name}
                    </h3>
                    <span className="flex-shrink-0 rounded border border-cyan-400/25 bg-cyan-400/10 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                      Built-in
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
                        commandCount > 0
                          ? `${commandCount} command${commandCount === 1 ? "" : "s"}`
                          : "",
                        themeCount > 0
                          ? `${themeCount} theme${themeCount === 1 ? "" : "s"}`
                          : "",
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
                  title={
                    isEnabled
                      ? "Disable — its commands leave the palette"
                      : "Enable — its commands appear in the palette"
                  }
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
              <div className="flex items-center justify-between gap-1.5 border-t border-white/[0.05] bg-black/20 px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  <SparklesIcon className="h-3 w-3 text-cyan-400/70" />
                  <span className="text-[10px] text-zinc-600">
                    {isEnabled
                      ? "Active — commands are in the Command Palette"
                      : "Disabled — commands hidden"}
                  </span>
                </span>
                {isEnabled && (
                  <button
                    type="button"
                    onClick={() => onToggle(manifest.id, false)}
                    className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors hover:border-red-400/40 hover:text-red-300"
                  >
                    Uninstall
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------- discover ----------------------------- */

function DiscoverTab({ enabled, onToggle }: ExtensionsPanelProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogCategory | "All">("All");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DISCOVER_CATALOG.filter((e) => {
      const matchesCat = category === "All" || e.categories.includes(category);
      const matchesQuery =
        !q ||
        [e.name, e.description, e.author, e.id, e.equivalentOf ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesCat && matchesQuery;
    });
  }, [query, category]);

  return (
    <>
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5">
          <SearchIcon className="h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the marketplace…"
            spellCheck={false}
            aria-label="Search extensions marketplace"
            className="h-8 w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
          />
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
        {(["All", ...CATALOG_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
              category === c
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
        {results.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-zinc-600">
            No extensions match your search.
          </li>
        )}
        {results.map((entry) => {
          const isInstalled = enabled.includes(entry.id);
          return (
            <li
              key={entry.id}
              className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]"
            >
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-lg">
                  {entry.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-[13px] font-semibold text-zinc-100">
                      {entry.name}
                    </h3>
                    {entry.equivalentOf && (
                      <span className="flex-shrink-0 rounded border border-fuchsia-400/25 bg-fuchsia-400/10 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-fuchsia-300">
                        {entry.equivalentOf}-style
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                    {entry.description}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
                    <span>{entry.author}</span>
                    {entry.rating && (
                      <span className="text-amber-300/80">★ {entry.rating}</span>
                    )}
                    {entry.installs && <span>{entry.installs} installs</span>}
                    <span>v{entry.version}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-1.5 border-t border-white/[0.05] bg-black/20 px-3 py-1.5">
                <span className="flex flex-wrap gap-1">
                  {entry.categories.map((c) => (
                    <span
                      key={c}
                      className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500"
                    >
                      {c}
                    </span>
                  ))}
                </span>
                {isInstalled ? (
                  <span className="flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">
                    <CheckIcon className="h-3 w-3" />
                    Installed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggle(entry.id, true)}
                    className="flex items-center gap-1 rounded-md bg-cyan-500 px-2.5 py-1 text-[10px] font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
                  >
                    <DownloadIcon className="h-3 w-3" />
                    Install
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
