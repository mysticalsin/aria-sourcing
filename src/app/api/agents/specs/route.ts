import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import {
  SupportedAgentChannelsSchema,
  SupportedAgentGuardrailsSchema,
} from "@/lib/agents/runtime-policy";

export const dynamic = "force-dynamic";

/**
 * Agent spec CRUD — the definitions behind on-demand sourcing agents and the
 * Agent Studio page. Generated replies are queue-only human review: they wait
 * for named-operator approval before any dispatch path can run.
 */

const CreateSpecSchema = z.object({
  name: z.string().min(1).max(120),
  role_brief: z.record(z.string(), z.unknown()),
  channels: SupportedAgentChannelsSchema.default(["Email"]),
  guardrails: SupportedAgentGuardrailsSchema.default({ autopilot: false, canary_remaining: 5 }),
  seat_id: z.string().uuid().optional(),
  flowise_chatflow_id: z.string().max(120).optional(),
});

const UpdateSpecSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  role_brief: z.record(z.string(), z.unknown()).optional(),
  channels: SupportedAgentChannelsSchema.optional(),
  guardrails: SupportedAgentGuardrailsSchema.optional(),
  seat_id: z.string().uuid().nullable().optional(),
  flowise_chatflow_id: z.string().max(120).nullable().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

async function requireOperator(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { response: prodBlock } as const;
  if (!supabaseEnabled) {
    return {
      response: NextResponse.json({ ok: true, demo: true, specs: [] }),
    } as const;
  }
  const supabase = await getServerSupabase();
  if (!supabase) return { response: NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 }) } as const;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 }) } as const;
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "source")) {
    return { response: NextResponse.json({ ok: false, reason: "Insufficient permissions." }, { status: 403 }) } as const;
  }
  const { data: wid } = await supabase.rpc("current_workspace_id");
  return { supabase, user, workspaceId: wid as string } as const;
}

export async function GET(req: NextRequest) {
  const auth = await requireOperator(req);
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.supabase
    .from("agent_specs")
    .select("id, name, role_brief, channels, guardrails, seat_id, flowise_chatflow_id, status, created_at")
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, reason: "Failed to load agents." }, { status: 500 });
  return NextResponse.json({ ok: true, specs: data ?? [] });
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(rateLimitKey(req, "agent-specs"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const auth = await requireOperator(req);
  if ("response" in auth) return auth.response;
  const validated = await validateBody(req, CreateSpecSchema, { maxBytes: 50_000 });
  if (!validated.ok) return validated.response;
  const { data, error } = await auth.supabase
    .from("agent_specs")
    .insert({ ...validated.data, workspace_id: auth.workspaceId, owner_id: auth.user.id })
    .select("id")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ ok: false, reason: "Failed to create agent." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest) {
  const rl = checkRateLimit(rateLimitKey(req, "agent-specs"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const auth = await requireOperator(req);
  if ("response" in auth) return auth.response;
  const validated = await validateBody(req, UpdateSpecSchema, { maxBytes: 50_000 });
  if (!validated.ok) return validated.response;
  const { id, ...updates } = validated.data;
  const { error } = await auth.supabase
    .from("agent_specs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ ok: false, reason: "Failed to update agent." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
