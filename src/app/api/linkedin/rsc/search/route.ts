import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { sourceWithOptionalRsc } from "@/lib/linkedin-rsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SearchSchema = z.object({
  query: z.string().trim().min(1).max(256),
  count: z.number().int().min(1).max(20).default(5),
});

/**
 * Workspace sourcing, plus official Recruiter System Connect when the server
 * env is valid. A missing or refused LinkedIn config still returns workspace
 * candidates. The token is not read from the body and is not returned.
 */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-rsc-search"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, SearchSchema, { maxBytes: 8_000 });
  if (!validated.ok) return validated.response;

  const result = await sourceWithOptionalRsc({
    query: validated.data.query,
    count: validated.data.count ?? 5,
    env: process.env,
  });
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
