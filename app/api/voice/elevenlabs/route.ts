import { NextRequest } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * DashyCore — /api/voice/elevenlabs — realistic TTS proxy.
 *
 *   POST { text: string, voiceId?: string, modelId?: string }
 *   → 200 audio/mpeg (raw ElevenLabs byte stream, piped through unbuffered)
 *
 * Upstream: POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
 *
 * Key resolution (first non-empty wins):
 *   1. `x-elevenlabs-key` request header — the user's own key from
 *      Settings → Voice (stored in THEIR browser only; relayed, never kept)
 *   2. process.env.ELEVENLABS_API_KEY — the workspace key
 *
 * Only signed-in users may call this route, so the workspace key can never
 * be burned by anonymous traffic. Errors are JSON `{ error }` with the
 * upstream status mapped to something the chat UI can explain.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
/** ElevenLabs' own docs voice ("George") — override with ELEVENLABS_VOICE_ID. */
const FALLBACK_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
/** Most natural/human model; set ELEVENLABS_MODEL_ID=eleven_flash_v2_5 for lowest latency. */
const FALLBACK_MODEL_ID = "eleven_multilingual_v2";
const ALLOWED_MODELS = new Set([
  "eleven_multilingual_v2",
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
  "eleven_v3",
]);
/** Per-request character ceiling (keeps a single click from draining credits). */
const MAX_TEXT_CHARS = 5000;
const VOICE_ID_RE = /^[A-Za-z0-9]{8,40}$/;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Pulls a readable message out of an ElevenLabs error body. */
async function upstreamMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        detail?: { message?: string; status?: string } | string;
        message?: string;
      };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (parsed.detail?.message) return parsed.detail.message;
      if (parsed.message) return parsed.message;
    } catch {
      // not JSON
    }
    return text.slice(0, 300) || response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // Auth gate — signed-in DashyCore users only.
  try {
    const supabase = await createRouteHandlerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError("Sign in to use the voice engine.", 401);
  } catch {
    return jsonError("Sign in to use the voice engine.", 401);
  }

  let body: { text?: unknown; voiceId?: unknown; modelId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Expected a JSON body: { text, voiceId }.", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError("`text` is required.", 400);
  if (text.length > MAX_TEXT_CHARS) {
    return jsonError(`\`text\` is too long (max ${MAX_TEXT_CHARS} characters).`, 413);
  }

  const requestedVoice = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const voiceId =
    requestedVoice || process.env.ELEVENLABS_VOICE_ID?.trim() || FALLBACK_VOICE_ID;
  if (!VOICE_ID_RE.test(voiceId)) return jsonError("Invalid `voiceId`.", 400);

  const requestedModel = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const envModel = process.env.ELEVENLABS_MODEL_ID?.trim() ?? "";
  const modelId = ALLOWED_MODELS.has(requestedModel)
    ? requestedModel
    : envModel || FALLBACK_MODEL_ID;

  const apiKey =
    request.headers.get("x-elevenlabs-key")?.trim() ||
    process.env.ELEVENLABS_API_KEY?.trim() ||
    "";
  if (!apiKey) {
    return jsonError(
      "No ElevenLabs API key configured. Add one in Settings → Voice, or set ELEVENLABS_API_KEY on the server.",
      412
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
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
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.15,
            use_speaker_boost: true,
          },
        }),
        signal: request.signal,
        cache: "no-store",
      }
    );
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      return jsonError("Request cancelled.", 499);
    }
    return jsonError("Could not reach ElevenLabs. Please try again.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const message = await upstreamMessage(upstream);
    const status =
      upstream.status === 401 || upstream.status === 403
        ? 401
        : upstream.status === 429
        ? 429
        : upstream.status === 422 || upstream.status === 400 || upstream.status === 404
        ? 400
        : 502;
    return jsonError(`ElevenLabs: ${message}`, status);
  }

  // Pipe the raw MP3 stream straight through — the browser starts playback
  // on the first chunks instead of waiting for the whole file.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Voice-Id": voiceId,
      "X-Voice-Model": modelId,
    },
  });
}
