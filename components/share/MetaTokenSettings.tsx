"use client";

/**
 * DashyCore v7 — Settings → Meta Share (Direct API Pro).
 *
 * Holds the Meta Graph access token that powers one-click publishing from the
 * Share Hub to a Facebook Page feed and an Instagram professional account.
 *
 * The token is stored in THIS browser's localStorage only. It is never sent to
 * a DashyCore server, never written to the database, and the only requests it
 * is used for go straight to graph.facebook.com from your device.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  FacebookIcon,
  InstagramIcon,
  KeyIcon,
  LoaderIcon,
  TrashIcon,
} from "@/components/icons";
import { useToast } from "@/components/Toast";
import {
  fetchMetaProfile,
  META_REQUIRED_SCOPES,
  readMetaToken,
  writeMetaToken,
  type MetaProfile,
} from "@/lib/meta-graph";

export function MetaTokenSettings() {
  const toast = useToast();
  const [token, setToken] = useState("");
  const [stored, setStored] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [profile, setProfile] = useState<MetaProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = readMetaToken();
    setToken(existing);
    setStored(existing.length > 0);
  }, []);

  const save = useCallback(() => {
    const value = token.trim();
    if (!value) {
      toast.error("Nothing to save", "Paste a Meta Graph access token first.");
      return;
    }
    writeMetaToken(value);
    setStored(true);
    setProfile(null);
    setError(null);
    toast.success("Token saved", "Stored in this browser only.");
  }, [toast, token]);

  const remove = useCallback(() => {
    writeMetaToken(null);
    setToken("");
    setStored(false);
    setProfile(null);
    setError(null);
    toast.info("Token removed", "Direct API Pro is off; Standard mode still works.");
  }, [toast]);

  const test = useCallback(async () => {
    const value = token.trim() || readMetaToken();
    if (!value) {
      toast.error("Nothing to test", "Paste a token (or save one) first.");
      return;
    }
    setTesting(true);
    setError(null);
    try {
      const result = await fetchMetaProfile(value);
      setProfile(result);
      const withInstagram = result.pages.filter((page) => page.instagramUserId).length;
      toast.success(
        "Token works",
        `${result.name} · ${result.pages.length} Page(s), ${withInstagram} with Instagram.`
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unexpected error.";
      setError(message);
      setProfile(null);
      toast.error("Token rejected", message);
    } finally {
      setTesting(false);
    }
  }, [toast, token]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[16rem] flex-1">
          <span className="mb-1 block text-[11px] font-medium text-zinc-400">
            Meta Graph access token
          </span>
          <span className="relative block">
            <KeyIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <input
              type={revealed ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="EAAG…  (long-lived user or Page token)"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-white/[0.08] bg-[#0a0e1a] py-2 pl-8 pr-16 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-cyan-400/50"
            />
            <button
              type="button"
              onClick={() => setRevealed((previous) => !previous)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
            >
              {revealed ? "hide" : "show"}
            </button>
          </span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            className="rounded-xl bg-cyan-500 px-3.5 py-2 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
          >
            Save token
          </button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/[0.07] disabled:opacity-50"
          >
            {testing ? <LoaderIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" /> : null}
            Test connection
          </button>
          {stored ? (
            <button
              type="button"
              onClick={remove}
              title="Remove the stored token"
              aria-label="Remove the stored token"
              className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-red-300 transition-colors hover:bg-red-500/20"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-xs leading-relaxed text-red-200"
        >
          {error}
        </p>
      ) : null}

      {profile ? (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected as {profile.name}
            <span className="rounded-full border border-emerald-400/25 px-1.5 py-px text-[10px] font-medium text-emerald-200/80">
              {profile.tokenKind === "page" ? "Page token" : "User token"}
            </span>
          </p>
          {profile.pages.length === 0 ? (
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              This token administers no Facebook Pages, so there is nowhere to
              publish yet. Use a Page token (or a user token with{" "}
              <code className="font-mono text-[11px] text-zinc-300">pages_show_list</code>).
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {profile.pages.map((page) => (
                <li
                  key={page.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-[#0a0e1a]/60 px-2.5 py-1.5"
                >
                  <FacebookIcon className="h-3.5 w-3.5 flex-shrink-0 text-[#1877f2]" />
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                    {page.name}
                  </span>
                  {page.instagramUserId ? (
                    <span className="flex items-center gap-1 rounded-full border border-pink-400/25 bg-pink-500/10 px-2 py-0.5 text-[10px] text-pink-200">
                      <InstagramIcon className="h-3 w-3" />
                      @{page.instagramUsername ?? page.instagramUserId}
                    </span>
                  ) : (
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-500">
                      no Instagram account
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
          What this unlocks
        </p>
        <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-zinc-400">
          <li>
            <span className="text-zinc-200">Facebook</span> — posts the caption
            and the share link (its preview card comes from the link&apos;s
            Open Graph tags) to a Page feed you manage.
          </li>
          <li>
            <span className="text-zinc-200">Instagram</span> — creates a media
            container from a public JPEG image URL and publishes it to the
            Instagram professional account linked to that Page.
          </li>
          <li>
            Token needs{" "}
            {META_REQUIRED_SCOPES.map((scope, index) => (
              <span key={scope}>
                <code className="font-mono text-[11px] text-cyan-300">{scope}</code>
                {index < META_REQUIRED_SCOPES.length - 1 ? ", " : ""}
              </span>
            ))}
            . Get one from the Graph API Explorer or Meta Business Suite.
          </li>
          <li>
            Without a token the Share Hub still works in Standard mode: it copies
            the caption and opens Meta&apos;s own web share surface.
          </li>
        </ul>
      </div>
    </div>
  );
}
