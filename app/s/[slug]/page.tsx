/**
 * DashyCore v7 — /s/[slug] public Studio share page.
 *
 * Server component so social crawlers (X, WhatsApp, Meta/Facebook) get real
 * OpenGraph tags for the preview card. Falls back to a client-side
 * localStorage lookup (see SharedAssetView) when the row isn't in Supabase
 * yet — sharing never breaks even if `shared_assets` isn't migrated.
 */

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getSharedAsset } from "@/lib/share";
import { SharedAssetView } from "@/components/SharedAssetView";

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadAsset(slug: string) {
  try {
    const supabase = await createClient();
    return await getSharedAsset(slug, supabase);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const asset = await loadAsset(slug);

  if (!asset) {
    return {
      title: "Shared image · DashyCore",
      description: "View AI-generated art shared from Dashy Studio.",
    };
  }

  return {
    title: `${asset.title} · Dashy Studio`,
    description: "AI-generated art created and shared with Dashy Studio.",
    openGraph: {
      title: asset.title,
      description: "AI-generated art created and shared with Dashy Studio.",
      images: [{ url: asset.imageUrl }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: asset.title,
      images: [asset.imageUrl],
    },
  };
}

export default async function SharedStudioAssetPage({ params }: PageProps) {
  const { slug } = await params;
  const asset = await loadAsset(slug);

  return <SharedAssetView slug={slug} initialAsset={asset} />;
}
