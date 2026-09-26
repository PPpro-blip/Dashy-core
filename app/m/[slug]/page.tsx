import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  firstParam,
  requestOrigin,
  type ShareSearchParams,
} from "@/lib/share-og";
import {
  decodeStudioShareSlug,
  studioProxyPath,
  studioShareTitle,
} from "@/lib/studio-share";

/**
 * DashyCore — /m/[slug] — public Studio image share page.
 *
 * The Studio's Share button opens the Share Hub with this URL. The slug
 * carries the exact prompt-mode /api/img-proxy parameters of the tile (see
 * lib/studio-share), so:
 *
 *   - `generateMetadata` emits DYNAMIC Open Graph + Twitter tags whose
 *     og:image is the ABSOLUTE proxied Studio image (the same `asset.url` the
 *     Media Library card displays) with its real width/height — WhatsApp, X,
 *     LinkedIn, Facebook, Slack, Discord, Telegram unfurl the actual render.
 *     Link-preview bots get these tags blocking in <head> (next.config
 *     `htmlLimitedBots`).
 *   - Composer overrides (`?title=&desc=` from lib/share-intents
 *     #buildOgShareUrl) win over the prompt-derived defaults.
 *   - People see a lightweight public viewer with a CTA back into Studio.
 *
 * Public by design: no project row, nothing private — the slug IS the asset.
 * Malformed slugs 404.
 */

interface StudioSharePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ShareSearchParams>;
}

const DEFAULT_DESCRIPTION = "Made with Dashy Studio ⚡ — AI image generation in DashyCore.";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

async function resolve(props: StudioSharePageProps) {
  const [{ slug }, sp, origin] = await Promise.all([
    props.params,
    props.searchParams,
    requestOrigin(),
  ]);
  const asset = decodeStudioShareSlug(slug);
  if (!asset) return null;

  const title = clip(firstParam(sp, "title").trim() || studioShareTitle(asset.prompt), 200);
  const description = clip(
    firstParam(sp, "desc").trim() || `“${studioShareTitle(asset.prompt, 160)}” — ${DEFAULT_DESCRIPTION}`,
    500
  );
  const imagePath = studioProxyPath(asset);
  const imageUrl = `${origin}${imagePath}`;
  const pageUrl = new URL(`/m/${slug}`, origin);
  for (const key of ["title", "desc", "v"] as const) {
    const value = firstParam(sp, key);
    if (value) pageUrl.searchParams.set(key, value);
  }
  return { asset, title, description, imagePath, imageUrl, url: pageUrl.toString() };
}

export async function generateMetadata(props: StudioSharePageProps): Promise<Metadata> {
  const og = await resolve(props);
  if (!og) return { title: "Image not found — DashyCore" };
  const image = {
    url: og.imageUrl,
    secureUrl: og.imageUrl.startsWith("https://") ? og.imageUrl : undefined,
    width: og.asset.width,
    height: og.asset.height,
    type: "image/jpeg",
    alt: og.asset.prompt.slice(0, 300),
  };
  return {
    title: og.title,
    description: og.description,
    alternates: { canonical: og.url },
    openGraph: {
      title: og.title,
      description: og.description,
      url: og.url,
      type: "website",
      siteName: "DashyCore Studio",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: og.title,
      description: og.description,
      images: [{ url: og.imageUrl, alt: image.alt }],
    },
  };
}

export default async function StudioSharePage(props: StudioSharePageProps) {
  const og = await resolve(props);
  if (!og) notFound();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070a13] p-4 text-zinc-100 sm:p-8">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />

      <article className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div
          className="relative w-full bg-black/40"
          style={{ aspectRatio: `${og.asset.width} / ${og.asset.height}`, maxHeight: "70vh" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={og.imagePath}
            alt={og.asset.prompt}
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>
        <div className="space-y-3 p-5 sm:p-6">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px] shadow-cyan-300" />
            Made with Dashy Studio
          </p>
          <h1 className="text-lg font-bold leading-snug sm:text-xl">{og.title}</h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            <span className="text-zinc-500">Prompt · </span>
            {og.asset.prompt}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="/studio"
              className="inline-flex items-center rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2 text-sm font-semibold text-[#06121f] shadow-lg shadow-cyan-500/20 transition hover:brightness-110"
            >
              Make your own
            </a>
            <a
              href={og.imagePath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-cyan-400/40 hover:text-cyan-200"
            >
              Open full image
            </a>
          </div>
        </div>
      </article>
    </main>
  );
}
