import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { AGENT_SEAT_SELECT } from "@/lib/fleet-seats";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { INTEGRATION_MODES, SEAT_PROVIDERS, type Role } from "@/lib/types";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

const CreateSeatSchema = z.object({
  name: z.string().min(1).max(120),
  operatorEmail: z.string().email().max(255),
  provider: z.enum(SEAT_PROVIDERS).default("Microsoft Graph"),
  mode: z.enum(INTEGRATION_MODES).default("mock"),
  dailyLimit: z.number().int().min(1).max(500).default(40),
  warmup: z.boolean().default(true),
  warmupStartCap: z.number().int().min(1).max(500).default(10),
  warmupStepPerDay: z.number().int().min(0).max(100).default(4),
  minGapMinutes: z.number().int().min(0).max(1440).default(12),
  persona: z.string().max(2000).default(""),
  signature: z.string().max(2000).default(""),
});

const PatchSeatSchema = z.object({
  id: z.string().uuid(),
  operatorEmail: z.string().email().max(255).optional(),
  mode: z.enum(INTEGRATION_MODES).optional(),
}).refine((value) => value.operatorEmail !== undefined || value.mode !== undefined, {
  message: "Provide operatorEmail or mode.",
});

async function requireFleetManager(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false as const, response: prodBlock };

  if (!supabaseEnabled) return { ok: true as const, supabase: null, workspaceId: "", userId: "demo" };

  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 }),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 }),
    };
  }

  const { data: workspaceId, error: workspaceErr } = await supabase.rpc("ensure_workspace");
  if (workspaceErr || !workspaceId) {
    safeLog("fleet seat ensure_workspace error", { message: workspaceErr?.message, code: workspaceErr?.code });
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Could not resolve workspace." }, { status: 403 }),
    };
  }

  const { data: role, error: roleErr } = await supabase.rpc("current_profile_role");
  if (roleErr || !can(role as Role, "manage_fleet")) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 }),
    };
  }

  return { ok: true as const, supabase, workspaceId: workspaceId as string, userId: user.id };
}

export async function POST(req: NextRequest) {
  const actor = await requireFleetManager(req);
  if (!actor.ok) return actor.response;

  const limit = checkRateLimit(rateLimitKey(req, "fleet-seats-create", actor.userId), { windowMs: 60_000, max: 30 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, CreateSeatSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;
  const seat = validated.data;

  if (!actor.supabase) return NextResponse.json({ ok: true, demo: true });

  const { data, error } = await actor.supabase
    .from("agent_seats")
    .insert({
      workspace_id: actor.workspaceId,
      name: seat.name,
      operator_email: seat.operatorEmail,
      provider: seat.provider,
      mode: seat.mode,
      daily_limit: seat.dailyLimit,
      warmup: seat.warmup,
      warmup_start_cap: seat.warmupStartCap,
      warmup_step_per_day: seat.warmupStepPerDay,
      min_gap_minutes: seat.minGapMinutes,
      persona: seat.persona,
      signature: seat.signature,
    })
    .select(AGENT_SEAT_SELECT)
    .single();

  if (error || !data) {
    safeLog("agent_seats insert error", { message: error?.message, code: error?.code });
    return NextResponse.json({ ok: false, error: "Could not create the fleet seat." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, id: data.id, seat: data });
}

export async function PATCH(req: NextRequest) {
  const actor = await requireFleetManager(req);
  if (!actor.ok) return actor.response;

  const limit = checkRateLimit(rateLimitKey(req, "fleet-seats-update", actor.userId), { windowMs: 60_000, max: 60 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, PatchSeatSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { id, operatorEmail, mode } = validated.data;

  if (!actor.supabase) return NextResponse.json({ ok: true, demo: true });

  const patch: Record<string, string> = {};
  if (operatorEmail !== undefined) patch.operator_email = operatorEmail;
  if (mode !== undefined) patch.mode = mode;

  const { data, error } = await actor.supabase
    .from("agent_seats")
    .update(patch)
    .eq("id", id)
    .select(AGENT_SEAT_SELECT)
    .maybeSingle();

  if (error || !data) {
    safeLog("agent_seats update error", { message: error?.message, code: error?.code });
    return NextResponse.json({ ok: false, error: "Seat not found in your workspace." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, seat: data });
}

export async function DELETE(req: NextRequest) {
  const actor = await requireFleetManager(req);
  if (!actor.ok) return actor.response;

  const limit = checkRateLimit(rateLimitKey(req, "fleet-seats-delete", actor.userId), { windowMs: 60_000, max: 30 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Missing or invalid id." }, { status: 400 });
  }

  if (!actor.supabase) return NextResponse.json({ ok: true, demo: true });

  const { error } = await actor.supabase.from("agent_seats").delete().eq("id", id);
  if (error) {
    safeLog("agent_seats delete error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Could not delete the fleet seat." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
