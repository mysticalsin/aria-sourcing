import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { ackAgentFrameworkSourcingEffect } from "@/lib/sourcing/learning-authority";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AckSchema = z.object({
  frameworkRunId: z.string().uuid(),
  capabilityToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  resultSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(req: NextRequest) {
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
  const fail = (status: number, code: string) => response({ ok: false, code, requestId }, status);

  if (prodFailClosed() || !supabaseEnabled) return fail(503, "SOURCING_AGENT_UNAVAILABLE");
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") return fail(415, "INVALID_REQUEST");
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) return fail(403, "CROSS_ORIGIN_REQUEST");
  const validated = await validateBody(req, AckSchema, { maxBytes: 1_000 });
  if (!validated.ok) return fail(validated.response.status, "INVALID_REQUEST");

  try {
    const session = await getServerSupabase();
    if (!session) return fail(503, "SOURCING_AGENT_UNAVAILABLE");
    const { data: { user } } = await session.auth.getUser();
    if (!user) return fail(401, "NOT_AUTHENTICATED");
    const [{ data: role }, { data: workspaceId }] = await Promise.all([
      session.rpc("current_profile_role"),
      session.rpc("current_workspace_id"),
    ]);
    if (!can(role as Role, "source")) return fail(403, "INSUFFICIENT_PERMISSIONS");
    if (typeof workspaceId !== "string" || !workspaceId) return fail(403, "WORKSPACE_NOT_FOUND");
    const limit = checkRateLimit(rateLimitKey(req, "sourcing-agent-ack", user.id), {
      windowMs: 60_000,
      max: 20,
    });
    if (!limit.ok) return fail(429, "SOURCING_AGENT_RATE_LIMITED");

    const acknowledged = await ackAgentFrameworkSourcingEffect({
      workspaceId,
      actorId: user.id,
      frameworkRunId: validated.data.frameworkRunId,
      capabilityToken: validated.data.capabilityToken,
      resultSha256: validated.data.resultSha256,
    });
    return acknowledged
      ? response({ ok: true, status: "completed", requestId }, 200)
      : fail(409, "SOURCING_AGENT_PERSISTENCE_UNVERIFIED");
  } catch {
    return fail(503, "SOURCING_AGENT_UNAVAILABLE");
  }
}
