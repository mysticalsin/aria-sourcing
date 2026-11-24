import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { hireFromSourcingScreen, SOURCING_SCREENS } from "@/lib/sourcing-screen-hire";

export const runtime = "nodejs";

/**
 * Hire one candidate from a sourcing screen. With no live connector, fixture
 * env runs SMART, the generic HTTPS API, and MCP on in-process stubs, and the
 * unset case stays skipped. A complete runtime connector uses the same public
 * HTTPS path as POST /api/hire. This route does not call LinkedIn.
 */
const SourcingHireSchema = z.object({
  screen: z.enum(SOURCING_SCREENS),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
  job: z.object({
    name: z.string().min(1).max(200),
    department: z.string().max(120).optional(),
  }),
  applicant: z.object({
    name: z.string().min(1).max(200),
    email: z.string().max(200).optional(),
  }),
  stage: z.string().min(1).max(80),
});

function publicDemoHireDenied(req: NextRequest): Response | null {
  if (supabaseEnabled || !demoLoginEnabled) return null;
  if (demoAuthConfigured() && verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value)) return null;
  return NextResponse.json({ ok: false, error: "Sign in to hire." }, { status: 401 });
}

function liveOriginDenied(req: NextRequest): Response | null {
  if (!supabaseEnabled) return null;
  const origin = req.headers.get("origin");
  if (origin === req.nextUrl.origin) return null;
  return NextResponse.json(
    { ok: false, code: "CROSS_ORIGIN_REQUEST", error: "Cross-origin hire is not allowed." },
    { status: 403 },
  );
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const demoBlock = publicDemoHireDenied(req);
  if (demoBlock) return demoBlock;
  const originBlock = liveOriginDenied(req);
  if (originBlock) return originBlock;

  const rl = checkRateLimit(rateLimitKey(req, "hire-sourcing"), { windowMs: 60_000, max: 10 });
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

  const validated = await validateBody(req, SourcingHireSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;

  const result = await hireFromSourcingScreen(validated.data);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
