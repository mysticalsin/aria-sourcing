import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseEmailAndJD, isMantuNeedEmail } from "@/lib/mock-ai";
import { parseInboundNeedLive } from "@/lib/requisition-intake-live";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

const IntakeSchema = z.object({
  email: z.string().max(20_000).optional(),
  jd: z.string().max(20_000).optional(),
  from: z.string().max(500).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().max(20_000).optional(),
});

/**
 * Intake API / email-scan endpoint.
 *
 * An inbound email integration (Microsoft Graph subscription, a forwarding rule,
 * n8n, Zapier, …) POSTs a received job-description email here and gets back a
 * structured JobAnalysis + suggested hiring-manager meta. The client then creates
 * the campaign (human-in-the-loop) — parsing never auto-sends or auto-contacts.
 *
 * Body (either shape):
 *   { "email": "<raw email text>", "jd": "<optional JD text>" }
 *   { "from": "...", "subject": "...", "body": "<email body>" }
 *
 * Auth: required when Supabase is configured; open in demo mode (heuristic parse
 * only — no data access). Production tenants fail closed with 503 llm_required
 * when no live LLM is configured, matching the autonomous parse cron contract.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: "POST { email, jd? } or { from, subject, body } to parse a JD email into a structured JobAnalysis.",
  });
}

export async function POST(req: NextRequest) {
  // Fail closed in production: middleware does not run on /api/*, so refuse here
  // rather than fall back to open demo mode when Supabase is unconfigured in prod.
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: gate before parsing or returning anything when a real backend
  // exists. Demo mode is open (pure text parsing of caller-supplied input).
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (!data?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }
  }

  // Throttle: parsing runs an LLM-style extraction — cost/abuse-prone. Tight limit.
  const limit = checkRateLimit(rateLimitKey(req, "intake"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, IntakeSchema, { maxBytes: 64_000 });
  if (!validated.ok) return validated.response;
  const payload = validated.data;

  // Accept {email,jd} or {from,subject,body}
  const email =
    payload.email && payload.email.trim()
      ? payload.email
      : [payload.from ? `From: ${payload.from}` : "", payload.subject ? `Subject: ${payload.subject}` : "", payload.body ?? ""]
          .filter(Boolean)
          .join("\n");
  const jd = payload.jd;

  if (!email.trim()) {
    return NextResponse.json({ ok: false, error: "Provide `email` (or `from`/`subject`/`body`)." }, { status: 400 });
  }

  const intakeText = jd?.trim() ? `${email}\n\n---\n\n${jd.trim()}` : email;

  // Production tenants must not silently accept heuristic stand-ins — same contract
  // as /api/cron/parse-inbound-need. Demo mode (no Supabase) keeps the open heuristic.
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    // Public demo must not touch service-role vault; skip workspaceId so
    // serverGenerateText stays env-only on demo paths.
    const skipVault = demoLoginEnabled || publicDemoSideEffectsDisabled();
    const { data: wid } = skipVault
      ? { data: null }
      : ((await supabase?.rpc("current_workspace_id")) ?? { data: null });
    const result = await parseInboundNeedLive(intakeText, {
      workspaceId: typeof wid === "string" ? wid : undefined,
    });
    if (!result.modelUsed) {
      return NextResponse.json(
        {
          ok: false,
          status: "llm_required",
          detail: "Live LLM parse required for production intake.",
          modelUsed: false,
          modelReason: "modelReason" in result ? result.modelReason : undefined,
        },
        { status: 503 },
      );
    }
    const parsed = result.parsed;
    return NextResponse.json({
      ok: true,
      format: isMantuNeedEmail(intakeText) ? "mantu-need" : "generic",
      parsed,
      modelUsed: true,
      modelProvider: "modelProvider" in result ? result.modelProvider : undefined,
      suggestedMeta: {
        hiringManager: parsed.sender.name,
        hiringManagerEmail: parsed.sender.email,
      },
    });
  }

  const parsed = parseEmailAndJD({ email, jd });
  return NextResponse.json({
    ok: true,
    format: isMantuNeedEmail(email) ? "mantu-need" : "generic",
    parsed,
    suggestedMeta: {
      hiringManager: parsed.sender.name,
      hiringManagerEmail: parsed.sender.email,
    },
  });
}
