import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { ShareViewer } from "./ShareViewer";

/**
 * DashyCore — /d-code/share/[share_slug] (server wrapper).
 *
 * Renders per-slug Open Graph / Twitter Card tags so links shared from the
 * Share Hub unfurl with the real project title + description on X,
 * WhatsApp, and LinkedIn. Crawlers never run JS, so these tags MUST come
 * from the server — the interactive viewer below stays client-side.
 *
 * The metadata fetch uses the anon key: RLS only reveals the row when
 * is_public = true, so private/revoked slugs safely fall back to the
 * generic "private link" tags. Always dynamic — share state can flip at
 * any moment via the Share Hub.
 */

export const dynamic = "force-dynamic";

interface SharedMeta {
  title: string;
  description: string | null;
}

async function fetchSharedMeta(slug: string): Promise<SharedMeta | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !slug) return null;
  try {
    const supabase = createClient(url, anonKey);
    const { data, error } = await supabase
      .from("dcode_projects")
      .select("title, description")
      .eq("share_slug", slug)
      .eq("is_public", true)
      .maybeSingle();
    if (error || !data) return null;
    return {
      title: (data.title as string) || "Untitled project",
      description: (data.description as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

function appOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return undefined;
  return raw.replace(/\/$/, "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ share_slug: string }>;
}): Promise<Metadata> {
  const { share_slug } = await params;
  const meta = await fetchSharedMeta(share_slug);
  const origin = appOrigin();
  const canonical = origin ? `${origin}/d-code/share/${share_slug}` : undefined;

  if (!meta) {
    // Private / revoked / unknown slug: still return unfurl tags so the
    // link preview degrades gracefully instead of rendering blank.
    const fallback = "This link is private or no longer exists.";
    return {
      title: "Shared D-Code project",
      description: fallback,
      openGraph: {
        title: "Shared D-Code project",
        description: fallback,
        type: "article",
        siteName: "DashyCore",
      },
      twitter: {
        card: "summary",
        title: "Shared D-Code project",
        description: fallback,
      },
      robots: { index: false, follow: false },
    };
  }

  const description =
    meta.description?.trim() ||
    "A D-Code project shared from DashyCore — open the link to browse the code.";
  return {
    title: `${meta.title} · D-Code shared project`,
    description,
    openGraph: {
      title: meta.title,
      description,
      type: "article",
      siteName: "DashyCore",
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: {
      card: "summary",
      title: meta.title,
      description,
    },
    ...(canonical ? { alternates: { canonical } } : {}),
  };
}

export default async function DCodeSharePage({
  params,
}: {
  params: Promise<{ share_slug: string }>;
}) {
  const { share_slug } = await params;
  return <ShareViewer slug={share_slug} />;
}
