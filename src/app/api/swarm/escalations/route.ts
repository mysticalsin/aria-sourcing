// /api/swarm/escalations — the durable human inbox (Rock 8).
//
// GET  → list escalations by status (authenticated member RPC).
// POST → answer or dismiss one escalation. Answering is workspace-admin-only,
//        enforced in SQL by answer_swarm_escalation. A greenlight answer marks
//        its assignment dispatchable; needs_input/blocked/stale answers requeue
//        the assignment with the operator's answer carried into the next
//        dispatch envelope. Escalations are rows, not notifications — nothing
//        here is fire-and-forget.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { swarmRequestBoundary } from "@/lib/api/swarm-request-boundary";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "answer" resolves needs_input/blocked/stale/review escalations;
// greenlight escalations take ONLY the explicit decisions "approve" or
// "reject" — a negative reply can never stamp the dispatch gate.
const AnswerSchema = z.object({
  escalationId: z.string().uuid(),
  action: z.enum(["answer", "approve", "reject", "dismiss"]),
  answer: z.string().trim().min(1).max(4000).optional(),
}).strict().refine(
  (value) => !["answer", "reject"].includes(value.action) || value.answer !== undefined,
  { message: "answer text is required for answer and reject" },
);

export async function GET(req: NextRequest) {
  const session = await getServerSupabase();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  // Authenticated-only read: clean 401 for an anonymous caller (not a 502).
  const { data: { user } } = await session.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "swarm-escalations"), { windowMs: 60_000, max: 60 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const statusParam = req.nextUrl.searchParams.get("status") ?? "open";
  if (!["open", "answered", "dismissed"].includes(statusParam)) {
    return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
  }
  const { data, error } = await session.rpc("list_swarm_escalations", {
    p_status: statusParam,
    p_limit: 50,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Escalation read failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, escalations: data ?? [] });
}

export async function POST(req: NextRequest) {
  // Request boundary first — before authentication, parsing or any side effect.
  const boundary = swarmRequestBoundary(req);
  if (boundary) return boundary;
  const session = await getServerSupabase();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "swarm-escalations-write"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const body = await validateBody(req, AnswerSchema, { maxBytes: 16_000 });
  if (!body.ok) return body.response;

  const { data, error } = await session.rpc("answer_swarm_escalation", {
    p_escalation_id: body.data.escalationId,
    p_action: body.data.action,
    p_answer: body.data.answer ?? null,
  });
  if (error) {
    // In-DB admin gate raises 42501 → surface as 403, not a silent 500.
    const forbidden = /administrator|authentication/i.test(error.message ?? "");
    return NextResponse.json(
      { ok: false, error: forbidden ? "Admins only." : "Escalation update failed." },
      { status: forbidden ? 403 : 502 },
    );
  }
  return NextResponse.json({ ok: true, result: data });
}
