import { NextResponse, type NextRequest } from "next/server";
import { createRouteHandlerClient, createServiceClient } from "@/lib/supabase/server";
import { safeRasterImage } from "@/lib/dcode/secure-image";

interface OgImageContext {
  params: Promise<{ share_slug: string }>;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=60";

function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function GET(request: NextRequest, context: OgImageContext) {
  const { share_slug } = await context.params;
  const file = request.nextUrl.searchParams.get("file");
  if (!/^[a-z0-9]{12}$/i.test(share_slug) || !file || file.length > 255) return notFound();

  let row: { files?: unknown } | null = null;
  try {
    const supabase = await createRouteHandlerClient();
    const { data } = await supabase
      .from("dcode_projects")
      .select("files")
      .eq("share_slug", share_slug)
      .eq("is_public", true)
      .maybeSingle();
    row = data;
  } catch {
    // Service-role fallback is still explicitly constrained to public rows.
  }
  if (!row) {
    const service = createServiceClient();
    if (service) {
      const { data } = await service
        .from("dcode_projects")
        .select("files")
        .eq("share_slug", share_slug)
        .eq("is_public", true)
        .maybeSingle();
      row = data;
    }
  }
  const files = Array.isArray(row?.files) ? row.files : [];
  const item = files.find((entry): entry is { name: string; content: string } =>
    !!entry && typeof entry === "object" &&
    (entry as { name?: unknown }).name === file &&
    typeof (entry as { content?: unknown }).content === "string"
  );
  if (!item || /\.svg$/i.test(item.name)) return notFound();

  const parsed = safeRasterImage(item.content, item.name);
  if (!parsed || parsed.bytes.length > MAX_IMAGE_BYTES) return notFound();

  return new NextResponse(new Uint8Array(parsed.bytes), {
    headers: {
      "Content-Type": parsed.mime,
      "Content-Length": String(parsed.bytes.length),
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
