import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { assertPublicUrl } from "@/lib/api/url";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { executeNeedsQuery, type DatabricksRow } from "@/lib/integrations/databricks";
import { parseEmailAndJD, type ParsedIntake } from "@/lib/mock-ai";
import { resolveStoredDatabricksSecret } from "@/lib/sourcing/tavily";
import type { DatabricksSettings, HermesState, Role } from "@/lib/types";

// Auth-gated and host-fetching. Never prerender.
export const dynamic = "force-dynamic";

/**
 * Databricks hiring-needs intake.
 *
 * Private-link and internal Databricks workspaces are out of scope for Wave 2:
 * cfg.host must pass assertPublicUrl before the token endpoint or SQL Statement
 * Execution endpoint is fetched. This route returns proposed ParsedIntake drafts
 * only. It never creates campaigns or writes campaign state.
 */

const NeedsSchema = z.object({
  since: z.string().min(1).max(64).optional(),
});

const DatabricksSettingsSchema = z
  .object({
    host: z.string().url(),
    warehouseId: z.string().min(1),
    authMode: z.enum(["pat", "m2m"]),
    clientId: z.string().optional(),
    apiKeyId: z.string().min(1),
    needsQuery: z.string().min(1).max(20_000),
    sinceColumn: z.string().optional(),
  })
  .refine((cfg) => cfg.authMode === "pat" || !!cfg.clientId?.trim(), {
    message: "clientId is required for Databricks M2M auth.",
    path: ["clientId"],
  });

type ServerSupabase = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

export async function loadDatabricksSettings(session: ServerSupabase): Promise<DatabricksSettings | null> {
  const { data: wid } = await session.rpc("current_workspace_id");
  if (!wid) return null;
  const { data: row } = await session
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", wid)
    .maybeSingle();
  const state = row?.state as HermesState | undefined;
  const parsed = DatabricksSettingsSchema.safeParse(state?.settings?.databricks);
  return parsed.success ? parsed.data : null;
}

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
    fetchImpl?: typeof fetch;
    pollDelayMs?: number;
  } = {},
): Promise<Response> {
  const cfg = await loadDatabricksSettings(session);
  if (!cfg) return NextResponse.json({ ok: false, error: "Databricks intake is not configured." }, { status: 400 });
  if (!cfg.needsQuery.includes(":since")) {
    return NextResponse.json({ ok: false, error: "Databricks needsQuery must use the :since parameter." }, { status: 400 });
  }

  const publicHost = await assertPublicUrl(cfg.host);
  if (!publicHost.ok) {
    return NextResponse.json({ ok: false, error: publicHost.reason ?? "Databricks host is not public." }, { status: 400 });
  }

  const secret = await resolveStoredDatabricksSecret(session, cfg.apiKeyId, opts.serviceClient);
  if (!secret) return NextResponse.json({ ok: false, error: "Databricks API key is not configured." }, { status: 400 });

  const since = input.since ?? "1970-01-01T00:00:00.000Z";
  const result = await executeNeedsQuery(cfg, secret, {
    since,
    fetchImpl: opts.fetchImpl,
    pollDelayMs: opts.pollDelayMs,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ? 502 : 400 });
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
