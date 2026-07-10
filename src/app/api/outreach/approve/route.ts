import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { approvalHash, approvalScopeHash } from "@/lib/outreach-content";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { detectInjection, disclosureInternalFromCampaignLike, validateCandidateBoundText } from "@/lib/agent-disclosure-policy";

/**
 * Record a human approval for a SPECIFIC outbound message.
 *
 * The send route (/api/outreach/send) refuses to send a message that has no
 * matching approval row (by message_id + a sha256 of its exact subject+body), so
 * the "human approval required / never auto-send" guarantee is enforced
 * server-side — not just in browser state. Re-approving the same message_id with
 * different content updates the recorded hash (re-review required after an edit).
 */
const ApproveSchema = z.object({
  messageId: z.string().min(1).max(120),
  candidateId: z.string().min(1).max(120),
  channel: z.enum(["Email", "LinkedIn", "WhatsApp", "SMS"]),
  recipient: z.string().min(1).max(255),
  subject: z.string().min(1).max(255),
  body: z.string().min(1).max(50_000),
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayRecord(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => record(item) !== null) : [];
}

export async function POST(req: NextRequest) {
  // Fail closed in production when the enforcement backend is absent.
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, error: "No backend configured." }, { status: 503 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "outreach-approve"), { windowMs: 60_000, max: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "outreach")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const validated = await validateBody(req, ApproveSchema, { maxBytes: 100_000 });
  if (!validated.ok) return validated.response;
  const { messageId, candidateId, channel, recipient, subject, body } = validated.data;

  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });

  const { data: workspaceState } = await supabase
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", wid)
    .maybeSingle();
  const state = record(workspaceState?.state);
  const outreach = arrayRecord(state?.outreach);
  const candidates = arrayRecord(state?.candidates);
  const campaigns = arrayRecord(state?.campaigns);
  const message = outreach.find((item) => item.id === messageId);
  const candidate = candidates.find((item) => item.id === candidateId);
  const campaignId = typeof message?.campaignId === "string"
    ? message.campaignId
    : typeof candidate?.campaignId === "string"
      ? candidate.campaignId
      : "";
  const campaign = campaigns.find((item) => item.id === campaignId);

  // Hash the EXACT content the operator approved; the send route recomputes this
  // and refuses if it differs (the body was changed after approval).
  const bodyHash = approvalHash(subject, body);
  const scopeHash = approvalScopeHash({ candidateId, channel, recipient });
  if (!scopeHash) return NextResponse.json({ ok: false, error: "Invalid approval recipient." }, { status: 400 });
  const disclosure = validateCandidateBoundText(body, disclosureInternalFromCampaignLike(campaign));
  const injection = detectInjection(body);
  if (!disclosure.safe || injection.flagged) {
    return NextResponse.json(
      { ok: false, error: disclosure.reason ?? "injection-suspected" },
      { status: 422 },
    );
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", persisted: false, detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  const { data: recorded, error } = await supabase.rpc("record_outreach_approval", {
    p_message_id: messageId,
    p_body_hash: bodyHash,
    p_approval_scope_hash: scopeHash,
  });
  const result = recorded as { ok?: boolean; reason?: string } | null;
  if (error || result?.ok !== true) {
    if (result?.reason === "already-dispatching") {
      return NextResponse.json({ ok: false, error: "This message has already entered delivery." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "Failed to record approval." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
