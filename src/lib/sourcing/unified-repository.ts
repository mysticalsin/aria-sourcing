import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceSupabase, type getServerSupabase } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import type { HermesState, Role } from "@/lib/types";
import { projectSourcingAgentWorkspace } from "./sourcing-agent-contract";
import { jobStatus, type CampaignSourcingJob, type SourceStep } from "./unified-contract";
import type { UnifiedRunRepository } from "./unified-run";

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;
export function unifiedRepository(session: Session, workspaceId: string, actorId: string, campaignId: string): UnifiedRunRepository {
  const service = getServiceSupabase();
  if (!service) throw new Error("Sourcing authority unavailable.");
  return {
    async readWorkspace() {
      const [{ data: userData }, role, workspace] = await Promise.all([
        session.auth.getUser(), session.rpc("current_profile_role"), session.rpc("current_workspace_id"),
      ]);
      if (userData.user?.id !== actorId || role.error || workspace.error || workspace.data !== workspaceId || !can(role.data as Role, "source")) {
        throw new Error("Sourcing authority changed. Reload your workspace.");
      }
      const { data, error } = await session.from("workspace_state").select("state,updated_at").eq("workspace_id", workspaceId).single();
      if (error || !data?.updated_at || projectSourcingAgentWorkspace(data.state, campaignId).status !== "ok") {
        throw new Error("Campaign authority is unavailable.");
      }
      return { state: data.state as HermesState, updatedAt: data.updated_at as string };
    },
    async claim(job, token, steps) {
      const { data, error } = await service.from("campaign_sourcing_jobs")
        .update({ claim_token: token, claim_until: new Date(Date.now() + 180_000).toISOString(), steps, revision: job.revision + 1 })
        .eq("workspace_id", workspaceId).eq("actor_id", actorId).eq("id", job.id).eq("status", "active").eq("revision", job.revision).select("id");
      if (error) throw new Error("Run claim is unavailable.");
      return data?.length === 1;
    },
    async bind(job, token, steps) {
      const { data, error } = await service.from("campaign_sourcing_jobs").update({ steps })
        .eq("workspace_id", workspaceId).eq("id", job.id).eq("claim_token", token).select("id");
      if (error || data?.length !== 1) throw new Error("Run binding could not be saved. Resume the existing run.");
    },
    async reserve(source, key, campaign) {
      const { data, error } = await service.rpc("begin_provider_run", { p_workspace_id: workspaceId,
        p_provider: source === "LinkedIn" ? "Apify" : "GitHub", p_external_run_id: key, p_campaign_id: campaign });
      if (error || !data?.ok || typeof data.run_id !== "string") throw new Error("Daily provider quota is reached or unavailable.");
      return data.run_id as string;
    },
    async settle(id, succeeded, externalRunId, datasetId) {
      const result = externalRunId
        ? await service.rpc("attach_provider_run", { p_run_id: id, p_external_run_id: externalRunId, p_dataset_id: datasetId })
        : await service.rpc("settle_provider_run", { p_run_id: id, p_succeeded: succeeded });
      if (result.error || result.data?.ok !== true) throw new Error("Provider receipt could not be saved. Resume the existing run.");
    },
    async finish(job, token, steps, workspace, state) {
      const { data, error } = await service.rpc("finish_campaign_sourcing_step", { p_job_id: job.id, p_claim_token: token,
        p_steps: steps, p_status: jobStatus(steps), p_expected_updated_at: workspace.updatedAt, p_state: state ?? null });
      if (data?.reason === "state_conflict") return "conflict";
      if (data?.reason === "erased_candidates" && Array.isArray(data.blocked_ids)) return { blockedIds: data.blocked_ids as string[] };
      if (error || data?.ok !== true) throw new Error("Results could not be committed. Resume the existing run after reviewing the campaign.");
      return "saved";
    },
  };
}

export async function loadUnifiedJob(workspaceId: string, id: string): Promise<CampaignSourcingJob | null> {
  const service = getServiceSupabase();
  if (!service) throw new Error("Sourcing authority unavailable.");
  const { data, error } = await service.from("campaign_sourcing_jobs").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) throw new Error("Sourcing run unavailable.");
  return data as CampaignSourcingJob | null;
}

export async function startUnifiedJob(input: {
  workspaceId: string; actorId: string; campaignId: string; requestKey: string;
  snapshot: Record<string, unknown>; steps: SourceStep[];
}): Promise<CampaignSourcingJob> {
  const service = getServiceSupabase();
  if (!service) throw new Error("Sourcing authority unavailable.");
  // The active unique index also catches concurrent launches with different keys.
  const { data, error } = await service.from("campaign_sourcing_jobs").insert({
    id: randomUUID(), workspace_id: input.workspaceId, actor_id: input.actorId, campaign_id: input.campaignId,
    request_key: input.requestKey, campaign_snapshot: input.snapshot, steps: input.steps,
  }).select("*").single();
  if (!error) return data as CampaignSourcingJob;
  if (error.code !== "23505") throw new Error("Sourcing run could not be created.");
  const replay = await service.from("campaign_sourcing_jobs").select("*").eq("workspace_id", input.workspaceId)
    .eq("actor_id", input.actorId).eq("request_key", input.requestKey).maybeSingle();
  if (replay.data) {
    const job = replay.data as CampaignSourcingJob;
    if (job.campaign_id !== input.campaignId) throw new Error("This launch key belongs to another campaign.");
    return job;
  }
  const active = await service.from("campaign_sourcing_jobs").select("*").eq("workspace_id", input.workspaceId)
    .eq("campaign_id", input.campaignId).eq("status", "active").single();
  if (active.error || !active.data) throw new Error("Sourcing run could not be recovered.");
  return active.data as CampaignSourcingJob;
}
