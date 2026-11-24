// POST from Odoo (automation rule "ARIA: applicant changed", docs/odoo.md):
// an applicant handed off by ARIA changed stage, was archived or refused.
// Public route: the secret token in the URL picks the workspace. The body is
// only used for the applicant id; ARIA reads that applicant back from Odoo
// with its own key before changing anything. The answer is the same whether
// or not the token is known, and comes before the work (Odoo waits 1 s).

import { NextResponse, type NextRequest } from "next/server";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { checkRateLimit } from "@/lib/rate-limit";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServiceSupabase } from "@/lib/supabase/server";
import { afterResponse } from "@/lib/integrations/odoo/after-response";
import { connectionByWebhookHash } from "@/lib/integrations/odoo/authority";
import { applicantIdFromPayload, hashWebhookToken, processOdooWebhook, validWebhookToken } from "@/lib/integrations/odoo/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 16_000;

function accepted(): NextResponse {
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) return NextResponse.json({ ok: false }, { status: 503 });
  const { token } = await params;
  if (!validWebhookToken(token)) return accepted();
  const tokenHash = hashWebhookToken(token);
  const limit = checkRateLimit(`odoo-webhook:${tokenHash}`, { windowMs: 60_000, max: 300 });
  if (!limit.ok) return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterSec)) } });

  let raw: string;
  try {
    raw = await readBoundedBody(req, MAX_BODY);
  } catch {
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return accepted();
  }
  const applicantId = applicantIdFromPayload(payload);
  if (!applicantId) return accepted();

  afterResponse(async () => {
    const svc = getServiceSupabase();
    if (!svc) return;
    try {
      const connection = await connectionByWebhookHash(svc, tokenHash);
      if (!connection) return;
      const outcome = await processOdooWebhook(svc, connection, applicantId);
      if (outcome.kind === "synced" && outcome.changes.length > 0) safeLog("Odoo webhook moved candidates", { count: outcome.changes.length });
    } catch (error) {
      safeLog("Odoo webhook failed", { message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    }
  });
  return accepted();
}
