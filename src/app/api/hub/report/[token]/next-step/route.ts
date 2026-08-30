import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import {
  applyNextStepToReport,
  candidateHubSigningReady,
  mintHubReportToken,
  verifyHubReportToken,
} from "@/lib/candidate-hub";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const NextStepSchema = z
  .object({
    day: z.string().trim().min(1).max(40),
    time: z.string().trim().min(1).max(40),
    note: z.string().trim().max(280).optional(),
  })
  .strict();

type Ctx = { params: Promise<{ token: string }> };

/** Candidate self-initiates the next interview step (no phone calling). */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!candidateHubSigningReady()) {
    return NextResponse.json({ ok: false, error: "hub_signing_unavailable" }, { status: 503, headers: NO_STORE });
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ ok: false }, { status: 415, headers: NO_STORE });
  }
  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  }

  const limit = checkRateLimit(rateLimitKey(req, "hub-next-step"), { windowMs: 15 * 60_000, max: 12 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { token } = await ctx.params;
  const existing = verifyHubReportToken(decodeURIComponent(token));
  if (!existing) {
    return NextResponse.json({ ok: false, error: "report_not_found" }, { status: 404, headers: NO_STORE });
  }

  const validated = await validateBody(req, NextStepSchema, { maxBytes: 4_096 });
  if (!validated.ok) {
    for (const [k, v] of Object.entries(NO_STORE)) validated.response.headers.set(k, v);
    return validated.response;
  }

  const updated = applyNextStepToReport(existing, validated.data);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "next_step_locked", detail: "Compatibility score too low to self-initiate next step." },
      { status: 409, headers: NO_STORE },
    );
  }
  const nextToken = mintHubReportToken(updated);
  if (!nextToken) {
    return NextResponse.json({ ok: false, error: "hub_signing_unavailable" }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      ok: true,
      report: updated,
      token: nextToken,
      reportUrl: `/hub/report/${encodeURIComponent(nextToken)}`,
      callingExcluded: true,
    },
    { headers: NO_STORE },
  );
}
