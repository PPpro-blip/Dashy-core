import type { Metadata } from "next";
import { headers } from "next/headers";
import { SharePageView } from "@/components/share/SharePageView";

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
 * When a crawler (or anyone) visits that URL, this metadata injects those
 * values into the OG tags. The `img` param points at a project image served
 * by the /og-image route; it falls back to the DashyCore logo.
 */

interface SharePageProps {
  params: Promise<{ share_slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export async function generateMetadata({
  params,
  searchParams,
}: SharePageProps): Promise<Metadata> {
  const { share_slug } = await params;
  const sp = await searchParams;

  const title = first(sp, "title");
  const desc = first(sp, "desc");
  const img = first(sp, "img");

  const ogTitle = title.trim() || "A shared D-Code project";
  const ogDesc =
    desc.trim() || "Built with DashyCore D-Code ⚡ — view, copy and remix it.";

  // Build an absolute origin at request time (dev = localhost, prod = real).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const pageUrl = `${origin}/d-code/share/${share_slug}`;

  const ogImage = img
    ? `${origin}/d-code/share/${encodeURIComponent(
        share_slug
      )}/og-image?file=${encodeURIComponent(img)}`
    : `${origin}/icon-512.png`;

  return {
    title: ogTitle,
    description: ogDesc,
    openGraph: {
      title: ogTitle,
      description: ogDesc,
      url: pageUrl,
      type: "website",
      siteName: "DashyCore",
      images: [{ url: ogImage, width: 512, height: 512, alt: ogTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDesc,
      images: [ogImage],
    },
  };
}

export default function DCodeSharePage() {
  return <SharePageView />;
}
