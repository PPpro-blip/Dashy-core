import { NextRequest } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs Rachel
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const MAX_TEXT_CHARS = 5_000;
const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Real ElevenLabs TTS proxy. It accepts `text` and `voice_id` (Rachel by
 * default), relays a browser-local key only in-memory, then streams raw MP3
 * bytes back to the caller. Keys are never written to Supabase or logs.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: { text?: unknown; voice_id?: unknown; voiceId?: unknown; modelId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("A JSON body with text is required.", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError("Text is required.", 400);
  if (text.length > MAX_TEXT_CHARS) {
    return jsonError(`Text must be ${MAX_TEXT_CHARS.toLocaleString()} characters or fewer.`, 400);
  }

  // Keep voiceId compatibility for an existing caller while preferring the
  // requested snake_case API shape.
  const requestedVoice =
    typeof body.voice_id === "string"
      ? body.voice_id.trim()
      : typeof body.voiceId === "string"
        ? body.voiceId.trim()
        : "";
  const voiceId = requestedVoice || process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  if (!VOICE_ID_RE.test(voiceId)) return jsonError("The ElevenLabs voice_id is invalid.", 400);

  const personalKey =
    request.headers.get("x-elevenlabs-api-key")?.trim() ||
    request.headers.get("x-elevenlabs-key")?.trim();
  const workspaceKey = process.env.ELEVENLABS_API_KEY?.trim();
  const apiKey = personalKey || workspaceKey;
  if (!apiKey) return jsonError("ElevenLabs API Key required in Settings", 401);

  // A workspace-owned key must never be exposed as a public TTS relay. A
  // personal request key may be relayed without persistence; normal callers
  // are still the authenticated Voice/Chat UI.
  if (!personalKey) {
    try {
      const supabase = await createRouteHandlerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return jsonError("Sign in to use the voice engine.", 401);
    } catch {
      return jsonError("Sign in to use the voice engine.", 401);
    }
  }

  const requestedModel = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const modelId = requestedModel || process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
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
        signal: request.signal,
        cache: "no-store",
      }
    );
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return jsonError("Request cancelled.", 499);
    return jsonError("Could not reach ElevenLabs. Please try again.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    if (upstream.status === 401 || upstream.status === 403) {
      return jsonError("ElevenLabs rejected the API key. Update it in Settings.", 401);
    }
    if (upstream.status === 429) return jsonError("ElevenLabs rate limit reached. Please try again shortly.", 429);
    return jsonError("ElevenLabs could not synthesize this audio.", 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
