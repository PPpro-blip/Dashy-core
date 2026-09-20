/**
 * DashyCore — /s/[slug] short share link.
 *
 * Public (see PUBLIC_PREFIXES in lib/supabase/middleware.ts): anonymous
 * visitors are never bounced to /login. Redirects to the canonical
 * read-only viewer at /d-code/share/<slug>, which handles the
 * private/missing states itself.
 *
 * A RELATIVE Location header is used deliberately — behind the preview
 * proxy the server's own host/port differ from what the browser sees, so
 * an absolute URL would point at the wrong origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const safeSlug = /^[a-z0-9-]{1,64}$/i.test(slug) ? slug : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: safeSlug ? `/d-code/share/${safeSlug}` : "/",
    },
  });
}
