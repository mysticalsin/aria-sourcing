/* ============================================================================
   Server side of the Odoo integration: route authentication, the workspace's
   Odoo connection, and the link tables. Service-role client only; every query
   is scoped to the authenticated user's workspace.
   ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/api/same-origin-json";
import { decryptSecret } from "@/lib/crypto-secrets";
import { safeLog } from "@/lib/log-redact";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can, type Permission } from "@/lib/rbac";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";
import { createOdooClient, isOdooError, type FetchLike, type OdooClient } from "./client";
import { HandoffCandidateSchema, StageMapSchema, type HandoffCandidate, type StageMap } from "./mapping";

export type Svc = NonNullable<ReturnType<typeof getServiceSupabase>>;

export interface OdooUserContext {
  svc: Svc;
  userId: string;
  userEmail: string;
  workspaceId: string;
  role: Role;
}

export function odooJson(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * A signed-in ARIA user holding `permission`, with the service client.
 * `mutation`: the request changes something (here or in Odoo), so it must come
 * from a page of this app (Origin = the host the browser addressed).
 */
export async function requireOdooUser(
  req: NextRequest,
  options: { permission: Permission; mutation?: boolean },
): Promise<{ ok: true; ctx: OdooUserContext } | { ok: false; response: Response }> {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false, response: prodBlock };
  if (options.mutation && !isSameOriginRequest(req)) {
    return { ok: false, response: odooJson(403, { ok: false, error: "Cross-origin request refused." }) };
  }
  if (!supabaseEnabled) {
    return { ok: false, response: odooJson(503, { ok: false, error: "The Odoo integration needs a live workspace (Supabase backend)." }) };
  }
  const supabase = await getServerSupabase();
  if (!supabase) return { ok: false, response: odooJson(503, { ok: false, error: "Authentication unavailable." }) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: odooJson(401, { ok: false, error: "Not authenticated." }) };

  const rl = checkRateLimit(rateLimitKey(req, "odoo", user.id), { windowMs: 60_000, max: 60 });
  if (!rl.ok) {
    const res = odooJson(429, { ok: false, error: "Too many Odoo requests. Try again in a minute." });
    res.headers.set("Retry-After", String(Math.max(1, Math.ceil(rl.retryAfterSec))));
    return { ok: false, response: res };
  }

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, options.permission)) {
    return { ok: false, response: odooJson(403, { ok: false, error: "Insufficient permissions." }) };
  }
  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (typeof workspaceId !== "string" || !workspaceId) {
    return { ok: false, response: odooJson(400, { ok: false, error: "Workspace not found." }) };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, response: odooJson(503, { ok: false, error: "Service client unavailable." }) };
  return { ok: true, ctx: { svc, userId: user.id, userEmail: user.email ?? "", workspaceId, role: role as Role } };
}

/** Odoo failures as a route answer: the code and Odoo's one-line message,
 *  never its traceback. 502 = Odoo said no / failed; 504 = no answer. */
export function odooFailure(error: unknown, context: string): NextResponse {
  if (isOdooError(error)) {
    safeLog(`Odoo ${context} failed`, { code: error.code, status: error.status, odoo: error.odooName });
    const status = error.code === "timeout" || error.code === "unreachable" ? 504 : error.code === "invalid_config" ? 400 : 502;
    return odooJson(status, { ok: false, error: error.message, code: error.code });
  }
  safeLog(`Odoo ${context} failed`, { message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
  return odooJson(500, { ok: false, error: `Odoo ${context} failed.` });
}

// ── Connection ───────────────────────────────────────────────────────────────

export interface ConnectionRow {
  workspace_id: string;
  base_url: string;
  public_url: string | null;
  database_name: string;
  api_key_secret: string;
  api_key_last4: string;
  odoo_version: string | null;
  odoo_user_name: string | null;
  stage_map: unknown;
  config_revision: number;
  updated_at: string;
  last_checked_at: string | null;
  last_error: string | null;
}

const CONNECTION_COLUMNS =
  "workspace_id, base_url, public_url, database_name, api_key_secret, api_key_last4, odoo_version, odoo_user_name, stage_map, config_revision, updated_at, last_checked_at, last_error";

export async function readConnection(svc: Svc, workspaceId: string): Promise<ConnectionRow | null> {
  const { data, error } = await svc.from("odoo_connections").select(CONNECTION_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error("odoo_connections read failed");
  return (data as ConnectionRow | null) ?? null;
}

export function connectionStageMap(row: Pick<ConnectionRow, "stage_map">): StageMap {
  const parsed = StageMapSchema.safeParse(row.stage_map);
  return parsed.success ? parsed.data : {};
}

/** What any workspace member may see about the connection (never the key). */
export function publicConnection(row: ConnectionRow | null) {
  if (!row) return { configured: false as const };
  return {
    configured: true as const,
    baseUrl: row.base_url,
    publicUrl: row.public_url ?? row.base_url,
    database: row.database_name,
    keyLast4: row.api_key_last4,
    version: row.odoo_version,
    userName: row.odoo_user_name,
    stageMap: connectionStageMap(row),
    configRevision: row.config_revision,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}

export type ResolvedOdoo =
  | { ok: true; client: OdooClient; connection: ConnectionRow; publicUrl: string; stageMap: StageMap }
  | { ok: false; response: NextResponse };

/** The workspace's Odoo client, or a 409 telling the user to connect Odoo. */
export async function resolveOdoo(ctx: OdooUserContext, fetchImpl?: FetchLike): Promise<ResolvedOdoo> {
  const connection = await readConnection(ctx.svc, ctx.workspaceId);
  if (!connection) {
    return { ok: false, response: odooJson(409, { ok: false, error: "Odoo is not connected. An admin connects it in Settings > Odoo.", code: "not_configured" }) };
  }
  const apiKey = decryptSecret(connection.api_key_secret);
  if (!apiKey) {
    return { ok: false, response: odooJson(409, { ok: false, error: "The stored Odoo API key cannot be read. An admin enters it again in Settings > Odoo.", code: "credential_unavailable" }) };
  }
  try {
    const client = createOdooClient({ baseUrl: connection.base_url, database: connection.database_name, apiKey }, { fetchImpl });
    return { ok: true, client, connection, publicUrl: connection.public_url ?? connection.base_url, stageMap: connectionStageMap(connection) };
  } catch (error) {
    return { ok: false, response: odooFailure(error, "connection") };
  }
}

export async function recordConnectionCheck(svc: Svc, workspaceId: string, error: string | null): Promise<void> {
  await svc
    .from("odoo_connections")
    .update({ last_checked_at: new Date().toISOString(), last_error: error ? error.slice(0, 500) : null })
    .eq("workspace_id", workspaceId);
}

// ── Campaign <-> job ─────────────────────────────────────────────────────────

export interface JobLinkRow {
  campaign_id: string;
  job_id: number;
  job_name: string | null;
  linked_at: string;
}

const JOB_LINK_COLUMNS = "campaign_id, job_id, job_name, linked_at";

export async function listJobLinks(svc: Svc, workspaceId: string): Promise<JobLinkRow[]> {
  const { data, error } = await svc.from("odoo_job_links").select(JOB_LINK_COLUMNS).eq("workspace_id", workspaceId).limit(2000);
  if (error) throw new Error("odoo_job_links read failed");
  return (data as JobLinkRow[] | null) ?? [];
}

export async function jobLinkFor(svc: Svc, workspaceId: string, campaignId: string): Promise<JobLinkRow | null> {
  const { data, error } = await svc
    .from("odoo_job_links")
    .select(JOB_LINK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error) throw new Error("odoo_job_links read failed");
  return (data as JobLinkRow | null) ?? null;
}

export async function upsertJobLink(svc: Svc, ctx: OdooUserContext, campaignId: string, jobId: number, jobName: string): Promise<void> {
  const { error } = await svc.from("odoo_job_links").upsert(
    {
      workspace_id: ctx.workspaceId,
      campaign_id: campaignId,
      job_id: jobId,
      job_name: jobName.slice(0, 300),
      linked_by: ctx.userId,
      linked_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,campaign_id" },
  );
  if (error) throw new Error("odoo_job_links upsert failed");
}

export async function deleteJobLink(svc: Svc, workspaceId: string, campaignId: string): Promise<void> {
  const { error } = await svc.from("odoo_job_links").delete().eq("workspace_id", workspaceId).eq("campaign_id", campaignId);
  if (error) throw new Error("odoo_job_links delete failed");
}

// ── Candidate <-> applicant ──────────────────────────────────────────────────

export interface ApplicantLinkRow {
  candidate_id: string;
  campaign_id: string;
  job_id: number;
  state: "pending" | "linked";
  applicant_id: number | null;
  odoo_stage: string | null;
  odoo_status: string | null;
  claimed_at: string;
  linked_at: string | null;
  synced_at: string | null;
}

const APPLICANT_LINK_COLUMNS =
  "candidate_id, campaign_id, job_id, state, applicant_id, odoo_stage, odoo_status, claimed_at, linked_at, synced_at";

/** A pending claim older than this is from a request that died mid-way. */
export const STALE_CLAIM_MS = 2 * 60 * 1000;

export async function applicantLinkFor(svc: Svc, workspaceId: string, candidateId: string): Promise<ApplicantLinkRow | null> {
  const { data, error } = await svc
    .from("odoo_applicant_links")
    .select(APPLICANT_LINK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (error) throw new Error("odoo_applicant_links read failed");
  return (data as ApplicantLinkRow | null) ?? null;
}

export async function listApplicantLinks(svc: Svc, workspaceId: string, campaignId?: string): Promise<ApplicantLinkRow[]> {
  let query = svc.from("odoo_applicant_links").select(APPLICANT_LINK_COLUMNS).eq("workspace_id", workspaceId);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  const { data, error } = await query.limit(2000);
  if (error) throw new Error("odoo_applicant_links read failed");
  return (data as ApplicantLinkRow[] | null) ?? [];
}

/** Claim the hand-off of one candidate. True when this request owns it now;
 *  false when another request (or an earlier one) already holds the row. */
export async function claimApplicantLink(
  svc: Svc,
  ctx: OdooUserContext,
  input: { candidateId: string; campaignId: string; jobId: number },
): Promise<boolean> {
  const { data, error } = await svc
    .from("odoo_applicant_links")
    .upsert(
      {
        workspace_id: ctx.workspaceId,
        candidate_id: input.candidateId,
        campaign_id: input.campaignId,
        job_id: input.jobId,
        state: "pending",
        claimed_at: new Date().toISOString(),
        linked_by: ctx.userId,
      },
      { onConflict: "workspace_id,candidate_id", ignoreDuplicates: true },
    )
    .select("candidate_id");
  if (error) throw new Error("odoo_applicant_links claim failed");
  return Array.isArray(data) && data.length === 1;
}

/** Take over a stale pending claim (its request died). Compare-and-set on the
 *  old claimed_at, so two retries cannot both take it. */
export async function reclaimStaleApplicantLink(
  svc: Svc,
  ctx: OdooUserContext,
  row: ApplicantLinkRow,
  target: { campaignId: string; jobId: number },
): Promise<boolean> {
  const { data, error } = await svc
    .from("odoo_applicant_links")
    .update({ claimed_at: new Date().toISOString(), linked_by: ctx.userId, campaign_id: target.campaignId, job_id: target.jobId })
    .eq("workspace_id", ctx.workspaceId)
    .eq("candidate_id", row.candidate_id)
    .eq("state", "pending")
    .eq("claimed_at", row.claimed_at)
    .select("candidate_id");
  if (error) throw new Error("odoo_applicant_links reclaim failed");
  return Array.isArray(data) && data.length === 1;
}

export async function completeApplicantLink(
  svc: Svc,
  workspaceId: string,
  candidateId: string,
  input: { applicantId: number; stage: string | null; status: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await svc
    .from("odoo_applicant_links")
    .update({ state: "linked", applicant_id: input.applicantId, odoo_stage: input.stage, odoo_status: input.status, linked_at: now, synced_at: now })
    .eq("workspace_id", workspaceId)
    .eq("candidate_id", candidateId);
  if (error) throw new Error("odoo_applicant_links complete failed");
}

/** Forget a link whose Odoo applicant was deleted in Odoo, so the candidate
 *  can be handed off again. Bound to that applicant id (compare-and-delete). */
export async function forgetDeletedApplicantLink(svc: Svc, workspaceId: string, candidateId: string, applicantId: number): Promise<void> {
  const { error } = await svc
    .from("odoo_applicant_links")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("candidate_id", candidateId)
    .eq("state", "linked")
    .eq("applicant_id", applicantId);
  if (error) throw new Error("odoo_applicant_links delete failed");
}

/** Drop a pending claim whose Odoo call failed before anything was created. */
export async function releaseApplicantLink(svc: Svc, workspaceId: string, candidateId: string): Promise<void> {
  await svc
    .from("odoo_applicant_links")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("candidate_id", candidateId)
    .eq("state", "pending");
}

export async function recordApplicantSync(
  svc: Svc,
  workspaceId: string,
  candidateId: string,
  input: { stage: string | null; status: string },
): Promise<void> {
  await svc
    .from("odoo_applicant_links")
    .update({ odoo_stage: input.stage, odoo_status: input.status, synced_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("candidate_id", candidateId)
    .eq("state", "linked");
}

/** Forget every link (a different Odoo instance or database was configured,
 *  so the stored Odoo ids no longer mean anything). */
export async function clearLinks(svc: Svc, workspaceId: string): Promise<void> {
  const [jobs, applicants] = await Promise.all([
    svc.from("odoo_job_links").delete().eq("workspace_id", workspaceId),
    svc.from("odoo_applicant_links").delete().eq("workspace_id", workspaceId),
  ]);
  if (jobs.error || applicants.error) throw new Error("odoo links delete failed");
}

// ── Candidate (server copy) ──────────────────────────────────────────────────

export interface CandidateForHandoff {
  candidate: HandoffCandidate;
  campaignTitle: string;
}

/** The candidate from the server's copy of the workspace state. Null when it
 *  does not exist; throws when the stored record cannot be read. */
export async function candidateForHandoff(svc: Svc, workspaceId: string, candidateId: string): Promise<CandidateForHandoff | null> {
  const { data, error } = await svc.rpc("odoo_candidate_record", { p_workspace_id: workspaceId, p_candidate_id: candidateId });
  if (error) throw new Error(`candidate read failed (${error.code ?? "?"})`);
  if (!data || typeof data !== "object") return null;
  const record = data as { candidate?: unknown; campaignTitle?: unknown };
  const parsed = HandoffCandidateSchema.safeParse(record.candidate);
  if (!parsed.success) throw new Error("candidate record is malformed");
  return { candidate: parsed.data, campaignTitle: typeof record.campaignTitle === "string" ? record.campaignTitle : "" };
}
