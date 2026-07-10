import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";

export const dynamic = "force-dynamic";

/**
 * Sync a client-side compliance action (suppress / do-not-contact / unsubscribe)
 * into the real, server-enforced suppression_list table that /api/outreach/send
 * and claim_and_record() actually check before a live send.
 *
 * The caller must hold the app-level `compliance` permission. The route then
 * uses the server-only service client for the workspace-scoped write because
 * direct table RLS intentionally keeps the enforcement list admin-managed.
 * This lets an authorized operator honor an opt-out immediately without
 * letting arbitrary browser clients write the shared table.
 */
const SuppressSchema = z.object({
  type: z.enum(["email", "domain", "phone"]).default("email"),
  value: z.string().min(3).max(255),
  reason: z.string().max(200).default(""),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "compliance-suppress"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, SuppressSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { type, reason } = validated.data;
  const rawValue = validated.data.value.trim();
  const value = type === "phone" ? normalizeWhatsAppAddress(rawValue) : rawValue.toLowerCase();
  if (!value) return NextResponse.json({ ok: false, error: "Invalid suppression value." }, { status: 400 });

  // Demo mode: no enforcement backend exists to sync into — the local flag is
  // the only record, same posture as every other real-backend route here.
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, synced: false, detail: "Demo mode: no enforcement backend." });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: true, synced: false, detail: "No Supabase client: not synced." });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "compliance")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "No workspace." }, { status: 403 });
  }

  const serviceSupabase = getServiceSupabase();
  if (!serviceSupabase) {
    return NextResponse.json({ ok: false, error: "Enforcement storage is unavailable." }, { status: 503 });
  }
  const { error } = await serviceSupabase
    .from("suppression_list")
    .upsert(
      { workspace_id: workspaceId, type, value, reason: reason || "Operator action", source: "Operator" },
      { onConflict: "workspace_id,type,value" },
    );

  if (error) {
    safeLog("suppression_list upsert error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Could not update the enforcement list." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, synced: true });
}

/**
 * Reverse a POST above (e.g. the "Undo — restore contact" action) by removing
 * the row from the shared enforcement table, mirroring the POST's auth/RLS
 * posture exactly so a restore is governed by the same admin-only boundary as
 * the original suppress.
 */
export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "compliance-suppress"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, SuppressSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { type } = validated.data;
  const rawValue = validated.data.value.trim();
  const value = type === "phone" ? normalizeWhatsAppAddress(rawValue) : rawValue.toLowerCase();
  if (!value) return NextResponse.json({ ok: false, error: "Invalid suppression value." }, { status: 400 });

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, synced: false, detail: "Demo mode: no enforcement backend." });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: true, synced: false, detail: "No Supabase client: not synced." });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "compliance")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "No workspace." }, { status: 403 });
  }

  const serviceSupabase = getServiceSupabase();
  if (!serviceSupabase) {
    return NextResponse.json({ ok: false, error: "Enforcement storage is unavailable." }, { status: 503 });
  }
  const { error } = await serviceSupabase
    .from("suppression_list")
    .delete()
    .match({ workspace_id: workspaceId, type, value });

  if (error) {
    safeLog("suppression_list delete error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Could not update the enforcement list." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, synced: true });
}
