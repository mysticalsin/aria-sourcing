/* tests/recommendations.mts — area: recommendations
 * Tests src/lib/recommendations.ts's deriveRecommendations: priority ordering
 * (SLA risk > match score > stage leverage), rollup grouping beyond the cap,
 * and that fully-clear state produces an empty queue.
 */
import { deriveRecommendations } from "../src/lib/recommendations";
import { historicalSeedState } from "./seed-fixtures.mts";
import type { Candidate, Campaign, ClassifiedReply, OutreachMessage, HermesState } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name, extra ?? "");
  }
}

const NOW = new Date("2026-07-01T12:00:00Z").getTime();
const seed = historicalSeedState();
const candidateTemplate: Candidate = seed.candidates[0];
const replyTemplate: ClassifiedReply = seed.replies[0] ?? {
  id: "r0",
  candidateId: "c0",
  campaignId: "camp0",
  channel: "Email",
  body: "",
  intent: "INTERESTED",
  confidence: 1,
  reasoning: "",
  suggestedAction: "",
  draftResponse: "",
  handled: false,
  slaDueAt: null,
  receivedAt: new Date(NOW).toISOString(),
};
const outreachTemplate: OutreachMessage = seed.outreach[0] ?? {
  id: "o0",
  candidateId: "c0",
  campaignId: "camp0",
  channel: "Email",
  subject: "",
  body: "",
  tone: "Casual Professional",
  personalizationEvidence: [],
  status: "Needs Approval",
  sequenceStep: 1,
  scheduledFor: null,
  sentAt: null,
  approvedBy: null,
  dryRun: true,
  createdAt: new Date(NOW).toISOString(),
};

const campaignTemplate: Campaign = seed.campaigns[0];

function candidate(overrides: Partial<Candidate>): Candidate {
  return { ...candidateTemplate, ...overrides };
}
function reply(overrides: Partial<ClassifiedReply>): ClassifiedReply {
  return { ...replyTemplate, ...overrides };
}
function outreachMsg(overrides: Partial<OutreachMessage>): OutreachMessage {
  return { ...outreachTemplate, ...overrides };
}
function campaign(overrides: Partial<Campaign>): Campaign {
  return { ...campaignTemplate, ...overrides };
}

// Seed campaigns include a "Sourcing" one, which (now that source_campaign
// recommendations exist) legitimately produces a rec once its candidates are
// cleared below. Tests that want an empty/exact-count queue don't intend to
// exercise that path, so start with no campaigns too; tests that specifically
// need one set s.campaigns themselves.
function emptyState(): HermesState {
  return { ...seed, candidates: [], outreach: [], replies: [], campaigns: [] };
}

/* ---- fully clear state -> empty queue ------------------------------------ */
ok("no items anywhere -> empty queue", deriveRecommendations(emptyState(), NOW).length === 0);

/* ---- SLA risk dominates over match score ---------------------------------- */
{
  const s = emptyState();
  s.candidates = [
    candidate({ id: "low-match-urgent-cand", campaignId: "camp1", matchScore: 20, stage: "Contacted", booking: null }),
    candidate({ id: "high-match-cand", campaignId: "camp1", matchScore: 95, stage: "Sourced", booking: null }),
  ];
  s.replies = [
    reply({
      id: "urgent-reply",
      candidateId: "low-match-urgent-cand",
      campaignId: "camp1",
      intent: "INTERESTED",
      handled: false,
      slaDueAt: new Date(NOW + 30 * 60 * 1000).toISOString(), // 30 min out -- imminent
    }),
  ];
  s.outreach = [
    outreachMsg({
      id: "high-match-draft",
      candidateId: "high-match-cand",
      campaignId: "camp1",
      status: "Needs Approval",
      createdAt: new Date(NOW).toISOString(), // fresh -- must stay approve_outreach, not stalled_draft
    }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok("both items present", recs.length === 2, recs);
  ok(
    "an imminent-SLA reply (low match) outranks a high-match approval draft",
    recs[0]?.kind === "hot_reply" && recs[1]?.kind === "approve_outreach",
    recs,
  );
}

/* ---- among items with no SLA, match score orders them --------------------- */
{
  const s = emptyState();
  s.outreach = [
    outreachMsg({
      id: "low",
      candidateId: "low-cand",
      campaignId: "camp1",
      status: "Needs Approval",
      createdAt: new Date(NOW).toISOString(), // fresh -- must stay approve_outreach, not stalled_draft
    }),
    outreachMsg({
      id: "high",
      candidateId: "high-cand",
      campaignId: "camp1",
      status: "Pending Manual Send",
      createdAt: new Date(NOW).toISOString(),
    }),
  ];
  s.candidates = [
    candidate({ id: "low-cand", campaignId: "camp1", matchScore: 40, stage: "Contacted", booking: null }),
    candidate({ id: "high-cand", campaignId: "camp1", matchScore: 88, stage: "Contacted", booking: null }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok("higher match score ranks first when no SLA is in play", recs[0]?.id === "approve_outreach:high", recs);
}

/* ---- stage leverage is the final tiebreak when SLA and match score tie ---- */
{
  const s = emptyState();
  s.candidates = [
    candidate({ id: "approve-cand", campaignId: "camp1", matchScore: 70, stage: "Contacted", booking: null }),
    candidate({ id: "book-cand", campaignId: "camp1", matchScore: 70, stage: "Interested", booking: null }),
  ];
  s.outreach = [
    outreachMsg({
      id: "tie-draft",
      candidateId: "approve-cand",
      campaignId: "camp1",
      status: "Needs Approval",
      createdAt: new Date(NOW).toISOString(), // fresh -- must stay approve_outreach, not stalled_draft
    }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok(
    "booking (higher stage leverage) outranks an equal-match approval",
    recs[0]?.kind === "book_interview" && recs[1]?.kind === "approve_outreach",
    recs,
  );
}

/* ---- rollup beyond the cap ------------------------------------------------- */
{
  const s = emptyState();
  const cands: Candidate[] = [];
  const msgs: OutreachMessage[] = [];
  for (let i = 0; i < 12; i++) {
    cands.push(candidate({ id: `cand-${i}`, campaignId: "camp1", matchScore: 50 + i, stage: "Contacted", booking: null }));
    msgs.push(
      outreachMsg({
        id: `draft-${i}`,
        candidateId: `cand-${i}`,
        campaignId: "camp1",
        status: "Needs Approval",
        createdAt: new Date(NOW).toISOString(), // fresh -- must stay approve_outreach, not stalled_draft
      }),
    );
  }
  s.candidates = cands;
  s.outreach = msgs;
  const recs = deriveRecommendations(s, NOW);
  const rollup = recs.find((r) => r.id.endsWith(":rollup"));
  ok("more than the cap produces exactly one rollup row", !!rollup, recs);
  ok("individual rows + rollup account for every item", recs.filter((r) => r.count === 1).length + (rollup?.count ?? 0) === 12, recs);
  ok("rollup sits below the individually-shown items of its kind", recs[recs.length - 1]?.id.endsWith(":rollup") ?? false, recs);
}

/* ---- handled replies / calendar-complete bookings / non-actionable statuses don't surface --- */
{
  const s = emptyState();
  s.replies = [reply({ id: "handled", candidateId: "c1", campaignId: "camp1", intent: "INTERESTED", handled: true })];
  const seedBooking = seed.bookings[0];
  if (!seedBooking) throw new Error("seed bookings required for recommendations fixture");
  const completeBooking = {
    ...seedBooking,
    teamsLink: "https://teams.microsoft.com/l/meetup-join/complete",
    calLink: "https://outlook.office.com/calendar/complete",
  };
  s.candidates = [
    candidate({
      id: "already-booked",
      campaignId: "camp1",
      stage: "Interested",
      booking: completeBooking,
    }),
  ];
  // Sent (not Approved): Approved live messages correctly surface as send_outreach.
  s.outreach = [
    outreachMsg({
      id: "already-sent",
      candidateId: "c1",
      campaignId: "camp1",
      status: "Sent",
      dryRun: false,
      sentAt: new Date(NOW).toISOString(),
    }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok(
    "handled reply, calendar-complete booking, and Sent message stay out of the queue",
    recs.length === 0,
    recs,
  );
}

{
  // Incomplete booking (no teams/cal link) must still recommend book_interview.
  const s = emptyState();
  const seedBooking = seed.bookings[0];
  if (!seedBooking) throw new Error("seed bookings required for recommendations fixture");
  const incomplete = {
    ...seedBooking,
    teamsLink: "",
    calLink: "",
  };
  s.candidates = [
    candidate({ id: "needs-cal", campaignId: "camp1", stage: "Interested", matchScore: 80, booking: incomplete }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok(
    "Interested with booking missing teamsLink/calLink still gets book_interview",
    recs.some((r) => r.kind === "book_interview" && r.id === "book_interview:needs-cal"),
    recs,
  );
}

/* ---- stalled drafts: old unapproved messages escalate, fresh ones don't --- */
{
  const s = emptyState();
  s.candidates = [
    candidate({ id: "stale-cand", campaignId: "camp1", stage: "Contacted", booking: null }),
    candidate({ id: "fresh-approval-cand", campaignId: "camp1", stage: "Contacted", booking: null }),
    candidate({ id: "fresh-draft-cand", campaignId: "camp1", stage: "Contacted", booking: null }),
  ];
  s.outreach = [
    outreachMsg({
      id: "stale-needs-approval",
      candidateId: "stale-cand",
      campaignId: "camp1",
      status: "Needs Approval",
      createdAt: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3d old -- past the 2d threshold
    }),
    outreachMsg({
      id: "fresh-needs-approval",
      candidateId: "fresh-approval-cand",
      campaignId: "camp1",
      status: "Needs Approval",
      createdAt: new Date(NOW).toISOString(),
    }),
    outreachMsg({
      id: "fresh-plain-draft",
      candidateId: "fresh-draft-cand",
      campaignId: "camp1",
      status: "Draft",
      createdAt: new Date(NOW).toISOString(),
    }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok(
    "a Needs Approval message sitting >= 2d escalates to stalled_draft",
    recs.some((r) => r.id === "stalled_draft:stale-needs-approval"),
    recs,
  );
  ok(
    "a fresh Needs Approval message stays approve_outreach, not stalled_draft",
    recs.some((r) => r.id === "approve_outreach:fresh-needs-approval") &&
      !recs.some((r) => r.id === "stalled_draft:fresh-needs-approval"),
    recs,
  );
  ok(
    "a fresh plain Draft (< 2d old) does not surface at all",
    !recs.some((r) => r.id.includes("fresh-plain-draft")),
    recs,
  );
  ok("exactly the stale and fresh-approval items surface -- the fresh Draft stays hidden", recs.length === 2, recs);
}

/* ---- source_campaign: unsourced/under-sourced Sourcing campaigns surface -- */
{
  const s = emptyState();
  s.campaigns = [
    campaign({ id: "camp-empty-sourcing", status: "Sourcing", title: "Unsourced Role" }),
    campaign({ id: "camp-progressed-sourcing", status: "Sourcing", title: "Progressed Role" }),
  ];
  s.candidates = [
    candidate({ id: "progressed-cand", campaignId: "camp-progressed-sourcing", stage: "Contacted", booking: null }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok(
    "a Sourcing campaign with 0 candidates surfaces as source_campaign",
    recs.some((r) => r.id === "source_campaign:camp-empty-sourcing"),
    recs,
  );
  ok(
    "a Sourcing campaign whose candidates have progressed past Sourced does not surface",
    !recs.some((r) => r.id === "source_campaign:camp-progressed-sourcing"),
    recs,
  );
}

/* ---- SLA breach escalation: a breached reply outranks a merely-imminent one, even with a much lower match score --- */
{
  const s = emptyState();
  s.candidates = [
    candidate({ id: "breached-cand", campaignId: "camp1", matchScore: 10, stage: "Contacted", booking: null }),
    candidate({ id: "imminent-cand", campaignId: "camp1", matchScore: 95, stage: "Contacted", booking: null }),
  ];
  s.replies = [
    reply({
      id: "breached-reply",
      candidateId: "breached-cand",
      campaignId: "camp1",
      intent: "INTERESTED",
      handled: false,
      slaDueAt: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h overdue -- breached
    }),
    reply({
      id: "imminent-reply",
      candidateId: "imminent-cand",
      campaignId: "camp1",
      intent: "INTERESTED",
      handled: false,
      slaDueAt: new Date(NOW + 5 * 60 * 1000).toISOString(), // 5min out -- imminent, not yet breached
    }),
  ];
  const recs = deriveRecommendations(s, NOW);
  ok("both hot replies present", recs.length === 2, recs);
  ok(
    "a breached reply outranks a merely-imminent one despite a 85-point lower match score",
    recs[0]?.id === "hot_reply:breached-reply" && recs[1]?.id === "hot_reply:imminent-reply",
    recs,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
