import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { envForHireRequest, runSourcingThroughHired } from "@/lib/hire-connector";

export const runtime = "nodejs";

/**
 * Move one sourced applicant from job opening through hire.
 * Odoo JSON-RPC, SMART, a generic HTTPS API, or an MCP hire tool — whichever
 * is configured. With none configured, LinkedIn sourcing still completes and
 * no upstream request is sent. Demo mode strips connector credentials first.
 */
const HireSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  job: z.object({
    name: z.string().min(1).max(200),
    department: z.string().max(120).optional(),
  }),
  applicant: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(200).optional(),
  }),
  stage: z.string().min(1).max(80),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "hire"), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, HireSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;

  const result = await runSourcingThroughHired(validated.data, envForHireRequest(process.env, supabaseEnabled));
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
