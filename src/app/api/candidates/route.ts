import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { candidateFromPayload } from "@/lib/candidate-payload";
import { can } from "@/lib/rbac";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Candidate, Role } from "@/lib/types";

export const runtime = "nodejs";

const QuerySchema = z
  .object({
    campaignId: z.string().min(1).max(200).optional(),
    stage: z.string().min(1).max(100).optional(),
    source: z.string().min(1).max(100).optional(),
    search: z.string().max(200).optional(),
    sort: z.enum(["match", "recent"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function withSensitiveHeaders(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

function unavailable(): NextResponse {
  return noStoreJson(
    { ok: false, code: "CANDIDATES_UNAVAILABLE", error: "Live candidate corpus is unavailable." },
    503,
  );
}

function queryObject(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

type CandidateRow = { total?: unknown; payload?: unknown };

function numericTotal(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return 0;
}

export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return withSensitiveHeaders(prodBlock);

  if (!supabaseEnabled) return unavailable();

  const session = await getServerSupabase();
  if (!session) return unavailable();

  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return noStoreJson({ ok: false, error: "Not authenticated." }, 401);

  const { data: role } = await session.rpc("current_profile_role");
  if (!can(role as Role, "view")) {
    return noStoreJson({ ok: false, error: "Insufficient permissions." }, 403);
  }

  const parsed = QuerySchema.safeParse(queryObject(req));
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "Invalid candidate query." }, 400);
  }

  const { data, error } = await session.rpc("list_workspace_candidates", {
    p_campaign_id: parsed.data.campaignId ?? null,
    p_stage: parsed.data.stage ?? null,
    p_source: parsed.data.source ?? null,
    p_search: parsed.data.search ?? null,
    p_sort: parsed.data.sort ?? "match",
    p_limit: parsed.data.limit ?? 50,
    p_offset: parsed.data.offset ?? 0,
  });
  if (error) {
    return noStoreJson({ ok: false, error: "Candidate corpus query failed." }, 502);
  }

  const rows: CandidateRow[] = Array.isArray(data) ? data : [];
  const total = rows.length > 0 ? numericTotal(rows[0]?.total) : 0;
  const candidates: Candidate[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (row.payload == null) continue;
    const candidate = candidateFromPayload(row.payload);
    if (candidate) candidates.push(candidate);
    else dropped += 1;
  }
  if (dropped > 0) {
    console.warn(`Dropped ${dropped} malformed candidate corpus payload(s).`);
  }

  return noStoreJson({ ok: true, total, candidates });
}
