import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";
import { LAUNCH_PEOPLE_CAP, launchDraftApprovals, type LaunchApprovalRow, type LaunchDraft } from "@/lib/linkedin-campaign";
import { detectInjection, disclosureInternalFromCampaignLike, validateCandidateBoundText } from "@/lib/agent-disclosure-policy";

/**
 * Campaign launch: the ONE human tap that lets Aria send on LinkedIn.
 *
 *   scope "replies"  (0055 launch_linkedin_reply_loop): inbound replies for the
 *                    campaign may be answered automatically.
 *   scope "campaign" (0057 launch_linkedin_campaign): the same, plus one human
 *                    approval row per first-touch draft that was shown in the
 *                    launch sheet. A second POST on a live campaign grant is
 *                    "Add to launch" for people added later.
 *
 * DELETE revokes one grant or every grant in the workspace (the per-campaign
 * kill) and pulls every first-touch draft the launch covered back to draft.
 * GET lists the workspace's grants with the drafts each launch approved.
 * Without a live grant no inbound is ever answered and no launch approval
 * exists, so nothing sends.
 */
const DraftSchema = z.object({
  messageId: z.string().min(1).max(120),
  candidateId: z.string().min(1).max(120),
  profileUrl: z.string().min(1).max(500),
  subject: z.string().max(255).default(""),
  body: z.string().min(1).max(50_000),
});

const LaunchSchema = z.object({
  scope: z.enum(["replies", "campaign"]).default("replies"),
  campaignId: z.string().min(1).max(120),
  vendorCampaignId: z.string().max(200).optional(),
  seatId: z.string().uuid(),
  calendarSeatId: z.string().uuid().optional(),
  interviewerEmail: z.string().email().max(255).optional().or(z.literal("")),
  roleTitle: z.string().max(160).optional(),
  dailyCap: z.number().int().min(0).max(200).default(20),
  quietStart: z.number().int().min(0).max(23).default(21),
  quietEnd: z.number().int().min(0).max(23).default(8),
  timezone: z.string().min(1).max(64).default("UTC"),
  /** The first-touch drafts exactly as the launch sheet showed them. Campaign scope only. */
  drafts: z.array(DraftSchema).max(LAUNCH_PEOPLE_CAP).default([]),
});

const RevokeSchema = z.object({
  grantId: z.string().uuid().optional(),
  reason: z.string().max(200).optional(),
});

const DRY_RUN = { ok: true, status: "dry-run", persisted: false, detail: "Demo: no launch grant recorded, the loop stays off." };

const GRANT_LIST_COLUMNS =
  "id, scope, channel, campaign_id, vendor_campaign_id, seat_id, calendar_seat_id, daily_cap, quiet_start, quiet_end, timezone, granted_at, revoked_at";

async function authorize(perm: "outreach") {
  const supabase = await getServerSupabase();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 }) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 }) };
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, perm)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 }) };
  }
  return { ok: true as const, supabase };
}

function approvalRows(rows: unknown): Record<string, LaunchApprovalRow[]> {
  const byGrant: Record<string, LaunchApprovalRow[]> = {};
  if (!Array.isArray(rows)) return byGrant;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.linkedin_reply_grant_id !== "string" || typeof row.message_id !== "string") continue;
    (byGrant[row.linkedin_reply_grant_id] ??= []).push({
      messageId: row.message_id,
      bodyHash: typeof row.body_hash === "string" ? row.body_hash : "",
      scopeHash: typeof row.approval_scope_hash === "string" ? row.approval_scope_hash : "",
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    });
  }
  return byGrant;
}

export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) return NextResponse.json({ ok: true, grants: [] });
  const auth = await authorize("outreach");
  if (!auth.ok) return auth.response;
  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim() ?? "";
  let query = auth.supabase.from("linkedin_reply_grants").select(GRANT_LIST_COLUMNS);
  if (campaignId) query = query.eq("campaign_id", campaignId.slice(0, 120));
  const { data, error } = await query.order("granted_at", { ascending: false }).limit(100);
  if (error) {
    safeLog("linkedin loop grants list error", { message: error.message });
    return NextResponse.json({ ok: false, error: "Could not read launch grants." }, { status: 500 });
  }
  const grants = (data ?? []) as Record<string, unknown>[];
  const campaignGrantIds = grants.filter((g) => g.scope === "campaign" && typeof g.id === "string").map((g) => g.id as string);
  let drafts: Record<string, LaunchApprovalRow[]> = {};
  if (campaignGrantIds.length > 0) {
    const { data: approvals, error: approvalsError } = await auth.supabase
      .from("outreach_approvals")
      .select("linkedin_reply_grant_id, message_id, body_hash, approval_scope_hash, revoked_at")
      .in("linkedin_reply_grant_id", campaignGrantIds)
      .limit(1000);
    if (approvalsError) {
      safeLog("linkedin launch approvals list error", { message: approvalsError.message });
      return NextResponse.json({ ok: false, error: "Could not read launch approvals." }, { status: 500 });
    }
    drafts = approvalRows(approvals);
  }
  return NextResponse.json({
    ok: true,
    grants: grants.map((g) => ({ ...g, drafts: typeof g.id === "string" ? (drafts[g.id] ?? []) : [] })),
  });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const rl = checkRateLimit(rateLimitKey(req, "linkedin-loop-launch"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, LaunchSchema, { maxBytes: 400_000 });
  if (!validated.ok) return validated.response;
  const d = validated.data;
  const drafts: LaunchDraft[] = (d.drafts ?? []).map((draft) => ({
    messageId: draft.messageId,
    candidateId: draft.candidateId,
    profileUrl: draft.profileUrl,
    subject: draft.subject ?? "",
    body: draft.body,
  }));

  // A campaign launch approves exactly the drafts that were shown. No drafts,
  // no launch: the server refuses before any write, and never fills the gap.
  let approvals: ReturnType<typeof launchDraftApprovals> = null;
  if (d.scope === "campaign") {
    if (drafts.length === 0) {
      return NextResponse.json({ ok: false, error: "no-drafts-shown" }, { status: 400 });
    }
    approvals = launchDraftApprovals(drafts);
    if (!approvals) {
      return NextResponse.json({ ok: false, error: "invalid-draft" }, { status: 400 });
    }
  }
  if (!supabaseEnabled) return NextResponse.json(DRY_RUN);

  const auth = await authorize("outreach");
  if (!auth.ok) return auth.response;

  // Same candidate-bound text gate as /api/outreach/approve: internal role
  // details and injection markers never get a launch approval.
  if (d.scope === "campaign") {
    const { data: wid } = await auth.supabase.rpc("current_workspace_id");
    const { data: workspaceState } = wid
      ? await auth.supabase.from("workspace_state").select("state").eq("workspace_id", wid).maybeSingle()
      : { data: null };
    const state = workspaceState?.state as { campaigns?: unknown } | null | undefined;
    const campaigns = Array.isArray(state?.campaigns) ? (state.campaigns as unknown[]) : [];
    const campaign = campaigns.find((item) => (item as { id?: unknown } | null)?.id === d.campaignId);
    const internal = disclosureInternalFromCampaignLike(campaign);
    for (const draft of drafts) {
      const disclosure = validateCandidateBoundText(draft.body, internal);
      const injection = detectInjection(draft.body);
      if (!disclosure.safe || injection.flagged) {
        return NextResponse.json(
          { ok: false, error: disclosure.reason ?? "injection-suspected", messageId: draft.messageId },
          { status: 422 },
        );
      }
    }
  }
  const { data, error } =
    d.scope === "campaign"
      ? await auth.supabase.rpc("launch_linkedin_campaign", {
          p_campaign_id: d.campaignId,
          p_seat_id: d.seatId,
          p_drafts: approvals ?? [],
          p_calendar_seat_id: d.calendarSeatId ?? null,
          p_interviewer_email: d.interviewerEmail ?? "",
          p_role_title: d.roleTitle ?? "",
          p_daily_cap: d.dailyCap,
          p_quiet_start: d.quietStart,
          p_quiet_end: d.quietEnd,
          p_timezone: d.timezone,
        })
      : await auth.supabase.rpc("launch_linkedin_reply_loop", {
          p_campaign_id: d.campaignId,
          p_vendor_campaign_id: d.vendorCampaignId ?? null,
          p_seat_id: d.seatId,
          p_calendar_seat_id: d.calendarSeatId ?? null,
          p_interviewer_email: d.interviewerEmail ?? "",
          p_role_title: d.roleTitle ?? "",
          p_daily_cap: d.dailyCap,
          p_quiet_start: d.quietStart,
          p_quiet_end: d.quietEnd,
          p_timezone: d.timezone,
        });
  const result = (data ?? null) as { ok?: boolean; reason?: string; grant_id?: string; approved?: number; added?: boolean } | null;
  if (error || result?.ok !== true) {
    safeLog("linkedin loop launch refused", { message: error?.message ?? result?.reason ?? "unknown" });
    const reason = result?.reason ?? "launch-failed";
    const status = reason === "already-launched" ? 409 : reason === "insufficient-permissions" ? 403 : 400;
    return NextResponse.json({ ok: false, error: reason }, { status });
  }
  return NextResponse.json({
    ok: true,
    status: "launched",
    persisted: true,
    scope: d.scope,
    grantId: result.grant_id,
    approved: typeof result.approved === "number" ? result.approved : 0,
    added: result.added === true,
  });
}

export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const rl = checkRateLimit(rateLimitKey(req, "linkedin-loop-revoke"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, RevokeSchema, { maxBytes: 5_000 });
  if (!validated.ok) return validated.response;
  if (!supabaseEnabled) return NextResponse.json(DRY_RUN);

  const auth = await authorize("outreach");
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase.rpc("revoke_linkedin_reply_loop", {
    p_grant_id: validated.data.grantId ?? null,
    p_reason: validated.data.reason ?? null,
  });
  const result = (data ?? null) as { ok?: boolean; reason?: string; revoked?: number; drafts_pulled?: number } | null;
  if (error || result?.ok !== true) {
    safeLog("linkedin loop revoke refused", { message: error?.message ?? result?.reason ?? "unknown" });
    return NextResponse.json({ ok: false, error: result?.reason ?? "revoke-failed" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    status: "revoked",
    persisted: true,
    revoked: result.revoked ?? 0,
    draftsPulled: typeof result.drafts_pulled === "number" ? result.drafts_pulled : 0,
  });
}
