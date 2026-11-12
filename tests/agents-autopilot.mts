/* ============================================================================
   tests/agents-autopilot.mts
   Campaign autopilot (ADR 0002): who the agent may contact, the invitation
   note limit, the sourcing plan, the "LinkedIn sent" transition, and the
   tick's decisions with fake dependencies (no database, no network).
   ========================================================================== */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSeedState } from "../src/lib/seed";
import type { Candidate, WorkspaceState } from "../src/lib/types";
import {
  INVITATION_NOTE_MAX,
  agentContactBlocker,
  autopilotSourcePlan,
  fitInvitationNote,
  pickTopCandidates,
} from "../src/lib/agents/autopilot";
import { recordLinkedInSent } from "../src/lib/store/workspace-transitions";
import {
  runTick,
  type AgentOutreachRow,
  type AutopilotRow,
  type ContactLookup,
  type MissionRow,
  type OutboxStatus,
  type TickDeps,
} from "../src/lib/agents/tick";
import type { CampaignSourcingJob, SourceChoice } from "../src/lib/sourcing/unified-contract";

const WS = "00000000-0000-4000-8000-0000000000aa";
const OWNER = "00000000-0000-4000-8000-0000000000bb";

function fixture(): { state: WorkspaceState; campaignId: string } {
  const state = structuredClone(buildSeedState());
  const campaign = state.campaigns[0];
  campaign.status = "Sourcing";
  const template = state.candidates.find((c) => c.campaignId === campaign.id) ?? state.candidates[0];
  const make = (i: number, score: number, extra: Partial<Candidate> = {}): Candidate => ({
    ...structuredClone(template),
    id: `cand_t${i}`,
    name: `Test Person ${i}`,
    campaignId: campaign.id,
    stage: "Sourced",
    matchScore: score,
    linkedinUrl: `https://www.linkedin.com/in/test-person-${i}`,
    outreachHistory: [],
    lastContactedAt: null,
    complianceFlags: { ...template.complianceFlags, doNotContact: false, unsubscribed: false, suppressed: false, anonymized: false },
    createdAt: new Date(2026, 10, i).toISOString(),
    ...extra,
  });
  state.candidates = [
    make(1, 91), make(2, 88), make(3, 85), make(4, 80), make(5, 60),
    make(6, 95, { complianceFlags: { ...template.complianceFlags, doNotContact: true } }),
    make(7, 94, { stage: "Contacted" }),
    make(8, 93, { linkedinUrl: "" }),
  ];
  state.outreach = [];
  return { state, campaignId: campaign.id };
}

test("only Sourced, contactable candidates with a LinkedIn profile are eligible", () => {
  const { state, campaignId } = fixture();
  const campaign = state.campaigns.find((c) => c.id === campaignId);
  const byId = (id: string) => state.candidates.find((c) => c.id === id)!;
  assert.equal(agentContactBlocker(byId("cand_t1"), campaign, state), null);
  assert.ok(agentContactBlocker(byId("cand_t6"), campaign, state));
  assert.ok(agentContactBlocker(byId("cand_t7"), campaign, state));
  assert.ok(agentContactBlocker(byId("cand_t8"), campaign, state));
});

test("the best N at or above the threshold, skipping already picked ones", () => {
  const { state, campaignId } = fixture();
  const top = pickTopCandidates(state, campaignId, { count: 3, minScore: 70 });
  assert.deepEqual(top.map((c) => c.id), ["cand_t1", "cand_t2", "cand_t3"]);
  const next = pickTopCandidates(state, campaignId, { count: 3, minScore: 70, exclude: new Set(["cand_t1", "cand_t2"]) });
  assert.deepEqual(next.map((c) => c.id), ["cand_t3", "cand_t4"]);
  state.outreach = [{ ...structuredClone(buildSeedState().outreach[0] ?? {}), id: "msg_x", candidateId: "cand_t1", campaignId, status: "Needs Approval" } as WorkspaceState["outreach"][number]];
  assert.ok(!pickTopCandidates(state, campaignId, { count: 5, minScore: 0 }).some((c) => c.id === "cand_t1"), "a drafted candidate is not picked");
});

test("an invitation note never exceeds LinkedIn's 300 characters", () => {
  const long = "Hello Ada, I read your work on distributed systems and it is impressive. ".repeat(10);
  const note = fitInvitationNote(long);
  assert.ok(note.length <= INVITATION_NOTE_MAX, `${note.length}`);
  assert.ok(note.length > 80);
  assert.equal(fitInvitationNote("Short note."), "Short note.");
  assert.doesNotMatch(note, /  /, "sentences joined by one space");
  const words = fitInvitationNote("word ".repeat(200));
  assert.ok(words.length <= INVITATION_NOTE_MAX);
});

test("the nightly plan uses the reviewed strategy's queries", () => {
  const { state, campaignId } = fixture();
  const campaign = state.campaigns.find((c) => c.id === campaignId)!;
  const plan = autopilotSourcePlan(campaign, { webSearch: true, limit: 8 });
  assert.ok(plan.every((p) => p.limit === 8 && p.query.length > 0 && p.query.length <= 256));
  assert.equal(autopilotSourcePlan(campaign, { webSearch: false, limit: 8 }).some((p) => p.source === "WebSearch"), false);
});

test("recordLinkedInSent schedules the message and moves the candidate to Contacted", () => {
  const { state, campaignId } = fixture();
  const message = { ...structuredClone(buildSeedState().outreach[0]), id: "msg_s", candidateId: "cand_t1", campaignId, channel: "LinkedIn" as const, status: "Pending Manual Send" as const };
  state.outreach = [message];
  const next = recordLinkedInSent(state, "msg_s", "2026-11-09T10:00:00.000Z", { reason: "r", notes: "n" });
  assert.equal(next.outreach[0].status, "Scheduled");
  // A LinkedIn message really left: it counts as a real send even in email dry-run.
  assert.equal(next.outreach[0].dryRun, false);
  assert.equal(next.outreach[0].sentAt, "2026-11-09T10:00:00.000Z");
  const candidate = next.candidates.find((c) => c.id === "cand_t1")!;
  assert.equal(candidate.stage, "Contacted");
  assert.equal(candidate.lastContactedAt, "2026-11-09T10:00:00.000Z");
  assert.equal(next.ledger[0].status, "sent");
  assert.equal(recordLinkedInSent(state, "missing", "x", { reason: "r", notes: "n" }), state);
});

/* ---- tick with fakes --------------------------------------------------------- */

interface World {
  state: WorkspaceState;
  pilots: AutopilotRow[];
  missions: MissionRow[];
  outreach: AgentOutreachRow[];
  jobs: CampaignSourcingJob[];
  relationship: ContactLookup;
  outbox: Map<string, OutboxStatus>;
  queued: { candidateId: string; kind: string; body: string }[];
  started: SourceChoice[][];
  advanced: number;
  authorityOk: boolean;
  bridge: boolean;
  drafts: number;
  now: Date;
}

function world(): World {
  const { state, campaignId } = fixture();
  return {
    state,
    pilots: [{ id: "p1", workspace_id: WS, campaign_id: campaignId, owner_id: OWNER, enabled: true, source_every_hours: 24,
      source_limit: 8, contact_enabled: true, contacts_per_run: 3, min_score: 70, last_source_at: null, last_contact_at: null }],
    missions: [], outreach: [], jobs: [], relationship: { ok: true, relationship: "none", lookupError: null },
    outbox: new Map(), queued: [], started: [], advanced: 0, authorityOk: true, bridge: true, drafts: 0,
    now: new Date("2026-11-09T12:00:00.000Z"),
  };
}

function deps(w: World): TickDeps {
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;
  return {
    now: () => w.now,
    autopilots: async () => w.pilots,
    updateAutopilot: async (row, patch) => { Object.assign(w.pilots.find((p) => p.id === row.id)!, patch); },
    authority: async () => w.authorityOk ? { ok: true, name: "Michael" } : { ok: false, reason: "The owner revoked the agents.", name: "Michael" },
    readState: async () => structuredClone(w.state),
    mutateState: async (_ws, change) => {
      const next = change(structuredClone(w.state));
      if (next) w.state = next;
      return next;
    },
    sourcing: {
      webSearchReady: () => true,
      activeJob: async () => w.jobs.find((j) => j.status === "active") ?? null,
      job: async (_ws, jobId) => w.jobs.find((j) => j.id === jobId) ?? null,
      start: async (row, _campaign, plan) => {
        w.started.push(plan);
        const job = { id: id("job"), workspace_id: WS, actor_id: row.owner_id, campaign_id: row.campaign_id, campaign_snapshot: {},
          status: "active", steps: [], revision: 0, claim_token: null, claim_until: null, created_at: w.now.toISOString() } as CampaignSourcingJob;
        w.jobs.push(job);
        return { ok: true, job };
      },
      advance: async (_row, job) => { w.advanced++; job.status = "completed"; },
    },
    missions: {
      running: async (row, kind) => w.missions.find((m) => m.campaign_id === row.campaign_id && m.kind === kind && m.status === "running") ?? null,
      create: async (row, m) => {
        const mission: MissionRow = { id: id("mis"), workspace_id: WS, campaign_id: row.campaign_id, on_behalf_of: row.owner_id,
          kind: m.kind, status: m.status, sourcing_job_id: m.sourcing_job_id ?? null, summary: m.summary ?? null, started_at: w.now.toISOString() };
        w.missions.push(mission);
        return mission;
      },
      finish: async (mission, status, summary) => { Object.assign(w.missions.find((m) => m.id === mission.id)!, { status, summary }); },
    },
    outreach: {
      open: async () => w.outreach.filter((r) => ["selected", "awaiting_lookup", "queued"].includes(r.state)).map((r) => ({ ...r })),
      pickedCandidates: async () => new Set(w.outreach.map((r) => r.candidate_id)),
      insert: async (rows) => {
        for (const r of rows) {
          if (w.outreach.some((x) => x.candidate_id === r.candidate_id)) continue;
          w.outreach.push({ ...r, id: id("ao"), message_id: null, kind: null, outbox_id: null, reason: null,
            created_at: new Date(w.now.getTime() + seq).toISOString(), updated_at: w.now.toISOString() });
        }
      },
      update: async (row, patch) => { Object.assign(w.outreach.find((r) => r.id === row.id)!, patch, { updated_at: w.now.toISOString() }); },
    },
    linkedin: {
      enabled: () => w.bridge,
      hasAccount: async () => true,
      contact: async () => w.relationship,
      queue: async (row, kind, body) => {
        w.queued.push({ candidateId: row.candidate_id, kind, body });
        const outboxId = id("out");
        w.outbox.set(outboxId, { status: "queued", error: null, sentAt: null });
        return { ok: true, outboxId };
      },
      outbox: async (row) => (row.outbox_id ? w.outbox.get(row.outbox_id) ?? null : null),
    },
    draft: async ({ kind }) => {
      w.drafts++;
      return { draftedBy: "ai", gen: { subject: "LinkedIn", body: kind === "invitation" ? "Hi, your work on Rust stood out. Open to connect?" : "Hello, a role you may like.", personalizationEvidence: [], channel: "LinkedIn" } };
    },
  };
}

test("a due campaign starts a durable sourcing run, then picks the best three when it ends", async () => {
  const w = world();
  const d = deps(w);
  const first = await runTick(d);
  assert.equal(first.action, "source-start");
  assert.equal(w.started.length, 1);
  assert.equal(w.pilots[0].last_source_at, w.now.toISOString());
  assert.equal((await runTick(d)).action, "source-advance");
  assert.equal(w.advanced, 1);
  const finished = await runTick(d);
  assert.equal(finished.action, "source-finished");
  assert.deepEqual(w.outreach.map((r) => r.candidate_id), ["cand_t1", "cand_t2", "cand_t3"]);
  assert.ok(w.outreach.every((r) => r.state === "selected" && r.owner_id === OWNER));
  assert.equal(w.missions.find((m) => m.kind === "source")?.status, "completed");
  assert.equal(w.missions.find((m) => m.kind === "contact")?.status, "completed");
});

test("a non-connection gets an invitation note, recorded as approved by the agent and waiting to be sent", async () => {
  const w = world();
  w.pilots[0].last_source_at = w.now.toISOString();
  await deps(w).outreach.insert([{ workspace_id: WS, campaign_id: w.pilots[0].campaign_id, candidate_id: "cand_t1", owner_id: OWNER, mission_id: null, state: "selected", score: 91 }]);
  const result = await runTick(deps(w));
  assert.equal(result.action, "contact");
  assert.equal(w.queued.length, 1);
  assert.equal(w.queued[0].kind, "invitation");
  assert.ok(w.queued[0].body.length <= INVITATION_NOTE_MAX);
  const row = w.outreach[0];
  assert.equal(row.state, "queued");
  const message = w.state.outreach.find((m) => m.id === row.message_id)!;
  assert.equal(message.status, "Pending Manual Send");
  assert.equal(message.channel, "LinkedIn");
  assert.match(message.approvedBy ?? "", /ARIA agent for Michael/);
  assert.equal(w.state.candidates.find((c) => c.id === "cand_t1")?.stage, "Sourced", "not contacted until the extension confirms");
});

test("an unknown relationship waits for the owner's extension to look the profile up", async () => {
  const w = world();
  w.pilots[0].last_source_at = w.now.toISOString();
  w.relationship = { ok: true, relationship: "unknown", lookupError: null };
  await deps(w).outreach.insert([{ workspace_id: WS, campaign_id: w.pilots[0].campaign_id, candidate_id: "cand_t1", owner_id: OWNER, mission_id: null, state: "selected", score: 91 }]);
  await runTick(deps(w));
  assert.equal(w.outreach[0].state, "awaiting_lookup");
  assert.equal(w.drafts, 0);
  w.relationship = { ok: true, relationship: "connected", lookupError: null };
  await runTick(deps(w));
  assert.equal(w.outreach[0].state, "queued");
  assert.equal(w.queued[0].kind, "message");
});

test("the extension's send moves the candidate to Contacted; a refusal is reported, never retried", async () => {
  const w = world();
  w.pilots[0].last_source_at = w.now.toISOString();
  const d = deps(w);
  await d.outreach.insert([
    { workspace_id: WS, campaign_id: w.pilots[0].campaign_id, candidate_id: "cand_t1", owner_id: OWNER, mission_id: null, state: "selected", score: 91 },
    { workspace_id: WS, campaign_id: w.pilots[0].campaign_id, candidate_id: "cand_t2", owner_id: OWNER, mission_id: null, state: "selected", score: 88 },
  ]);
  await runTick(d);
  await runTick(d);
  const [a, b] = w.outreach;
  w.outbox.set(a.outbox_id!, { status: "sent", error: null, sentAt: "2026-11-09T12:05:00.000Z" });
  w.outbox.set(b.outbox_id!, { status: "failed", error: "Weekly invitation limit", sentAt: null });
  const result = await runTick(d);
  assert.equal(result.followUps, 2);
  assert.equal(a.state, "sent");
  assert.equal(b.state, "failed");
  assert.match(b.reason ?? "", /Weekly invitation limit/);
  assert.equal(w.state.candidates.find((c) => c.id === "cand_t1")?.stage, "Contacted");
  assert.equal(w.state.outreach.find((m) => m.id === a.message_id)?.status, "Scheduled");
  assert.equal(w.queued.length, 2, "nothing queued again");
});

test("a revoked delegation or a disabled bridge stops the contact before any draft", async () => {
  for (const setup of [(w: World) => { w.authorityOk = false; }, (w: World) => { w.bridge = false; }]) {
    const w = world();
    w.pilots[0].last_source_at = w.now.toISOString();
    setup(w);
    await deps(w).outreach.insert([{ workspace_id: WS, campaign_id: w.pilots[0].campaign_id, candidate_id: "cand_t1", owner_id: OWNER, mission_id: null, state: "selected", score: 91 }]);
    await runTick(deps(w));
    assert.equal(w.outreach[0].state, "failed");
    assert.equal(w.drafts, 0);
    assert.equal(w.queued.length, 0);
  }
});

test("a draft saved before a crash is queued as is, never drafted twice", async () => {
  const w = world();
  w.pilots[0].last_source_at = w.now.toISOString();
  const d = deps(w);
  await d.outreach.insert([{ workspace_id: WS, campaign_id: w.pilots[0].campaign_id, candidate_id: "cand_t1", owner_id: OWNER, mission_id: null, state: "selected", score: 91 }]);
  const message = { ...structuredClone(buildSeedState().outreach[0]), id: "msg_saved", candidateId: "cand_t1", campaignId: w.pilots[0].campaign_id, channel: "LinkedIn" as const, status: "Pending Manual Send" as const, body: "Saved note." };
  w.state.outreach = [message];
  w.outreach[0].message_id = "msg_saved";
  await runTick(d);
  assert.equal(w.drafts, 0);
  assert.equal(w.queued[0].body, "Saved note.");
  assert.equal(w.outreach[0].state, "queued");
});

test("nothing due: the tick is idle", async () => {
  const w = world();
  w.pilots[0].last_source_at = w.now.toISOString();
  const result = await runTick(deps(w));
  assert.equal(result.action, "idle");
  assert.equal(result.more, false);
});

test("a campaign with an unreviewed brief is skipped once per period, not retried in a loop", async () => {
  const w = world();
  w.state.campaigns[0].status = "Draft" as WorkspaceState["campaigns"][number]["status"];
  const d = deps(w);
  assert.equal((await runTick(d)).action, "source-skipped");
  assert.equal(w.started.length, 0);
  assert.equal((await runTick(d)).action, "idle");
});
