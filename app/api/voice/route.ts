/**
 * DashyCore v7 — /api/voice (optional ElevenLabs upgrade).
 *
 * Contract: this route NEVER fails hard. When no ElevenLabs key is supplied
 * (per-user key from Settings, or an ELEVENLABS_API_KEY env var), or when
 * ElevenLabs itself errors, we answer 200 with
 *
 *   { "engine": "builtin", "reason": "..." }
 *
 * and the client transparently falls back to the embedded browser neural
 * voice engine (see lib/voice-engine.ts). Only a successful upstream call
 * returns binary `audio/mpeg`.
 */

import { NextResponse } from "next/server";

export const runtime = "edge";

const ELEVENLABS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";
const MAX_CHARS = 5000;

interface VoiceRequestBody {
  text?: unknown;
  apiKey?: unknown;
  voiceId?: unknown;
  modelId?: unknown;
}

function builtin(reason: string): NextResponse {
  return NextResponse.json({ engine: "builtin", reason }, { status: 200 });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  let body: VoiceRequestBody = {};
  try {
    body = (await request.json()) as VoiceRequestBody;
  } catch {
    return builtin("invalid-json");
  }

  const text = asString(body.text).slice(0, MAX_CHARS);
  if (!text) return builtin("empty-text");

  const apiKey =
    asString(body.apiKey) || asString(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) return builtin("no-api-key");

  const voiceId = asString(body.voiceId) || DEFAULT_VOICE_ID;
  const modelId = asString(body.modelId) || DEFAULT_MODEL_ID;

  try {
    const upstream = await fetch(
      `${ELEVENLABS_ENDPOINT}/${encodeURIComponent(voiceId)}`,
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
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!upstream.ok || !upstream.body) {
      return builtin(`elevenlabs-${upstream.status}`);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return builtin("elevenlabs-unreachable");
  }
}

/** Capability probe for the UI ("is the paid upgrade configured server-side?"). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    engine: process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "builtin",
    keyRequired: false,
  });
}
