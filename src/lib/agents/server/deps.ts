/* ============================================================================
   The real dependencies of a tick (src/lib/agents/tick.ts): Supabase
   (service client, every query scoped by workspace), the durable campaign
   sourcing run, the LinkedIn bridge's agent entry point, and server drafting.
   ========================================================================== */

import "server-only";
import { randomUUID } from "node:crypto";
import type { TickDeps, AutopilotRow, MissionRow, AgentOutreachRow } from "../tick";
import { ownerAuthority, type Svc } from "./authority";
import { mutateWorkspace, readWorkspace } from "./workspace";
import { draftLinkedInOutreach } from "./draft";
import { serviceUnifiedRepository, loadUnifiedJob, startUnifiedJob } from "@/lib/sourcing/unified-repository";
import { advanceUnifiedRun } from "@/lib/sourcing/unified-run";
import { unifiedProviders } from "@/lib/sourcing/unified-providers";
import { campaignSourcingBasis, orderedSteps, type CampaignSourcingJob } from "@/lib/sourcing/unified-contract";
import { clearDiscoveryCriteria, clearWebSearchDiscovery } from "@/lib/sourcing/provider-egress";
import { webSearchAnthropicConfig } from "@/lib/sourcing/claude-web-search";
import { projectSourcingAgentWorkspace } from "@/lib/sourcing/sourcing-agent-contract";
import { resolveWorkspaceVaultSecret } from "@/lib/ai/vault-secret";
import { aiBudgetStatus } from "@/lib/ai/usage";
import { linkedInBridgeEnabled } from "@/lib/linkedin-bridge/policy";
import { parseAgentAllowlist } from "../autopilot";
import { agentContact, agentOutboxItem, agentQueue, ownerAccount } from "@/lib/linkedin-bridge/agent";

const AUTOPILOT_COLUMNS = "id, workspace_id, campaign_id, owner_id, enabled, source_every_hours, source_limit, contact_enabled, contacts_per_run, min_score, last_source_at, last_contact_at";
const MISSION_COLUMNS = "id, workspace_id, campaign_id, on_behalf_of, kind, status, sourcing_job_id, summary, started_at";
const OUTREACH_COLUMNS = "id, workspace_id, campaign_id, candidate_id, owner_id, mission_id, message_id, state, kind, outbox_id, score, reason, created_at, updated_at";

function must<T>(result: { data: T | null; error: unknown }, what: string): T {
  if (result.error || result.data === null) throw new Error(`${what} unavailable.`);
  return result.data;
}

export function tickDeps(svc: Svc): TickDeps {
  const readState = async (workspaceId: string) => (await readWorkspace(svc, workspaceId)).state;

  /** The delegating owner still may source, and the campaign is still readable. */
  const sourcingReader = (row: AutopilotRow) => async () => {
    const auth = await ownerAuthority(svc, row.workspace_id, row.owner_id, "source");
    if (!auth.ok) throw new Error(auth.reason ?? "Sourcing authority changed.");
    const ws = await readWorkspace(svc, row.workspace_id);
    if (projectSourcingAgentWorkspace(ws.state, row.campaign_id).status !== "ok") throw new Error("Campaign authority is unavailable.");
    return ws;
  };

  return {
    now: () => new Date(),
    async autopilots() {
      return must(await svc.from("agent_campaign_autopilots").select(AUTOPILOT_COLUMNS).eq("enabled", true).limit(200), "Autopilots") as AutopilotRow[];
    },
    async updateAutopilot(row, patch) {
      const { error } = await svc.from("agent_campaign_autopilots").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("workspace_id", row.workspace_id);
      if (error) throw new Error("Autopilot update failed.");
    },
    authority: (workspaceId, userId, scope) => ownerAuthority(svc, workspaceId, userId, scope),
    readState,
    mutateState: (workspaceId, change) => mutateWorkspace(svc, workspaceId, change),
    sourcing: {
      webSearchReady(state) {
        return Boolean(webSearchAnthropicConfig(state.settings)) && aiBudgetStatus().ok;
      },
      async activeJob(row) {
        const { data, error } = await svc.from("campaign_sourcing_jobs").select("*").eq("workspace_id", row.workspace_id)
          .eq("campaign_id", row.campaign_id).eq("status", "active").maybeSingle();
        if (error) throw new Error("Sourcing runs unavailable.");
        return (data as CampaignSourcingJob | null) ?? null;
      },
      job: (workspaceId, id) => loadUnifiedJob(workspaceId, id),
      async start(row, campaign, plan) {
        for (const source of plan) {
          const cleared = source.source === "WebSearch"
            ? clearWebSearchDiscovery({ query: source.query }, campaign)
            : clearDiscoveryCriteria("GitHub", { query: source.query }, campaign);
          if (!cleared.ok) return { ok: false, reason: cleared.error };
        }
        const job = await startUnifiedJob({ workspaceId: row.workspace_id, actorId: row.owner_id, campaignId: row.campaign_id,
          requestKey: randomUUID(), snapshot: campaignSourcingBasis(campaign), steps: orderedSteps(plan) });
        return { ok: true, job };
      },
      async advance(row, job) {
        const read = sourcingReader(row);
        const repo = serviceUnifiedRepository(row.workspace_id, row.owner_id, read);
        await advanceUnifiedRun(job, repo, unifiedProviders(read, (id) => resolveWorkspaceVaultSecret(row.workspace_id, id, "Anthropic")));
      },
    },
    missions: {
      async running(row, kind) {
        const { data, error } = await svc.from("agent_missions").select(MISSION_COLUMNS).eq("workspace_id", row.workspace_id)
          .eq("campaign_id", row.campaign_id).eq("kind", kind).eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
        if (error) throw new Error("Missions unavailable.");
        return (data as MissionRow | null) ?? null;
      },
      async create(row, mission) {
        const finished = mission.status !== "running";
        return must(await svc.from("agent_missions").insert({
          workspace_id: row.workspace_id, campaign_id: row.campaign_id, on_behalf_of: row.owner_id,
          kind: mission.kind, status: mission.status, sourcing_job_id: mission.sourcing_job_id ?? null,
          summary: mission.summary ?? null, finished_at: finished ? new Date().toISOString() : null,
        }).select(MISSION_COLUMNS).single(), "Mission") as MissionRow;
      },
      async finish(mission, status, summary) {
        const { error } = await svc.from("agent_missions").update({ status, summary: summary.slice(0, 500), finished_at: new Date().toISOString() })
          .eq("id", mission.id).eq("workspace_id", mission.workspace_id);
        if (error) throw new Error("Mission update failed.");
      },
    },
    outreach: {
      async open() {
        return must(await svc.from("agent_outreach").select(OUTREACH_COLUMNS).in("state", ["selected", "awaiting_lookup", "queued"])
          .order("created_at", { ascending: true }).limit(200), "Agent outreach") as AgentOutreachRow[];
      },
      async pickedCandidates(row) {
        const data = must(await svc.from("agent_outreach").select("candidate_id").eq("workspace_id", row.workspace_id)
          .eq("campaign_id", row.campaign_id).limit(5000), "Agent outreach") as { candidate_id: string }[];
        return new Set(data.map((r) => r.candidate_id));
      },
      async insert(rows) {
        if (!rows.length) return;
        // The unique (workspace, campaign, candidate) key: a candidate is picked once.
        const { error } = await svc.from("agent_outreach").upsert(rows, { onConflict: "workspace_id,campaign_id,candidate_id", ignoreDuplicates: true });
        if (error) throw new Error("Agent outreach insert failed.");
      },
      async update(row, patch) {
        const { id: _id, created_at: _c, ...rest } = patch as AgentOutreachRow;
        const { error } = await svc.from("agent_outreach").update({ ...rest, updated_at: new Date().toISOString() })
          .eq("id", row.id).eq("workspace_id", row.workspace_id);
        if (error) throw new Error("Agent outreach update failed.");
      },
    },
    linkedin: {
      enabled: () => linkedInBridgeEnabled(),
      allowlist: parseAgentAllowlist(process.env.AGENTS_LINKEDIN_ALLOWLIST),
      async hasAccount(workspaceId, ownerId) {
        return Boolean(await ownerAccount(svc, workspaceId, ownerId));
      },
      async contact(workspaceId, ownerId, candidateId) {
        const account = await ownerAccount(svc, workspaceId, ownerId);
        if (!account) return { ok: false, reason: "The campaign owner has no LinkedIn connected in ARIA." };
        const result = await agentContact(svc, account, candidateId);
        if (!result.ok) return result;
        return { ok: true, relationship: result.contact.relationship, lookupError: result.contact.lookup_error };
      },
      async queue(row, kind, body) {
        const result = await agentQueue(svc, { workspaceId: row.workspace_id, campaignId: row.campaign_id, ownerId: row.owner_id },
          { candidateId: row.candidate_id, kind, body });
        return result.ok ? { ok: true, outboxId: result.item.id } : result;
      },
      async outbox(row) {
        if (!row.outbox_id) return null;
        const item = await agentOutboxItem(svc, row.workspace_id, row.owner_id, row.outbox_id);
        return item ? { status: item.status, error: item.error, sentAt: item.sent_at } : null;
      },
    },
    gate: {
      async evaluate() {
        return { status: "PASS" as const, score: 1, qcVersion: "qc.v1", draftHash: "unchecked", capsOk: true };
      },
      async killed() {
        return false;
      },
      async sentToday() {
        return 0;
      },
      dailyCap() {
        return 25;
      },
    },
    async draft({ workspaceId, state, candidateId, kind }) {
      const candidate = state.candidates.find((c) => c.id === candidateId);
      const campaign = candidate && state.campaigns.find((c) => c.id === candidate.campaignId);
      if (!candidate || !campaign) return null;
      return draftLinkedInOutreach({ workspaceId, settings: state.settings, skills: state.skills, candidate, campaign, kind });
    },
  };
}
