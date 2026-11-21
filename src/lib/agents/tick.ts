/* ============================================================================
   One tick of the agents runner (ADR 0002). Pure orchestration over injected
   dependencies, so the decisions are testable without a database.

   A tick does, in order:
   1. follow-up (cheap, every tick): queued LinkedIn writes the owner's
      extension sent or refused; look-ups that came back;
   2. at most ONE contact: the oldest selected candidate is looked up,
      drafted (Claude, template fallback) and queued in the owner's outbox;
   3. otherwise at most ONE sourcing step: advance the campaign's durable run,
      close a finished run and pick the best N candidates, or start a due run.
   The runner calls again at once while `more` is true, then sleeps.

   Nothing here sends: the owner's extension does, from their browser, under
   the bridge's pacing and caps.
   ========================================================================== */

import type { Campaign, WorkspaceState } from "@/lib/types";
import type { AgentDraft } from "./server/draft";
import type { CampaignSourcingJob, SourceChoice } from "@/lib/sourcing/unified-contract";
import { admitAutomaticSend, agentContactBlocker, agentOutreachMessage, autopilotSourcePlan, pickTopCandidates, type OutreachQcDraft, type OutreachQcVerdict } from "./autopilot";
import { recordLinkedInSent, makeActivity, withActivity } from "@/lib/store/workspace-transitions";
import { campaignAllowsLiveSourcing } from "@/lib/sourcing/campaign-lifecycle";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { genId } from "@/lib/utils";
import { publicIdFromProfileUrl } from "@/lib/linkedin-profile-url";

export interface AutopilotRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  owner_id: string;
  enabled: boolean;
  source_every_hours: number;
  source_limit: number;
  contact_enabled: boolean;
  contacts_per_run: number;
  min_score: number;
  last_source_at: string | null;
  last_contact_at: string | null;
}

export interface MissionRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  on_behalf_of: string;
  kind: "source" | "contact";
  status: "running" | "completed" | "partial" | "failed" | "skipped";
  sourcing_job_id: string | null;
  summary: string | null;
  started_at: string;
}

export type AgentOutreachState = "selected" | "awaiting_lookup" | "queued" | "sent" | "skipped" | "failed";
export interface AgentOutreachRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  candidate_id: string;
  owner_id: string;
  mission_id: string | null;
  message_id: string | null;
  state: AgentOutreachState;
  kind: "message" | "invitation" | null;
  outbox_id: string | null;
  score: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export type Relationship = "unknown" | "connected" | "pending" | "none" | "not_found";
export type ContactLookup =
  | { ok: true; relationship: Relationship; lookupError: string | null }
  | { ok: false; reason: string };
export type QueueOutcome = { ok: true; outboxId: string } | { ok: false; reason: string };
export interface OutboxStatus {
  status: "queued" | "resolving" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
  error: string | null;
  sentAt: string | null;
}
export type AgentScope = "source" | "draft" | "queue_linkedin";

export interface TickDeps {
  now(): Date;
  autopilots(): Promise<AutopilotRow[]>;
  updateAutopilot(row: AutopilotRow, patch: Partial<AutopilotRow>): Promise<void>;
  authority(workspaceId: string, userId: string, scope: AgentScope): Promise<{ ok: boolean; reason?: string; name: string }>;
  readState(workspaceId: string): Promise<WorkspaceState>;
  mutateState(workspaceId: string, change: (state: WorkspaceState) => WorkspaceState | null): Promise<WorkspaceState | null>;
  sourcing: {
    webSearchReady(state: WorkspaceState): boolean;
    activeJob(row: AutopilotRow): Promise<CampaignSourcingJob | null>;
    job(workspaceId: string, id: string): Promise<CampaignSourcingJob | null>;
    start(row: AutopilotRow, campaign: Campaign, plan: SourceChoice[]): Promise<{ ok: true; job: CampaignSourcingJob } | { ok: false; reason: string }>;
    advance(row: AutopilotRow, job: CampaignSourcingJob): Promise<void>;
  };
  missions: {
    running(row: AutopilotRow, kind: MissionRow["kind"]): Promise<MissionRow | null>;
    create(row: AutopilotRow, mission: Pick<MissionRow, "kind" | "status"> & Partial<Pick<MissionRow, "sourcing_job_id" | "summary">>): Promise<MissionRow>;
    finish(mission: MissionRow, status: MissionRow["status"], summary: string): Promise<void>;
  };
  outreach: {
    open(): Promise<AgentOutreachRow[]>;
    pickedCandidates(row: AutopilotRow): Promise<Set<string>>;
    insert(rows: Omit<AgentOutreachRow, "id" | "created_at" | "updated_at" | "message_id" | "kind" | "outbox_id" | "reason">[]): Promise<void>;
    update(row: AgentOutreachRow, patch: Partial<AgentOutreachRow>): Promise<void>;
  };
  linkedin: {
    enabled(): boolean;
    /** AGENTS_LINKEDIN_ALLOWLIST: when set, the only profiles the agent may contact. */
    allowlist?: ReadonlySet<string> | null;
    hasAccount(workspaceId: string, ownerId: string): Promise<boolean>;
    contact(workspaceId: string, ownerId: string, candidateId: string): Promise<ContactLookup>;
    queue(row: AgentOutreachRow, kind: "message" | "invitation", body: string): Promise<QueueOutcome>;
    outbox(row: AgentOutreachRow): Promise<OutboxStatus | null>;
  };
  draft(input: { workspaceId: string; state: WorkspaceState; candidateId: string; kind: "message" | "invitation" }): Promise<AgentDraft | null>;
  gate: {
    evaluate(draft: OutreachQcDraft): Promise<OutreachQcVerdict | null>;
    killed(workspaceId: string): Promise<boolean | null>;
    sentToday(workspaceId: string): Promise<number | null>;
    dailyCap(workspaceId: string): number;
  };
}

export interface TickResult {
  action: "idle" | "contact" | "source-start" | "source-advance" | "source-finished" | "source-skipped";
  detail?: string;
  followUps: number;
  more: boolean;
}

/** A look-up that has not come back after this long ends the contact. */
export const LOOKUP_TIMEOUT_MS = 6 * 3600_000;

function campaignReady(campaign: Campaign | undefined): campaign is Campaign {
  return Boolean(campaign && campaignAllowsLiveSourcing(campaign.status) && evaluateNeedReadiness(campaign.jobAnalysis).ready);
}

function due(row: AutopilotRow, now: Date): boolean {
  return !row.last_source_at || now.getTime() - Date.parse(row.last_source_at) >= row.source_every_hours * 3600_000;
}

/* ---- 1. follow-up ---------------------------------------------------------- */

async function followUp(deps: TickDeps, row: AgentOutreachRow): Promise<boolean> {
  const now = deps.now();
  if (row.state === "queued" && row.outbox_id) {
    const item = await deps.linkedin.outbox(row);
    if (!item) {
      await deps.outreach.update(row, { state: "failed", reason: "The LinkedIn write is gone from the owner's outbox." });
      return true;
    }
    if (item.status === "sent") {
      const owner = await deps.authority(row.workspace_id, row.owner_id, "draft");
      const what = row.kind === "invitation" ? "invitation" : "message";
      await deps.mutateState(row.workspace_id, (state) => {
        const message = state.outreach.find((m) => m.id === row.message_id);
        if (!message || message.status !== "Pending Manual Send") return null;
        const candidate = state.candidates.find((c) => c.id === row.candidate_id);
        return recordLinkedInSent(state, message.id, item.sentAt ?? now.toISOString(), {
          reason: `Sent on LinkedIn by the ARIA agent for ${owner.name}.`,
          notes: `The ARIA agent sent this LinkedIn ${what} from ${owner.name}'s account, under the campaign's standing approval.`,
          title: `LinkedIn ${what} sent by the agent: ${candidate?.name ?? "candidate"}`,
        });
      });
      await deps.outreach.update(row, { state: "sent", reason: null });
      return true;
    }
    if (item.status === "failed" || item.status === "cancelled" || item.status === "unknown") {
      const reason = item.status === "unknown"
        ? "LinkedIn did not confirm the send; it is never retried automatically."
        : `LinkedIn ${item.status}${item.error ? `: ${item.error}` : ""}`;
      await deps.outreach.update(row, { state: "failed", reason: reason.slice(0, 300) });
      return true;
    }
    return false;
  }
  if (row.state === "awaiting_lookup") {
    const contact = await deps.linkedin.contact(row.workspace_id, row.owner_id, row.candidate_id);
    if (!contact.ok) {
      await deps.outreach.update(row, { state: "skipped", reason: contact.reason.slice(0, 300) });
      return true;
    }
    if (contact.lookupError) {
      await deps.outreach.update(row, { state: "failed", reason: `LinkedIn look-up failed: ${contact.lookupError}`.slice(0, 300) });
      return true;
    }
    if (contact.relationship !== "unknown") {
      await deps.outreach.update(row, { state: "selected" });
      return true;
    }
    if (now.getTime() - Date.parse(row.updated_at) > LOOKUP_TIMEOUT_MS) {
      await deps.outreach.update(row, { state: "failed", reason: "The LinkedIn look-up did not come back: is the owner's browser with the ARIA extension running?" });
      return true;
    }
  }
  return false;
}

/* ---- 2. one contact ---------------------------------------------------------- */

async function contactOne(deps: TickDeps, row: AgentOutreachRow, pilots: AutopilotRow[]): Promise<string> {
  const pilot = pilots.find((p) => p.workspace_id === row.workspace_id && p.campaign_id === row.campaign_id);
  if (!pilot || !pilot.contact_enabled || pilot.owner_id !== row.owner_id) {
    await deps.outreach.update(row, { state: "skipped", reason: "The campaign's autopilot contact is off." });
    return "skipped: autopilot off";
  }
  for (const scope of ["draft", "queue_linkedin"] as const) {
    const auth = await deps.authority(row.workspace_id, row.owner_id, scope);
    if (!auth.ok) {
      await deps.outreach.update(row, { state: "failed", reason: (auth.reason ?? "Not allowed.").slice(0, 300) });
      return `failed: ${auth.reason}`;
    }
  }
  if (!deps.linkedin.enabled()) {
    await deps.outreach.update(row, { state: "failed", reason: "The LinkedIn bridge is off on this server." });
    return "failed: bridge off";
  }
  if (!(await deps.linkedin.hasAccount(row.workspace_id, row.owner_id))) {
    await deps.outreach.update(row, { state: "failed", reason: "The campaign owner has no LinkedIn connected in ARIA." });
    return "failed: no LinkedIn account";
  }

  const state = await deps.readState(row.workspace_id);
  const campaign = state.campaigns.find((c) => c.id === row.campaign_id);
  const candidate = state.candidates.find((c) => c.id === row.candidate_id);
  const drafted = row.message_id ? state.outreach.find((m) => m.id === row.message_id) : undefined;
  if (!candidate || !campaign) {
    await deps.outreach.update(row, { state: "skipped", reason: "Candidate or campaign no longer exists." });
    return "skipped: gone";
  }
  const allow = deps.linkedin.allowlist ?? null;
  if (!drafted) {
    const blocker = agentContactBlocker(candidate, campaign, state, allow);
    if (blocker) {
      await deps.outreach.update(row, { state: "skipped", reason: blocker });
      return `skipped: ${blocker}`;
    }
  }

  const contact = await deps.linkedin.contact(row.workspace_id, row.owner_id, row.candidate_id);
  if (!contact.ok) {
    await deps.outreach.update(row, { state: "skipped", reason: contact.reason.slice(0, 300) });
    return `skipped: ${contact.reason}`;
  }
  if (contact.relationship === "unknown") {
    await deps.outreach.update(row, { state: "awaiting_lookup" });
    return "waiting for the LinkedIn look-up";
  }
  if (contact.relationship === "pending" || contact.relationship === "not_found") {
    const reason = contact.relationship === "pending" ? "An invitation is already pending." : "LinkedIn does not know this profile.";
    await deps.outreach.update(row, { state: "skipped", reason });
    return `skipped: ${reason}`;
  }
  const kind = contact.relationship === "connected" ? "message" : "invitation";

  let body = drafted?.body;
  if (!drafted) {
    const draft = await deps.draft({ workspaceId: row.workspace_id, state, candidateId: candidate.id, kind });
    if (!draft) {
      await deps.outreach.update(row, { state: "failed", reason: "No draft could be written." });
      return "failed: no draft";
    }
    const owner = await deps.authority(row.workspace_id, row.owner_id, "draft");
    const messageId = genId("msg");
    // Record the id first: a crash after the workspace write reuses this draft.
    await deps.outreach.update(row, { message_id: messageId, kind });
    const saved = await deps.mutateState(row.workspace_id, (latest) => {
      const c = latest.candidates.find((x) => x.id === candidate.id);
      const camp = latest.campaigns.find((x) => x.id === campaign.id);
      if (!c || !camp || agentContactBlocker(c, camp, latest, allow)) return null;
      const message = agentOutreachMessage({ candidate: c, campaign: camp, settings: latest.settings, gen: draft.gen, draftedBy: draft.draftedBy, ownerName: owner.name, id: messageId });
      return withActivity(
        { ...latest, outreach: [message, ...latest.outreach] },
        makeActivity({
          type: "outreach",
          title: `Agent queued a LinkedIn ${kind}: ${c.name}`,
          notes: `Match score ${c.matchScore}. ${draft.draftedBy === "ai" ? "Written by Claude" : "Template copy"}, sent from ${owner.name}'s LinkedIn under the campaign's standing approval.`,
          outcome: "Pending Manual Send",
          campaignId: camp.id,
          linkedEntityType: "candidate",
          linkedEntityId: c.id,
        }),
        camp.id,
      );
    });
    if (!saved) {
      await deps.outreach.update(row, { state: "skipped", reason: "The candidate changed before the draft was saved." });
      return "skipped: changed";
    }
    body = draft.gen.body;
  }

  // Last check before anything reaches the owner's outbox, also for a draft
  // saved by an earlier tick.
  const publicId = publicIdFromProfileUrl(candidate.linkedinUrl ?? "")?.toLowerCase() ?? "";
  if (allow && !allow.has(publicId)) {
    await deps.outreach.update(row, { state: "skipped", reason: "Outside the agent allowlist (AGENTS_LINKEDIN_ALLOWLIST)." });
    return "skipped: outside the allowlist";
  }
  const text = body ?? "";
  const language = (campaign.jobAnalysis.language || "en").split(/[_-]/)[0].toLowerCase() || "en";
  let verdict: OutreachQcVerdict | null = null;
  let killed: boolean | null = null;
  let sentToday: number | null = null;
  try {
    verdict = await deps.gate.evaluate({
      channel: kind === "invitation" ? "heyreach-connect" : "heyreach",
      subject: "",
      body: text,
      language,
    });
    killed = await deps.gate.killed(row.workspace_id);
    sentToday = await deps.gate.sentToday(row.workspace_id);
  } catch {
    verdict = null;
    killed = null;
    sentToday = null;
  }
  const decision = admitAutomaticSend({
    killed,
    sentToday,
    dailyCap: deps.gate.dailyCap(row.workspace_id),
    verdict,
  });
  if (!decision.ok) {
    await deps.outreach.update(row, { state: "failed", reason: decision.reason.slice(0, 300) });
    return `failed: ${decision.reason}`;
  }
  const queued = await deps.linkedin.queue({ ...row, kind }, kind, text);
  if (!queued.ok) {
    await deps.outreach.update(row, { state: "failed", reason: queued.reason.slice(0, 300) });
    return `failed: ${queued.reason}`;
  }
  await deps.outreach.update(row, { state: "queued", kind, outbox_id: queued.outboxId, reason: null });
  return `queued ${kind}`;
}

/* ---- 3. one sourcing step ------------------------------------------------------ */

async function selectContacts(deps: TickDeps, pilot: AutopilotRow): Promise<string> {
  const state = await deps.readState(pilot.workspace_id);
  const picked = await deps.outreach.pickedCandidates(pilot);
  const top = pickTopCandidates(state, pilot.campaign_id, { count: pilot.contacts_per_run, minScore: pilot.min_score, exclude: picked, allow: deps.linkedin.allowlist ?? null });
  const mission = await deps.missions.create(pilot, { kind: "contact", status: "running" });
  if (top.length) {
    await deps.outreach.insert(top.map((c) => ({
      workspace_id: pilot.workspace_id, campaign_id: pilot.campaign_id, candidate_id: c.id, owner_id: pilot.owner_id,
      mission_id: mission.id, state: "selected" as const, score: Math.round(c.matchScore),
    })));
  }
  const summary = top.length
    ? `Picked ${top.length} candidate${top.length > 1 ? "s" : ""} (scores ${top.map((c) => Math.round(c.matchScore)).join(", ")}).`
    : `No eligible candidate at or above score ${pilot.min_score}.`;
  await deps.missions.finish(mission, top.length ? "completed" : "skipped", summary);
  await deps.updateAutopilot(pilot, { last_contact_at: deps.now().toISOString() });
  return summary;
}

async function sourcingStep(deps: TickDeps, pilot: AutopilotRow): Promise<TickResult["action"] | null> {
  const auth = await deps.authority(pilot.workspace_id, pilot.owner_id, "source");
  if (!auth.ok) return null;
  const now = deps.now();
  const running = await deps.missions.running(pilot, "source");
  if (running) {
    const job = running.sourcing_job_id ? await deps.sourcing.job(pilot.workspace_id, running.sourcing_job_id) : null;
    if (job && job.status === "active") {
      if (job.claim_until && Date.parse(job.claim_until) > now.getTime()) return null;
      await deps.sourcing.advance(pilot, job);
      return "source-advance";
    }
    const added = job ? job.steps.reduce((n, s) => n + s.added, 0) : 0;
    const status = !job ? "failed" : job.status === "completed" ? "completed" : job.status === "partial" ? "partial" : "failed";
    const errors = job ? job.steps.filter((s) => s.error).map((s) => s.error).join(" ") : "Run not found.";
    await deps.missions.finish(running, status, `Added ${added} candidate${added === 1 ? "" : "s"}.${errors ? ` ${errors}` : ""}`.slice(0, 500));
    if (pilot.contact_enabled) await selectContacts(deps, pilot);
    return "source-finished";
  }
  if (!due(pilot, now)) return null;
  const state = await deps.readState(pilot.workspace_id);
  const campaign = state.campaigns.find((c) => c.id === pilot.campaign_id);
  const skip = async (summary: string) => {
    await deps.missions.create(pilot, { kind: "source", status: "skipped", summary });
    await deps.updateAutopilot(pilot, { last_source_at: now.toISOString() });
    return "source-skipped" as const;
  };
  if (!campaignReady(campaign)) return skip("Campaign missing, closed or its brief is not reviewed: no sourcing.");
  if (await deps.sourcing.activeJob(pilot)) return null;
  const plan = autopilotSourcePlan(campaign, { webSearch: deps.sourcing.webSearchReady(state), limit: pilot.source_limit });
  if (!plan.length) return skip("No source available: add an Anthropic key for web search or a GitHub query to the strategy.");
  const started = await deps.sourcing.start(pilot, campaign, plan);
  if (!started.ok) return skip(started.reason);
  await deps.missions.create(pilot, { kind: "source", status: "running", sourcing_job_id: started.job.id,
    summary: `Sourcing: ${plan.map((p) => `${p.source} (${p.limit})`).join(", ")}.` });
  await deps.updateAutopilot(pilot, { last_source_at: now.toISOString() });
  return "source-start";
}

/* ---- the tick --------------------------------------------------------------------- */

export async function runTick(deps: TickDeps): Promise<TickResult> {
  const open = await deps.outreach.open();
  let followUps = 0;
  for (const row of open) {
    if (row.state === "queued" || row.state === "awaiting_lookup") {
      try {
        if (await followUp(deps, row)) followUps++;
      } catch (cause) {
        console.error("[agents] follow-up failed", cause instanceof Error ? cause.message : "error");
      }
    }
  }
  const pilots = (await deps.autopilots()).filter((p) => p.enabled);

  const refreshed = followUps ? await deps.outreach.open() : open;
  const next = refreshed.filter((r) => r.state === "selected").sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (next) {
    const detail = await contactOne(deps, next, pilots);
    return { action: "contact", detail, followUps, more: true };
  }

  const ordered = [...pilots].sort((a, b) => (a.last_source_at ?? "").localeCompare(b.last_source_at ?? ""));
  for (const pilot of ordered) {
    const action = await sourcingStep(deps, pilot);
    if (action) return { action, detail: pilot.campaign_id, followUps, more: true };
  }
  return { action: "idle", followUps, more: false };
}
