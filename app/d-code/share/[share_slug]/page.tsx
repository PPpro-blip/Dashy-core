import type { Metadata } from "next";
import { SharePageView } from "@/components/share/SharePageView";
import {
  isLinkPreviewRequest,
  lookupShareProject,
  requestOrigin,
  resolveShareOg,
  shareOgMetadata,
  type ShareSearchParams,
} from "@/lib/share-og";

/**
 * DashyCore v7 — /d-code/share/[share_slug] (public read-only viewer).
 *
 * Server entry that:
 *   1. Renders <SharePageView> (client) which fetches the project by slug.
 *   2. Exports generateMetadata so Open Graph tags drive link previews
 *      (especially Facebook, whose sharer only reads a URL).
 *
 * The owner's composer builds a public share URL carrying the draft as query
 * params (`title`, `desc`, `img`, `v`) — see lib/share-intents#buildOgShareUrl.
 * Those values win; link-preview crawlers additionally get the project's own
 * title / description / largest image from the database, and everything
 * falls back to the branded share card. Resolution lives in lib/share-og and
 * is shared with the /s/[slug] short link.
 */

interface SharePageProps {
  params: Promise<{ share_slug: string }>;
  searchParams: Promise<ShareSearchParams>;
}

export async function generateMetadata({
  params,
  searchParams,
}: SharePageProps): Promise<Metadata> {
  const [{ share_slug }, sp, origin, crawler] = await Promise.all([
    params,
    searchParams,
    requestOrigin(),
    isLinkPreviewRequest(),
  ]);
  // Visitors' browsers load the project client-side; only crawlers need the
  // database-backed preview, so people never pay for an extra read.
  const project = crawler ? await lookupShareProject(share_slug) : null;
  return shareOgMetadata(
    resolveShareOg({
      origin,
      shareKey: share_slug,
      pagePath: `/d-code/share/${encodeURIComponent(share_slug)}`,
      searchParams: sp,
      project,
    })
  );
}

export default function DCodeSharePage() {
  return <SharePageView />;
}
