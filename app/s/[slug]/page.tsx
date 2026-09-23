import { redirect } from "next/navigation";

/**
 * DashyCore v7 — /s/[slug] (clean public short link).
 *
 * One-tap Share flows copy this short URL. It redirects to the canonical
 * /d-code/share/[slug] viewer, preserving the query string so OG-decorated
 * links (?title=&desc=&img=&v=) still drive crawler previews, and ?open=1
 * still auto-opens the Share Hub after the redirect.
 */

interface ShortSharePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ShortSharePage({
  params,
  searchParams,
}: ShortSharePageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined) qs.append(key, v);
      }
    } else if (value !== undefined) {
      qs.set(key, value);
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  redirect(`/d-code/share/${encodeURIComponent(slug)}${suffix}`);
}
