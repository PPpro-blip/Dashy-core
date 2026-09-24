import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  isLinkPreviewRequest,
  lookupShareProject,
  requestOrigin,
  resolveShareOg,
  shareOgMetadata,
  toQueryString,
  type ShareSearchParams,
} from "@/lib/share-og";

/**
 * DashyCore v7 — /s/[slug] (clean public short link).
 *
 * Every Share Hub action copies this short URL, so it is also the URL that
 * Facebook, X, LinkedIn, WhatsApp, Slack, Discord, Telegram … unfurl.
 *
 *   - `generateMetadata` emits DYNAMIC Open Graph + Twitter tags for the
 *     project: the composer draft's `?title=&desc=&img=` overrides first, then
 *     the project row (title, description, file summary, largest image), then
 *     the branded share card (see lib/share-og).
 *   - Link-preview crawlers get a 200 with those tags plus a small
 *     server-rendered preview card — they never run JavaScript and read the
 *     tags straight from this response.
 *   - People (and search engines) are redirected (307) to the canonical
 *     /d-code/share/[slug] viewer with the query string preserved, so
 *     `?open=1` still auto-opens the Share Hub there.
 *
 * Private / missing projects never reach this file: middleware answers them
 * with a static 403 first.
 */

interface ShortSharePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ShareSearchParams>;
}

export async function generateMetadata({
  params,
  searchParams,
}: ShortSharePageProps): Promise<Metadata> {
  const [{ slug }, sp, origin, crawler] = await Promise.all([
    params,
    searchParams,
    requestOrigin(),
    isLinkPreviewRequest(),
  ]);
  // People are redirected before any HTML is sent, so only crawlers need the
  // database-backed description (the lookup is memoised for the page below).
  const project = crawler ? await lookupShareProject(slug) : null;
  return shareOgMetadata(
    resolveShareOg({
      origin,
      shareKey: slug,
      pagePath: `/s/${encodeURIComponent(slug)}`,
      searchParams: sp,
      project,
    })
  );
}

export default async function ShortSharePage({ params, searchParams }: ShortSharePageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const viewerPath = `/d-code/share/${encodeURIComponent(slug)}${toQueryString(sp)}`;

  if (!(await isLinkPreviewRequest())) {
    redirect(viewerPath);
  }

  const origin = await requestOrigin();
  const project = await lookupShareProject(slug);
  const og = resolveShareOg({
    origin,
    shareKey: slug,
    pagePath: `/s/${encodeURIComponent(slug)}`,
    searchParams: sp,
    project,
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b1020] p-6 text-zinc-100">
      <article className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={og.imageUrl}
          alt={og.title}
          className={`w-full bg-black/30 ${og.isProjectImage ? "max-h-80 object-contain" : "aspect-[1200/630] object-cover"}`}
        />
        <div className="space-y-3 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
            Shared from DashyCore D-Code
          </p>
          <h1 className="text-xl font-bold leading-snug">{og.title}</h1>
          <p className="text-sm leading-relaxed text-zinc-400">{og.description}</p>
          {project && project.languages.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Languages">
              {project.languages.slice(0, 5).map((language) => (
                <li
                  key={language}
                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200"
                >
                  {language}
                </li>
              ))}
            </ul>
          ) : null}
          <a
            href={viewerPath}
            className="inline-flex items-center rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
          >
            Open the project
          </a>
        </div>
      </article>
    </main>
  );
}
