import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { clearProviderProbe } from "@/lib/sourcing/provider-egress";
import { resolveStoredSmartKey, smartForceMock, writebackSmartCandidate } from "@/lib/sourcing/smart";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WritebackSchema = z
  .object({
    smartResumeId: z.string().min(1).max(200),
    ariaCandidateId: z.string().min(1).max(100),
    campaignId: z.string().min(1).max(100),
    campaignTitle: z.string().max(200).optional(),
    status: z.enum(["sourced", "shortlisted", "rejected", "hired"]),
    matchScore: z.number().min(0).max(100).optional(),
    notes: z.string().max(2_000).optional(),
  })
  .strict();

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": randomUUID(),
    },
  });
}

/** Push ARIA candidate refs / shortlist status back to SMART. */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return noStoreJson({ ok: false, error: "Untrusted origin." }, 403);
  }

  if (!supabaseEnabled && !smartForceMock()) {
    return noStoreJson(
      {
        ok: false,
        code: "SMART_AUTHORITY_UNAVAILABLE",
        error: "Live sourcing authority is unavailable.",
      },
      503,
    );
  }

  let apiKey: string | null = process.env.SMART_API_KEY ?? null;
  if (supabaseEnabled) {
    const session = await getServerSupabase();
    if (!session) return noStoreJson({ ok: false, error: "No Supabase client." }, 500);
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return noStoreJson({ ok: false, error: "Unauthorized." }, 401);
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return noStoreJson({ ok: false, error: "Forbidden." }, 403);
    }
    const rl = checkRateLimit(rateLimitKey(req, "source-smart-writeback", user.id), {
      windowMs: 60_000,
      max: 30,
    });
    if (!rl.ok) return noStoreJson({ ok: false, error: "Rate limited." }, 429);
    apiKey = await resolveStoredSmartKey(session);
  }

  const validated = await validateBody(req, WritebackSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;

  const result = await writebackSmartCandidate(
    clearProviderProbe("SMART"),
    validated.data,
    apiKey,
  );

  if (!result.ok) {
    const status = result.status === 503 || result.status === 0 ? 503 : result.status || 502;
    return noStoreJson(
      {
        ok: false,
        code: "SMART_WRITEBACK_FAILED",
        error: result.detail || result.title,
        mode: result.mode,
      },
      status,
    );
  }

  return noStoreJson({
    ok: true,
    mode: result.mode,
    receipt: result.data,
  });
}
