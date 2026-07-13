import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { searchApolloPeople, resolveStoredApolloKey, type ApolloPerson } from "@/lib/sourcing/apollo";
import { registerApolloEnrichmentTargets } from "@/lib/sourcing/source-authority";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

const ApolloSearchSchema = z
  .object({
    campaignId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    titles: z.array(z.string().min(1).max(120)).max(20).optional(),
    seniorities: z.array(z.string().min(1).max(60)).max(10).optional(),
    locations: z.array(z.string().min(1).max(120)).max(20).optional(),
    organizationDomains: z.array(z.string().min(1).max(200)).max(20).optional(),
    keywords: z.string().max(300).optional(),
    count: z.number().int().min(1).max(50).default(10),
  })
  .strict();

function safeLinkedInProfileUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
      url.pathname.startsWith("/in/")
    );
  } catch {
    return false;
  }
}

const ApolloProviderPersonSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    title: z.string().trim().max(200),
    company: z.string().trim().max(200),
    linkedinUrl: z.string().trim().max(500).refine(safeLinkedInProfileUrl),
    city: z.string().trim().max(120),
    state: z.string().trim().max(120),
    country: z.string().trim().max(120),
    headline: z.string().trim().max(500),
    seniority: z.string().trim().max(80),
    departments: z.array(z.string().trim().min(1).max(120)).max(20),
  })
  .strict();

function requestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
}

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

function errorResponse(
  req: NextRequest,
  status: number,
  code: string,
  error: string,
  correlationId = requestId(req),
): NextResponse {
  return noStoreJson({ ok: false, code, error, requestId: correlationId }, status);
}

async function handlePost(req: NextRequest, correlationId: string) {
  const prodBlock = prodFailClosed();
  const fail = (status: number, code: string, error: string) =>
    errorResponse(req, status, code, error, correlationId);
  if (prodBlock) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin sourcing is not allowed.");
  }
  if (!supabaseEnabled) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }

  const session = await getServerSupabase();
  if (!session) {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");
  const [{ data: role }, { data: workspaceId }] = await Promise.all([
    session.rpc("current_profile_role"),
    session.rpc("current_workspace_id"),
  ]);
  if (!can(role as Role, "source")) {
    return fail(403, "INSUFFICIENT_PERMISSIONS", "Source permission is required.");
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    return fail(400, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }

  const rl = checkRateLimit(rateLimitKey(req, "source-apollo", user.id), { windowMs: 60_000, max: 10 });
  if (!rl.ok) {
    const response = fail(429, "APOLLO_SEARCH_RATE_LIMITED", "Apollo search rate limit reached.");
    response.headers.set("Retry-After", String(rl.retryAfterSec));
    return response;
  }

  const validated = await validateBody(req, ApolloSearchSchema, { maxBytes: 10_000 });
  if (!validated.ok) {
    return fail(validated.response.status, "INVALID_REQUEST", "Invalid Apollo search request.");
  }
  const { campaignId, titles, seniorities, locations, organizationDomains, keywords, count = 10 } = validated.data;

  const apiKey = await resolveStoredApolloKey(session);
  if (!apiKey) {
    return noStoreJson({
      ok: true,
      source: "not_configured",
      profiles: [],
      code: "APOLLO_NOT_CONFIGURED",
      error: "Apollo is not configured.",
    });
  }

  let rawPeople: ApolloPerson[];
  try {
    rawPeople = await searchApolloPeople(
      { titles, seniorities, locations, organizationDomains, keywords },
      count,
      apiKey,
    );
  } catch {
    return fail(502, "APOLLO_PROVIDER_UNAVAILABLE", "Apollo search is unavailable.");
  }
  const parsed = z.array(ApolloProviderPersonSchema).max(50).safeParse(rawPeople);
  if (!parsed.success) {
    return fail(502, "APOLLO_PROVIDER_INVALID_RESPONSE", "Apollo returned an invalid response.");
  }
  const people = parsed.data as ApolloPerson[];
  try {
    const profiles = await registerApolloEnrichmentTargets(
      { workspaceId, userId: user.id, campaignId },
      people,
    );
    if (!profiles) {
      return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Could not register enrichment authority.");
    }
    return noStoreJson({ ok: true, source: "apollo", profiles });
  } catch {
    return fail(503, "APOLLO_AUTHORITY_UNAVAILABLE", "Could not register enrichment authority.");
  }
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    return await handlePost(req, correlationId);
  } catch {
    return errorResponse(
      req,
      503,
      "APOLLO_AUTHORITY_UNAVAILABLE",
      "Live sourcing authority is unavailable.",
      correlationId,
    );
  }
}
