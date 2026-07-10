import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { startAccountMapping, resolveStoredSillageKey } from "@/lib/sourcing/sillage";

/**
 * Real candidate sourcing via Sillage Account Mapping — kicks off the async
 * enrichment job for one company. Poll /api/source/sillage/status for the
 * result. Mirrors the auth/rate-limit gating in /api/source/route.ts; the
 * Sillage key is read server-side from the caller's workspace (never accepted
 * from the client body, never returned).
 */
const SillageStartSchema = z
  .object({
    campaignId: z.string().min(1).max(80).optional(),
    domain: z.string().min(1).max(253).optional(),
    linkedinUrl: z.string().url().max(500).optional(),
    linkedinHandle: z.string().min(1).max(200).optional(),
  })
  .refine((d) => [d.domain, d.linkedinUrl, d.linkedinHandle].filter(Boolean).length === 1, {
    message: "Provide exactly one of domain, linkedinUrl, or linkedinHandle.",
    path: ["domain"],
  });

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-sillage-start"), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, SillageStartSchema, { maxBytes: 4_000 });
  if (!validated.ok) return validated.response;
  const { domain, linkedinUrl, linkedinHandle } = validated.data;

  // A stored key only exists once a real backend is configured (demo mode never
  // persists secrets — saveApiKey discards the value after computing last4).
  const apiKey = session ? await resolveStoredSillageKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Connect a Sillage key in Settings first." });
  }

  const result = await startAccountMapping(apiKey, { domain, linkedinUrl, linkedinHandle });
  if (!result.ok) {
    // Passes through Sillage's real status (402 no credits, 403 feature gated, 409
    // ambiguous domain, ...) so the client sees the honest cause; a network-level
    // failure (status 0) reports as 502, matching /api/source's upstream-error convention.
    return NextResponse.json(
      { ok: false, status: result.status, error: result.detail || result.title },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json({ ok: true, requestId: result.data.requestId, stage: result.data.stage });
}
