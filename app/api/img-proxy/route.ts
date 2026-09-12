import { NextRequest, NextResponse } from "next/server";

/**
 * DashyCore v7 — same-origin image proxy for the Pollinations image engine.
 *
 * Why it exists: browser Image() loads from image.pollinations.ai can fail
 * because the anonymous/error responses don't carry CORS headers, the
 * browser's network blocks the host, or an ad-blocker/extension interferes.
 * This route fetches the image server-side and returns the bytes from our
 * own origin, so the Studio can always render a successfully generated image.
 *
 * Hardening (mission spec):
 *  - STRICT 15s server-side timeout — a hung upstream never stalls the
 *    browser past the generation deadline.
 *  - The returned body is verified as a real raster image (magic-byte
 *    header sniff) before it is handed back, so HTML/JSON error pages can
 *    never be mistaken for pixels.
 *
 * Security: allowlist ONLY image.pollinations.ai (and pollinations.ai).
 * Anything else gets 403 — this is not a general open proxy. It does not
 * reuse or modify anything under app/api/digest.
 */

const ALLOWED_HOSTS = new Set(["image.pollinations.ai", "pollinations.ai"]);
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20 MB safety cap
/** Strict upstream deadline — matches the engine's per-attempt budget. */
const UPSTREAM_TIMEOUT_MS = 15_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Sniffs common raster magic bytes. Returns a mime type, or null if unknown. */
function sniffImageFormat(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: GIF87a / GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  // BMP: BM
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...Array.from(bytes.slice(start, start + len)));
  // WebP: RIFF .... WEBP
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    return "image/webp";
  }
  // AVIF/HEIF: ISO-BMFF container (....ftyp box)
  if (ascii(4, 4) === "ftyp") {
    return "image/avif";
  }
  return null;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url parameter." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url parameter." }, { status: 400 });
  }

  if (
    target.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(target.hostname) ||
    (target.port !== "" && target.port !== "443")
  ) {
    return NextResponse.json(
      { error: "Host is not allowed by the image proxy." },
      { status: 403 }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "DashyCore/7 img-proxy",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? `Upstream fetch timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s.`
          : `Upstream fetch failed: ${
              error instanceof Error ? error.message : "network error"
            }`,
      },
      { status: timedOut ? 504 : 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream responded ${upstream.status}.` },
      { status: 502 }
    );
  }

  const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    // Pollinations error pages are HTML/JSON — treat as a failed generation.
    return NextResponse.json(
      { error: "Upstream did not return an image.", contentType },
      { status: 502 }
    );
  }

  const contentLengthHeader = upstream.headers.get("content-length");
  if (
    contentLengthHeader &&
    Number(contentLengthHeader) > MAX_RESPONSE_BYTES
  ) {
    return NextResponse.json(
      { error: "Upstream image is too large." },
      { status: 502 }
    );
  }

  const body = new Uint8Array(await upstream.arrayBuffer());
  if (body.byteLength === 0) {
    return NextResponse.json({ error: "Upstream returned an empty body." }, { status: 502 });
  }
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    return NextResponse.json({ error: "Upstream image is too large." }, { status: 502 });
  }

  // Header verification: raster types must carry real image magic bytes so
  // a mislabelled error page can never pass as a generated image.
  // (SVG is text-based and exempt — it has no binary magic header.)
  const sniffed = sniffImageFormat(body);
  const isSvg = contentType.startsWith("image/svg");
  if (!isSvg && sniffed === null) {
    return NextResponse.json(
      {
        error:
          "Upstream body failed image header verification (not a valid raster image).",
        contentType,
      },
      { status: 502 }
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": sniffed ?? contentType,
      "Content-Length": String(body.byteLength),
      // Pollinations URLs are content-addressed by prompt+seed — safe to cache.
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
