import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { readCurrentReadiness } from "@/lib/server/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limit = checkRateLimit(rateLimitKey(req, "ready"), { windowMs: 60_000, max: 20 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);
  const result = await readCurrentReadiness();
  return NextResponse.json(result ?? { ok: false, status: "not_ready" }, {
    status: result?.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}