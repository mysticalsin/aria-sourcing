import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

/**
 * Sync a client-side compliance action (suppress / do-not-contact / unsubscribe)
 * into the real, server-enforced suppression_list table that /api/outreach/send
 * and claim_and_record() actually check before a live send.
 *
 * Deliberately uses the CALLER's own session-scoped Supabase client, not the
 * service role. suppression_list's RLS policy is admin-write / member-read-only
 * by design (0005_rls_tenant_isolation.sql) — a member has the app-level
 * "compliance" permission to flag a candidate in their own view, but adding
 * someone to the shared enforcement list is deliberately admin-only. Using the
 * session client lets Postgres RLS be the single source of truth for that
 * boundary instead of re-implementing it here (and risking drift from the DB).
 */
const SuppressSchema = z.object({
  type: z.enum(["email", "domain"]).default("email"),
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
  const value = validated.data.value.trim().toLowerCase();

  // Demo mode: no enforcement backend exists to sync into — the local flag is
  // the only record, same posture as every other real-backend route here.
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, synced: false, detail: "Demo mode — no enforcement backend." });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: true, synced: false, detail: "No Supabase client — not synced." });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "No workspace." }, { status: 403 });
  }

  const { error } = await supabase
    .from("suppression_list")
    .upsert(
      { workspace_id: workspaceId, type, value, reason: reason || "Operator action", source: "Operator" },
      { onConflict: "workspace_id,type,value" },
    );

  if (error) {
    // RLS denies non-admins here by design — that's an expected outcome, not a
    // server fault: the local flag still applies to this operator's own view,
    // it just isn't in the shared enforcement list yet.
    safeLog("suppression_list upsert error", { message: error.message, code: error.code });
    return NextResponse.json({
      ok: true,
      synced: false,
      detail: "Local flag applied. Adding it to the shared enforcement list requires an admin.",
    });
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
  const value = validated.data.value.trim().toLowerCase();

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, synced: false, detail: "Demo mode — no enforcement backend." });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: true, synced: false, detail: "No Supabase client — not synced." });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "No workspace." }, { status: 403 });
  }

  const { error } = await supabase
    .from("suppression_list")
    .delete()
    .match({ workspace_id: workspaceId, type, value });

  if (error) {
    // RLS denies non-admins here by design — same expected outcome as the POST
    // path: the local flag still reflects the operator's own view.
    safeLog("suppression_list delete error", { message: error.message, code: error.code });
    return NextResponse.json({
      ok: true,
      synced: false,
      detail: "Local flag cleared. Removing it from the shared enforcement list requires an admin.",
    });
  }

  return NextResponse.json({ ok: true, synced: true });
}
