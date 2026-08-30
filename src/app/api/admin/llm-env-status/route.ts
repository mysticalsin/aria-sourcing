import { NextResponse, type NextRequest } from "next/server";

import { probeLlmEnvStatus } from "@/lib/ai/llm-env-status";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only live probe of Fly / process-env LLM keys.
 * Presence on /api/ready (llmKeysPresent) is not the same as usable auth —
 * this endpoint reports llm_auth_ok | llm_auth_dead | llm_keys_absent.
 * Never returns secrets. Aggressive rate limit (upstream /models cost).
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) {
      return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    }
  }
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;

  let actorId = "demo-admin";
  if (session) {
    const { data: auth } = await session.auth.getUser();
    actorId = auth.user?.id ?? "unknown";
  }

  // Live upstream probes — keep this tight (3 / minute / actor).
  const limit = checkRateLimit(rateLimitKey(req, "llm-env-status", actorId), {
    windowMs: 60_000,
    max: 3,
  });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const force = new URL(req.url).searchParams.get("force") === "1";
  const report = await probeLlmEnvStatus({ force });

  return NextResponse.json(
    {
      ok: true,
      ...report,
      // Honesty note for clients — ready.components.llmKeysPresent is presence only.
      note:
        report.status === "llm_auth_dead"
          ? "Env keys are present but auth-dead — rotate via owner LLM dropzone. llmKeysPresent on /api/ready is not live auth."
          : report.status === "llm_keys_absent"
            ? "No preferred Fly env LLM keys set (KIMI/ANTHROPIC/OPENAI/DEEPSEEK)."
            : "At least one preferred Fly env LLM key authenticates.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
