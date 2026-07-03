import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

/**
 * Server-side ElevenLabs TTS proxy for the "Hey Aria" voice.
 *
 * The browser never talks to ElevenLabs directly and never sees the API
 * key — it only calls this same-origin route (see the `speak()` upgrade in
 * src/lib/voice/aria-voice.ts). `ELEVENLABS_API_KEY` is read server-side
 * only, is never logged, and is never present in any response body.
 *
 * Fallback contract with the client: any non-200 response (204 no key, 429
 * rate-limited, 502 upstream/network failure) is a clean signal to fall back
 * to the browser's own `window.speechSynthesis` voice — never an error the
 * caller needs to surface.
 *
 * Runtime: Node (not Edge) — this proxies a binary `audio/mpeg` body through
 * from ElevenLabs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounds cost/abuse from a single utterance; Aria's spoken summaries are short. */
const MAX_TEXT_LENGTH = 300;

/** ElevenLabs default voice ("Sarah" — mature, reassuring, confident; fits the Aria persona). Used when ELEVENLABS_VOICE_ID isn't set. */
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

const UPSTREAM_TIMEOUT_MS = 15_000;

const TtsSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  voiceId: z.string().trim().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    // Not configured: clean, error-free signal for the client to use browser TTS.
    return new NextResponse(null, { status: 204 });
  }

  // Throttle: each request drives a paid TTS call — cost/abuse-prone.
  const limit = checkRateLimit(rateLimitKey(req, "voice-tts"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, TtsSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const { text, voiceId } = validated.data;

  const resolvedVoiceId = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.4, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );

    if (!upstream.ok || !upstream.body) {
      // Never forward upstream error detail — it could echo the request text.
      return NextResponse.json({ ok: false, error: "tts_upstream_error" }, { status: 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    // Network error, timeout, etc — never throw, never log the key or the text.
    return NextResponse.json({ ok: false, error: "tts_request_failed" }, { status: 502 });
  }
}
