import { NextRequest, NextResponse } from "next/server";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs Rachel
const MAX_TEXT_LENGTH = 5_000;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Proxies text-to-speech to ElevenLabs without ever storing a user's key.
 *
 * A browser can send `x-elevenlabs-api-key` from its local Settings value;
 * deployments may instead set the server-only ELEVENLABS_API_KEY environment
 * variable. The raw upstream audio stream is passed straight through.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("A JSON body with text is required.", 400);
  }

  const payload = body as { text?: unknown; voice_id?: unknown };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const voiceId =
    typeof payload.voice_id === "string" && payload.voice_id.trim()
      ? payload.voice_id.trim()
      : DEFAULT_VOICE_ID;

  if (!text) return error("Text is required.", 400);
  if (text.length > MAX_TEXT_LENGTH) {
    return error(`Text must be ${MAX_TEXT_LENGTH.toLocaleString()} characters or fewer.`, 400);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(voiceId)) {
    return error("The ElevenLabs voice_id is invalid.", 400);
  }

  const apiKey =
    request.headers.get("x-elevenlabs-api-key")?.trim() ||
    process.env.ELEVENLABS_API_KEY?.trim();

  if (!apiKey) {
    return error("ElevenLabs API Key required in Settings", 401);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        cache: "no-store",
      }
    );
  } catch {
    return error("Could not reach ElevenLabs. Please try again.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    // Do not expose upstream response details; they can contain account data.
    if (upstream.status === 401 || upstream.status === 403) {
      return error("ElevenLabs rejected the API key. Update it in Settings.", 401);
    }
    if (upstream.status === 429) {
      return error("ElevenLabs rate limit reached. Please try again shortly.", 429);
    }
    return error("ElevenLabs could not synthesize this audio.", 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, private",
    },
  });
}
