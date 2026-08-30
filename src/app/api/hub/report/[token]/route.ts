import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { verifyHubReportToken } from "@/lib/candidate-hub";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const limit = checkRateLimit(rateLimitKey(req, "hub-report"), { windowMs: 60_000, max: 60 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const { token } = await ctx.params;
  const report = verifyHubReportToken(decodeURIComponent(token));
  if (!report) {
    return NextResponse.json({ ok: false, error: "report_not_found" }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, report, callingExcluded: true }, { headers: NO_STORE });
}
