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
 * Security: allowlist ONLY image.pollinations.ai (and pollinations.ai).
 * Anything else gets 403 — this is not a general open proxy. It does not
 * reuse or modify anything under app/api/digest.
 */

const ALLOWED_HOSTS = new Set(["image.pollinations.ai", "pollinations.ai"]);
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20 MB safety cap
const UPSTREAM_TIMEOUT_MS = 75_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const reason = error instanceof Error ? error.message : "network error";
    return NextResponse.json(
      { error: `Upstream fetch failed: ${reason}` },
      { status: 502 }
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

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      // Pollinations URLs are content-addressed by prompt+seed — safe to cache.
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
