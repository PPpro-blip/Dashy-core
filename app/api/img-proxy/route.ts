import { NextRequest } from "next/server";

/**
 * DashyCore — image proxy (Studio fallback only).
 *
 * The Studio gallery loads provider URLs directly in an <img> tag.
 * This route is ONLY a fallback when the direct load fails (hotlink block,
 * CORS edge, transient upstream error). It streams raw image bytes — never
 * JSON — so the response is consumable as an image source.
 *
 *   GET /api/img-proxy?url=<encoded-image-url>
 */
export async function GET(request: NextRequest): Promise<Response> {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return new Response("Missing url parameter", { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch (err) {
    console.error("[img-proxy] Invalid image URL provided:", rawUrl, err);
    return new Response("Invalid image URL", { status: 400 });
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
      headers: {
        Accept: "image/jpeg, image/png, image/webp, image/*, */*",
        "User-Agent": "DashyCore-ImgProxy/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[img-proxy] Provider failed with status ${response.status} (${response.statusText}) for URL: ${url.toString()}`
      );
      return new Response("Upstream image fetch failed", { status: 502 });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";

    const headers: Record<string, string> = {
      // Image bytes for a deterministic (seeded) generation URL are
      // immutable — cache for a year at the edge AND in the browser so
      // Media Library tiles never re-hit the provider.
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    return new Response(buffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error(`[img-proxy] Error fetching image URL: ${url.toString()}`, error);
    return new Response("Image proxy failed", { status: 502 });
  }
}
