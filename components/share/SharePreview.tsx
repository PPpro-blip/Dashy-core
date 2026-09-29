"use client";

/**
 * DashyCore v7 — Share Hub preview.
 *
 * Renders the composed post for the selected platform using the REAL source
 * data (title, public URL, generated media). It is a preview of what you are
 * about to hand to the platform — never a claim that anything was published.
 */

import Image from "next/image";
import type { ShareProvider } from "@/lib/share/providers";
import type { ResolvedSource } from "@/lib/share/types";
import { GlobeIcon, LinkIcon } from "@/components/icons";

interface SharePreviewProps {
  provider: ShareProvider;
  text: string;
  url: string;
  mediaUrl: string | null;
  source: ResolvedSource;
  authorName: string;
  authorInitials: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function SharePreview({
  provider,
  text,
  url,
  mediaUrl,
  source,
  authorName,
  authorInitials,
}: SharePreviewProps) {
  const host = hostOf(url);
  const isChat = provider.id === "whatsapp";

  if (isChat) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0b141a] p-3">
        <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-sm bg-[#005c4b] px-3 py-2">
          {mediaUrl && (
            <div className="mb-2 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl} alt="" className="h-auto w-full object-cover" />
            </div>
          )}
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white">
            {text || "Your message…"}
          </p>
          {url && (
            <p className="mt-1 break-all text-[12px] text-cyan-200 underline">{url}</p>
          )}
          <p className="mt-1 text-right text-[10px] text-white/50">now</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1226]"
      style={{ boxShadow: `inset 0 1px 0 0 ${provider.accent}14` }}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-[11px] font-semibold text-white">
          {authorInitials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-zinc-100">
            {authorName}
            <span className="text-xs font-normal text-zinc-500">
              {provider.id === "linkedin" ? "· now" : "· now"}
            </span>
          </p>

          {provider.prefill.text ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
              {text || "Your caption…"}
            </p>
          ) : (
            <div className="mt-1.5">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
                {text || "Your caption…"}
              </p>
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/90">
                {provider.label} will not receive this caption automatically —
                it is copied to your clipboard so you can paste it.
              </p>
            </div>
          )}
        </div>
      </div>

      {mediaUrl && (
        <div className="relative aspect-square w-full border-y border-white/[0.06] bg-black/40">
          <Image
            src={mediaUrl}
            alt={source.title}
            fill
            unoptimized
            sizes="(max-width: 1024px) 100vw, 380px"
            className="object-cover"
          />
        </div>
      )}

      {url && !mediaUrl && (
        <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-white/[0.08] bg-black/25">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[11px] text-zinc-500">
            <GlobeIcon className="h-3 w-3" />
            {host || "link preview"}
          </div>
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium text-zinc-100">
              {source.title}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              {source.typeLabel} · DashyCore
            </p>
          </div>
        </div>
      )}

      {url && mediaUrl && (
        <p className="flex items-center gap-1.5 px-4 py-3 text-[11px] text-zinc-500">
          <LinkIcon className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{url}</span>
        </p>
      )}
    </div>
  );
}
