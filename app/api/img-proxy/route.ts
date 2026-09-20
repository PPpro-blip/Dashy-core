import { NextResponse } from "next/server";

/**
 * DashyCore — "never-fail" image proxy (server-side first).
 *
 * Browsers often abandon slow `<img>` loads, so Studio and the chat <IMG>
 * engine point their `src` at this route instead of pollinations.ai
 * directly. The server waits up to 45s for the upstream render, then
 * streams the finished bytes back with an image Content-Type — the
 * browser sees one fast, complete download.
 *
 * Query params:
 *   prompt  (required)  the image prompt, up to 2000 chars
 *   seed    (optional)  integer; random when omitted
 *   width   (optional)  256–2048, default 1024
 *   height  (optional)  256–2048, default 1024
 *   turbo   (optional)  "false" = default flux model, anything else = turbo
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
const UPSTREAM_TIMEOUT_MS = 45_000;
const MAX_PROMPT_CHARS = 2000;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const prompt = (searchParams.get("prompt") ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Missing required query param: prompt." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).` },
      { status: 400 }
    );
  }

  const seed = clampInt(searchParams.get("seed"), Math.floor(Math.random() * 1_000_000), 0, 999_999_999);
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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        "User-Agent": "DashyCore-Studio/1.0 (+image-proxy)",
        Accept: "image/*",
      },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "The image engine timed out after 45 seconds. Try again — renders are often faster on retry." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "The image engine is unreachable right now. Try again in a moment." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `The image engine returned HTTP ${upstream.status}. Try again in a moment.` },
      { status: 502 }
    );
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength === 0) {
    return NextResponse.json(
      { error: "The image engine returned an empty response. Try again." },
      { status: 502 }
    );
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
