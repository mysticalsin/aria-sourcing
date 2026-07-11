import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { classifyFetchHost } from "@/lib/api/url";
import { isDatabricksOriginAllowed } from "@/lib/integrations/databricks-origin-policy";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import {
  executeNeedsQuery,
  type DatabricksFetch,
  type DatabricksRow,
} from "@/lib/integrations/databricks";
import { resolveDatabricksAuthority } from "@/lib/integrations/databricks-authority";
import { parseEmailAndJD, type ParsedIntake } from "@/lib/mock-ai";
import type { Role } from "@/lib/types";
import { safeLog } from "@/lib/log-redact";

// Auth-gated and host-fetching. Never prerender.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Databricks hiring-needs intake.
 *
 * Private-link and internal Databricks workspaces are out of scope for Wave 2.
 * The deployment allowlist owns the exact origin and fetchPublicUrl validates
 * and pins every token, statement, and poll request. This route returns proposed
 * ParsedIntake drafts only. It never creates campaigns or writes campaign state.
 */

const NeedsSchema = z
  .object({
    since: z.string().min(1).max(64).optional(),
  })
  .strict();

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

function firstValue(row: DatabricksRow, names: string[]): string {
  const entries = Object.entries(row);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

export function databricksRowToEmailText(row: DatabricksRow): string {
  const title = firstValue(row, ["title", "role_title", "role", "position"]);
  const description = firstValue(row, ["description", "job_description", "jd", "body"]);
  const location = firstValue(row, ["location", "city", "region"]);
  const skills = firstValue(row, ["skills", "required_skills", "skill_set"]);
  const parts = [
    "From: Databricks Hiring Needs <databricks@workspace.local>",
    title ? `Role: ${title}` : "",
    location ? `Location: ${location}` : "",
    skills ? `Skills: ${skills}` : "",
    description ? `Description:\n${description}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

export function rowsToProposals(rows: DatabricksRow[]): ParsedIntake[] {
  const proposals: ParsedIntake[] = [];
  for (const row of rows) {
    const email = databricksRowToEmailText(row);
    if (!email.trim()) continue;
    try {
      proposals.push(parseEmailAndJD({ email }));
    } catch {
      // Malformed Databricks content should not make the whole route fail.
    }
  }
  return proposals;
}

export async function runDatabricksNeedsForWorkspace(
  session: ServerSupabase,
  input: { since?: string },
  opts: {
    serviceClient?: ReturnType<typeof getServiceSupabase>;
    fetchImpl?: DatabricksFetch;
    pollDelayMs?: number;
  } = {},
): Promise<Response> {
  const resolved = await resolveDatabricksAuthority(
    session,
    opts.serviceClient === undefined ? getServiceSupabase() : opts.serviceClient,
  );
  if (!resolved.ok) {
    if (resolved.code === "not_configured") {
      return NextResponse.json({ ok: false, error: "Databricks intake is not configured." }, { status: 400 });
    }
    if (resolved.code === "credential_unavailable") {
      return NextResponse.json({ ok: false, error: "Databricks credential is unavailable." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "Databricks configuration could not be loaded." }, { status: 503 });
  }

  const { config: cfg, secret, authorityScope } = resolved.authority;
  if (!isDatabricksOriginAllowed(cfg.host)) {
    return NextResponse.json({ ok: false, error: "Databricks configuration could not be loaded." }, { status: 503 });
  }
  if (!cfg.needsQuery.includes(":since")) {
    return NextResponse.json({ ok: false, error: "Databricks needsQuery must use the :since parameter." }, { status: 400 });
  }
  if (classifyFetchHost(new URL(cfg.host).hostname) === "blocked") {
    return NextResponse.json({ ok: false, error: "Databricks host is not publicly reachable." }, { status: 400 });
  }

  const since = input.since ?? "1970-01-01T00:00:00.000Z";
  const result = await executeNeedsQuery(cfg, secret, {
    since,
    authorityScope,
    fetchImpl: opts.fetchImpl,
    pollDelayMs: opts.pollDelayMs,
  });
  if (!result.ok) {
    safeLog("Databricks needs execution failed", { status: result.status, state: result.state });
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status || result.state ? 502 : 400 });
  }

  return NextResponse.json({ ok: true, proposals: rowsToProposals(result.rows) });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, error: "Databricks intake requires a live workspace." }, { status: 400 });
  }

  const session = await getServerSupabase();
  if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const { data: role } = await session.rpc("current_profile_role");
  if (!can(role as Role, "source")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const limit = checkRateLimit(rateLimitKey(req, "databricks-needs", user.id), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, NeedsSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;

  return runDatabricksNeedsForWorkspace(session, validated.data);
}
