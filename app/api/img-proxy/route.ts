/**
 * DashyCore — image proxy (Studio fallback only).
 *
 * The Studio gallery loads pollinations.ai URLs directly in an <img> tag.
 * This route is ONLY a fallback when the direct load fails (hotlink block,
 * CORS edge, transient upstream error). It streams raw image bytes — never
 * JSON — so the response is consumable as an image source.
 *
 *   GET /api/img-proxy?url=<encoded-image-url>
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response("Missing or invalid url", { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok) {
      return new Response("Upstream image fetch failed", { status: 502 });
    }

    const buffer = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") || "image/jpeg";

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Image proxy failed", { status: 502 });
  }
}
