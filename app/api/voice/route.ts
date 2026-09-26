/**
 * DashyCore v7 — /api/voice (optional ElevenLabs upgrade proxy).
 *
 * DashyCore's voice engine is zero-key by default: every reply is spoken
 * with the browser's built-in `SpeechSynthesis` engine, no backend call at
 * all. This route only exists for the OPTIONAL premium upgrade — when a
 * user pastes their own ElevenLabs API key in Settings, the client sends it
 * here (per-request, BYOK — never stored server-side) and we proxy the
 * real text-to-speech call so the browser never has to expose the key to
 * a third-party origin directly.
 *
 * This route is designed to NEVER hard-fail the caller:
 *   - No key provided            → 200 JSON { fallback: "browser" }
 *   - Bad key / quota / network  → 200 JSON { fallback: "browser" }
 *   - Success                    → 200 audio/mpeg stream
 * The client (`lib/voice-engine.ts`) treats any non-audio response as a
 * signal to use the embedded neural voice instead, so users NEVER see a
 * crash or error state from this endpoint.
 */

export const runtime = "edge";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs "Rachel" (public premade voice)
const MAX_CHARS = 2500;

interface VoiceRequestBody {
  text?: unknown;
  apiKey?: unknown;
  voiceId?: unknown;
  modelId?: unknown;
}

function fallbackResponse(reason: string) {
  return Response.json({ fallback: "browser", reason }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  let body: VoiceRequestBody;
  try {
    body = (await request.json()) as VoiceRequestBody;
  } catch {
    return fallbackResponse("Invalid request body");
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHARS) : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  if (!text) {
    return fallbackResponse("Missing text");
  }

  // No personal key configured — this is the expected default path for
  // every user. Tell the client to use the embedded engine; never an error.
  if (!apiKey) {
    return fallbackResponse("No ElevenLabs key configured — using built-in voice");
  }

  const voiceId =
    (typeof body.voiceId === "string" && body.voiceId.trim()) || DEFAULT_VOICE_ID;
  const modelId =
    (typeof body.modelId === "string" && body.modelId.trim()) || "eleven_turbo_v2_5";

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!upstream.ok || !upstream.body) {
      return fallbackResponse(`ElevenLabs responded with ${upstream.status}`);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return fallbackResponse("Could not reach ElevenLabs");
  }
}
