import { NextRequest } from "next/server";

export const runtime = "edge";

/**
 * Keyless neural-ish speech proxy. The browser never talks to a third-party
 * TTS host, and no provider key is exposed to users. A self-hosted endpoint
 * can be selected with DASHY_TTS_URL; the public fallback is StreamElements'
 * no-key speech service.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { text?: unknown; voice?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const voice = typeof body.voice === "string" && body.voice.trim()
      ? body.voice.trim()
      : "Brian";
    if (!text || text.length > 5000) {
      return Response.json({ error: "Text is required (up to 5000 characters)." }, { status: 400 });
    }

    const base = process.env.DASHY_TTS_URL || "https://api.streamelements.com/kappa/v2/speech";
    const url = new URL(base);
    url.searchParams.set("voice", voice);
    url.searchParams.set("text", text);
    const upstream = await fetch(url, { headers: { Accept: "audio/mpeg" }, cache: "no-store" });
    if (!upstream.ok) {
      return Response.json({ error: `Voice service returned ${upstream.status}.` }, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Voice service is temporarily unavailable." }, { status: 502 });
  }
}
