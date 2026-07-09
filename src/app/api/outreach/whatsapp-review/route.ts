import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { gateOutbound } from "@/lib/gate";
import { isReviewableWhatsAppDraft } from "@/lib/whatsapp-review-policy";

export const dynamic = "force-dynamic";

const ReviewSchema = z.object({
  messageId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

type ReviewRow = {
  id: string;
  candidate_id: string;
  to_address: string;
  subject: string;
  body: string;
  type: string;
  channel: string;
  status: string;
  gate_result: unknown;
  created_at: string;
  review_decision: string | null;
};

async function requireReviewer(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false as const, response: prodBlock };
  if (!supabaseEnabled) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "No enforcement backend configured." }, { status: 503 }),
    };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 503 }),
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
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "outreach")) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 }),
    };
  }
  return { ok: true as const, supabase, userId: user.id };
}

/** Human-review inbox for server-persisted WhatsApp reply drafts. */
export async function GET(req: NextRequest) {
  const reviewer = await requireReviewer(req);
  if (!reviewer.ok) return reviewer.response;

  const rl = checkRateLimit(rateLimitKey(req, "whatsapp-review-read", reviewer.userId), { windowMs: 60_000, max: 120 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const { data, error } = await reviewer.supabase
    .from("messages_outbound")
    .select("id, candidate_id, to_address, subject, body, type, channel, status, gate_result, created_at, review_decision")
    .eq("channel", "WhatsApp")
    .eq("status", "blocked")
    .is("review_decision", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    return NextResponse.json({ ok: false, error: "Could not load WhatsApp review drafts." }, { status: 500 });
  }

  const drafts = ((data ?? []) as ReviewRow[]).filter((row) =>
    isReviewableWhatsAppDraft({
      channel: row.channel,
      status: row.status,
      type: row.type,
      reviewDecision: row.review_decision,
    }),
  );
  return NextResponse.json({ ok: true, drafts });
}

/** Record a named human decision. The SQL RPC locks and atomically queues only
 * the exact stored message that was reviewed. */
export async function POST(req: NextRequest) {
  const reviewer = await requireReviewer(req);
  if (!reviewer.ok) return reviewer.response;

  const rl = checkRateLimit(rateLimitKey(req, "whatsapp-review-write", reviewer.userId), { windowMs: 60_000, max: 60 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, ReviewSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { messageId, action } = validated.data;

  const { data: current, error: currentErr } = await reviewer.supabase
    .from("messages_outbound")
    .select("id, channel, status, type, body, review_decision")
    .eq("id", messageId)
    .maybeSingle();
  if (currentErr) {
    return NextResponse.json({ ok: false, error: "Could not load the WhatsApp draft." }, { status: 500 });
  }
  if (!current || !isReviewableWhatsAppDraft({
    channel: current.channel,
    status: current.status,
    type: current.type,
    reviewDecision: current.review_decision,
  })) {
    return NextResponse.json({ ok: false, error: "This WhatsApp draft is no longer awaiting review." }, { status: 409 });
  }

  if (action === "approve") {
    const gate = gateOutbound(current.body);
    if (!gate.pass) {
      return NextResponse.json(
        { ok: false, error: "This draft still fails the candidate-message safety gate." },
        { status: 422 },
      );
    }
  }

  const { data, error } = await reviewer.supabase.rpc("review_whatsapp_outbound", {
    p_message_id: messageId,
    p_decision: action,
  });
  const result = data as { ok?: boolean; reason?: string; status?: string } | null;
  if (error || result?.ok !== true) {
    const status = result?.reason === "already-dispatching" || result?.reason === "not-reviewable" ? 409 : 500;
    return NextResponse.json({ ok: false, error: "Could not record the WhatsApp review decision." }, { status });
  }
  return NextResponse.json({ ok: true, status: result.status ?? (action === "approve" ? "queued" : "rejected") });
}
