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

  // Hash the EXACT content the operator approved; the send route recomputes this
  // and refuses if it differs (the body was changed after approval).
  const bodyHash = approvalHash(subject, body);
  const scopeHash = approvalScopeHash({ candidateId, channel, recipient });
  if (!scopeHash) return NextResponse.json({ ok: false, error: "Invalid approval recipient." }, { status: 400 });

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
