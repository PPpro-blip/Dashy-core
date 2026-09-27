import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface VoiceRequestBody {
  text?: unknown;
  voice?: unknown;
}

/**
 * Keyless neural speech proxy. Audio is normalized to an ArrayBuffer before
 * constructing the web Response, which is supported by the Next.js 15 Edge
 * runtime and avoids Node-only Buffer types leaking into this route.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = (await request.json()) as VoiceRequestBody;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const voice =
      typeof body?.voice === "string" && body.voice.trim()
        ? body.voice.trim()
        : "Brian";

    if (!text || text.length > 5000) {
      return NextResponse.json(
        { error: "Text is required (up to 5000 characters)." },
        { status: 400 }
      );
    }

    const base =
      process.env.DASHY_TTS_URL ||
      "https://api.streamelements.com/kappa/v2/speech";
    const url = new URL(base);
    url.searchParams.set("voice", voice);
    url.searchParams.set("text", text);

    const upstream = await fetch(url, {
      headers: { Accept: "audio/mpeg" },
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Voice service returned ${upstream.status}.` },
        { status: 502 }
      );
    }

    const audio: ArrayBuffer = await upstream.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Voice service is temporarily unavailable." },
      { status: 502 }
    );
  }
}
