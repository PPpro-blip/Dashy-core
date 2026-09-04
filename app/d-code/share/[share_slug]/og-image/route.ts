import { NextResponse, type NextRequest } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * DashyCore v7 — /d-code/share/[share_slug]/og-image?file=<name>
 *
 * Serves a single image from a public D-Code project as raw image bytes so
 * it can be used as an Open Graph image (og:image) for link previews.
 *
 * WHY THIS EXISTS: project images are stored inline as Base64 data URLs
 * inside the project row's jsonb `files` array. Facebook (and other crawlers)
 * only read a URL for og:image, never inline data — so we expose the image
 * through a crawlable route. Lookup is by share_slug + is_public = true only,
 * so private projects can never be reached here.
 *
 * The `file` param is matched against the project's file name (URL-decoded),
 * so it's safe from path traversal — we never touch the filesystem.
 */

interface OgImageContext {
  params: Promise<{ share_slug: string }>;
}

const MAX_IMAGE_BYTES = 1024 * 1024 * 2; // guard against absurd payloads

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!/^data:image\//i.test(meta)) return null;
  const mime = meta.replace(/^data:image\//i, "image/").split(";")[0];
  try {
    return { mime, bytes: Buffer.from(payload, "base64") };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: OgImageContext) {
  const { share_slug } = await context.params;
  const file = request.nextUrl.searchParams.get("file");
  if (!share_slug || !file) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const supabase = await createRouteHandlerClient();
  const { data } = await supabase
    .from("dcode_projects")
    .select("files")
    .eq("share_slug", share_slug)
    .eq("is_public", true)
    .maybeSingle();

  const files = Array.isArray(data?.files) ? (data.files as unknown[]) : [];
  const match = files.find(
    (item): item is { name: string; content: string } =>
      !!item &&
      typeof item === "object" &&
      (item as { name?: unknown }).name === file &&
      typeof (item as { content?: unknown }).content === "string"
  );
  if (!match) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const content = match.content;
  const cacheControl = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=60";

  // SVG is stored as plain text in D-Code.
  if (/\.svg$/i.test(match.name)) {
    const svg =
      content.startsWith("data:image/svg") && content.includes(",")
        ? Buffer.from(content.slice(content.indexOf(",") + 1), "base64").toString(
            "utf-8"
          )
        : content;
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": cacheControl,
      },
    });
  }

  if (content.startsWith("data:")) {
    const decoded = decodeDataUrl(content);
    if (decoded && decoded.bytes.length <= MAX_IMAGE_BYTES) {
      return new NextResponse(new Uint8Array(decoded.bytes), {
        headers: {
          "Content-Type": decoded.mime,
          "Cache-Control": cacheControl,
        },
      });
    }
  }

  return new NextResponse("Not Found", { status: 404 });
}
