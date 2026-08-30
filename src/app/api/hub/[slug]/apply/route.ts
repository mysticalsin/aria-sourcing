import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import {
  candidateHubSigningReady,
  getHubRole,
  mintHubReportToken,
  scoreHubApplication,
} from "@/lib/candidate-hub";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const AnswerSchema = z
  .object({
    questionId: z.string().trim().min(1).max(64),
    value: z.string().trim().min(1).max(200),
    stars: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const ApplySchema = z
  .object({
    locale: z.enum(["fr", "en", "es"]).default("fr"),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(6).max(32),
    linkedInUrl: z.string().trim().url().max(300).optional(),
    cvFileName: z.string().trim().min(1).max(180).optional(),
    skills: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    answers: z.array(AnswerSchema).min(1).max(20),
  })
  .strict();

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!candidateHubSigningReady()) {
    return NextResponse.json(
      { ok: false, error: "hub_signing_unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ ok: false }, { status: 415, headers: NO_STORE });
  }
  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  }

  const limit = checkRateLimit(rateLimitKey(req, "hub-apply"), { windowMs: 15 * 60_000, max: 8 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { slug } = await ctx.params;
  if (!getHubRole(slug)) {
    return NextResponse.json({ ok: false, error: "hub_not_found" }, { status: 404, headers: NO_STORE });
  }

  const validated = await validateBody(req, ApplySchema, { maxBytes: 24_000 });
  if (!validated.ok) {
    for (const [k, v] of Object.entries(NO_STORE)) validated.response.headers.set(k, v);
    return validated.response;
  }

  const report = scoreHubApplication(slug, {
    ...validated.data,
    locale: validated.data.locale ?? "fr",
  });
  if (!report) {
    return NextResponse.json({ ok: false, error: "invalid_application" }, { status: 400, headers: NO_STORE });
  }
  const token = mintHubReportToken(report);
  if (!token) {
    return NextResponse.json({ ok: false, error: "hub_signing_unavailable" }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      ok: true,
      report,
      token,
      reportUrl: `/hub/report/${encodeURIComponent(token)}`,
      callingExcluded: true,
    },
    { headers: NO_STORE },
  );
}
