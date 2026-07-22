import { randomUUID, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import {
  handleAutonomousWebSourcingJob,
  resolveAutonomousWebTavilyCredential,
  type AutonomousWebCredentialClient,
  type AutonomousWebRpcClient,
  type FailedAutonomousWebSearch,
  type SuccessfulAutonomousWebSearch,
} from "@/lib/sourcing/autonomous-web-runtime";
import { getServiceSupabase } from "@/lib/supabase/server";
import { executeAuthorizedTavilySearch } from "../../../../../scripts/sourcing-loop-handlers/tavily-discovery.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z
  .object({
    jobId: z.string().uuid(),
    leaseId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    claimToken: z.string().uuid(),
    fenceVersion: z.number().int().positive(),
  })
  .strict();

function validInternalSecret(secret: string): boolean {
  return secret.length >= 32 && secret.length <= 4_096 && !/\s/.test(secret);
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.ARIA_SOURCING_EXECUTION_SECRET ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const parseSecret = process.env.ARIA_REQUISITION_PARSE_SECRET ?? "";
  if (
    !validInternalSecret(secret) ||
    secret === cronSecret ||
    secret === parseSecret
  ) {
    return false;
  }
  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function noStoreJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Internal entry point for one database-authorized autonomous web attempt.
 *
 * The caller may provide only lease locators. It cannot provide an actor,
 * provider, key, query, candidate, receipt, or completion authority. The
 * database supplies and rechecks every authority-bearing value; the secret is
 * resolved only for its exact tenant/version, immediately before the final
 * confirmation fence and single fixed provider request.
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  if (!authorized(req)) return noStoreJson({ ok: false }, 401);
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return noStoreJson(
      {
        ok: false,
        code: "INVALID_REQUEST",
        error: "Expected a JSON request.",
        requestId,
      },
      415,
    );
  }

  const parsed = await validateBody(req, BodySchema, { maxBytes: 2_048 });
  if (!parsed.ok) {
    parsed.response.headers.set("Cache-Control", "no-store");
    parsed.response.headers.set("Pragma", "no-cache");
    parsed.response.headers.set("X-Content-Type-Options", "nosniff");
    return parsed.response;
  }

  const serviceClient = getServiceSupabase();
  if (!serviceClient) {
    return noStoreJson(
      {
        ok: true,
        outcome: { outcome: "unavailable", reason: "service_client_unavailable" },
      },
      503,
    );
  }
  const rpcClient = serviceClient as unknown as AutonomousWebRpcClient;
  const outcome = await handleAutonomousWebSourcingJob(parsed.data, rpcClient, {
    resolveCredential: (client, workspaceId, credentialId, credentialVersion) =>
      resolveAutonomousWebTavilyCredential(
        client as AutonomousWebRpcClient & AutonomousWebCredentialClient,
        workspaceId,
        credentialId,
        credentialVersion,
      ),
    executeSearch: async (options) =>
      await executeAuthorizedTavilySearch(options) as
        | SuccessfulAutonomousWebSearch
        | FailedAutonomousWebSearch,
    fetcher: fetch,
  });
  return noStoreJson(
    { ok: true, outcome },
    outcome.outcome === "unavailable"
      ? 503
      : outcome.outcome === "stale_lease"
        ? 409
        : 200,
  );
}
