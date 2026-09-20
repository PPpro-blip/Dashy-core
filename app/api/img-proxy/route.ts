import { NextRequest } from "next/server";

/**
 * DashyCore — Bulletproof server-side image generation proxy.
 *
 * The browser NEVER talks to Pollinations directly. The <img> tag on
 * /studio points at THIS route, the Next.js server performs the upstream
 * fetch (with a generous 50s budget for slow diffusion runs), and the raw
 * bytes are streamed back. Because the browser holds a same-origin
 * connection, it keeps waiting patiently with its native loading state —
 * no client fetch/AbortController juggling, no CORS, no 3rd-party
 * flakiness surfacing in the UI.
 *
 * Failure mode: a 302 redirect to a local "Image Generation Failed"
 * placeholder asset, so a broken upstream still renders SOMETHING in the
 * grid instead of a broken-image glyph.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Absolute upper bound for one generation attempt (50 seconds). */
const UPSTREAM_TIMEOUT_MS = 50_000;

/** Local placeholder served (via redirect) when generation fails. */
const FAILURE_ASSET = "/img-gen-failed.svg";

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

/**
 * 302 → local placeholder. A RELATIVE Location header (valid per RFC 7231)
 * is used on purpose: the app runs behind proxies/preview hosts, so an
 * absolute URL built from the bind address would point at the wrong host.
 * The browser resolves it against the page origin — always correct.
 */
function failureRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: FAILURE_ASSET,
      "Cache-Control": "no-cache",
    },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const prompt = (searchParams.get("prompt") ?? "").trim().slice(0, 2000);
  const rawSeed = searchParams.get("seed") ?? "";
  const seed = /^\d{1,12}$/.test(rawSeed)
    ? rawSeed
    : String(Math.floor(Math.random() * 1_000_000));

  if (!prompt) {
    return failureRedirect();
  }

  const upstream = `${POLLINATIONS_BASE}/${encodeURIComponent(
    prompt
  )}?seed=${seed}&nologo=true&model=turbo`;

  try {
    const response = await fetch(upstream, {
      // Hard 50-second budget — diffusion can be slow, but not forever.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        Accept: "image/*",
        "User-Agent": "DashyCore-Studio/1.0 (+server-side-image-proxy)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return failureRedirect();
    }

    const imageBuffer = await response.arrayBuffer();

    // Sanity: an "image" under ~1KB is almost certainly an upstream error
    // page or an empty body — treat it as a failure.
    if (imageBuffer.byteLength < 1024) {
      return failureRedirect();
    }

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    // Timeout, DNS failure, upstream reset — every path lands on the
    // placeholder so the <img> in the grid never "breaks".
    return failureRedirect();
  }
}
