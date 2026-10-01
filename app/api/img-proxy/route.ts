import { NextRequest } from "next/server";

/**
 * DashyCore — image proxy (dual mode).
 *
 * PRIMARY (proxy-first, per the Studio contract): prompt mode. Studio and
 * the chat <IMG> engine point their `<img>` src here so the SERVER waits
 * up to 45s for the upstream pollinations.ai render, then streams the
 * finished bytes back. The browser sees one fast, complete download
 * instead of a slow trickle it might abandon.
 *
 *   GET /api/img-proxy?prompt=...&seed=...&width=...&height=...&turbo=...
 *
 * FALLBACK: url mode. Streams raw bytes for an explicit provider URL
 * (hotlink-block / CORS-edge fallback for direct loads). Never JSON —
 * always consumable as an image source.
 *
 *   GET /api/img-proxy?url=<encoded-image-url>
 *
 * Pollinations has no `turbo` query param — `turbo=true` maps to its fast
 * `turbo` model, otherwise the default `flux` model is used.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel / Next function ceiling — comfortably above the 45s upstream wait.
export const maxDuration = 60;

// Overridable for local tests (IMG_PROXY_UPSTREAM=http://127.0.0.1:PORT)
// — production always uses pollinations.ai.
const UPSTREAM_ORIGIN =
  process.env.IMG_PROXY_UPSTREAM ?? "https://image.pollinations.ai";
const PROMPT_MODE_TIMEOUT_MS = 45_000;
const URL_MODE_TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 2000;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Resolves the `seed` param to a Pollinations-safe integer. Numeric seeds
 * pass through (clamped); string seeds (the engine mints
 * `{Date.now()}_{random}`) are hashed deterministically (FNV-1a) so the
 * same seed string always reproduces the same image.
 */
function resolveSeedParam(raw: string | null): number {
  if (raw !== null && raw !== "" && /^[0-9]+$/.test(raw)) {
    return Math.min(999_999_999, Math.max(0, Number.parseInt(raw, 10)));
  }
  if (raw === null || raw === "") {
    return Math.floor(Math.random() * 1_000_000);
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 1_000_000_000;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const prompt = (searchParams.get("prompt") ?? "").trim();

  // Prompt mode takes precedence when a prompt is supplied.
  if (prompt) {
    return handlePromptMode(searchParams, prompt);
  }
  if (searchParams.get("url")) {
    return handleUrlMode(searchParams.get("url") as string);
  }
  return jsonError("Missing required query param: prompt or url.", 400);
}

/* ---------------------------------------------------------------------- */
/* Prompt mode (proxy-first generation)                                    */
/* ---------------------------------------------------------------------- */

async function handlePromptMode(searchParams: URLSearchParams, prompt: string): Promise<Response> {
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonError(`Prompt is too long (max ${MAX_PROMPT_CHARS} characters).`, 400);
  }

  const seed = resolveSeedParam(searchParams.get("seed"));
  const width = clampInt(searchParams.get("width"), 1024, 256, 2048);
  const height = clampInt(searchParams.get("height"), 1024, 256, 2048);
  const turbo = searchParams.get("turbo") !== "false";

  const upstreamUrl =
    `${UPSTREAM_ORIGIN}/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${seed}&nologo=true` +
    `&model=${turbo ? "turbo" : "flux"}&referrer=DashyCore`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      // Server-side wait: a full 45s for the AI render to finish.
      signal: AbortSignal.timeout(PROMPT_MODE_TIMEOUT_MS),
      headers: {
        "User-Agent": "DashyCore-Studio/1.0 (+image-proxy)",
        Accept: "image/*",
      },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return jsonError(
        "The image engine timed out after 45 seconds. Try again — renders are often faster on retry.",
        504
      );
    }
    return jsonError("The image engine is unreachable right now. Try again in a moment.", 502);
  }

  if (!upstream.ok) {
    return jsonError(
      `The image engine returned HTTP ${upstream.status}. Try again in a moment.`,
      502
    );
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength === 0) {
    return jsonError("The image engine returned an empty response. Try again.", 502);
  }

  const upstreamType = upstream.headers.get("content-type") ?? "";
  const contentType = upstreamType.startsWith("image/") ? upstreamType : "image/jpeg";

  // The URL fully determines the bytes (prompt + seed + size + model), so a
  // long immutable cache is safe and makes repeat views instant.
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/* ---------------------------------------------------------------------- */
/* URL mode (explicit-URL fallback streaming)                              */
/* ---------------------------------------------------------------------- */

async function handleUrlMode(rawUrl: string): Promise<Response> {
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
      signal: AbortSignal.timeout(URL_MODE_TIMEOUT_MS),
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
