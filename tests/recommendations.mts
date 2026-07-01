/* tests/recommendations.mts — area: recommendations
 * Tests src/lib/recommendations.ts's deriveRecommendations: priority ordering
 * (SLA risk > match score > stage leverage), rollup grouping beyond the cap,
 * and that fully-clear state produces an empty queue.
 */
import { deriveRecommendations } from "../src/lib/recommendations";
import { buildSeedState } from "../src/lib/seed";
import type { Candidate, ClassifiedReply, OutreachMessage, HermesState } from "../src/lib/types";

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
const seed = buildSeedState();
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

function candidate(overrides: Partial<Candidate>): Candidate {
  return { ...candidateTemplate, ...overrides };
}
function reply(overrides: Partial<ClassifiedReply>): ClassifiedReply {
  return { ...replyTemplate, ...overrides };
}
function outreachMsg(overrides: Partial<OutreachMessage>): OutreachMessage {
  return { ...outreachTemplate, ...overrides };
}

function emptyState(): HermesState {
  return { ...seed, candidates: [], outreach: [], replies: [] };
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
    outreachMsg({ id: "low", candidateId: "low-cand", campaignId: "camp1", status: "Needs Approval" }),
    outreachMsg({ id: "high", candidateId: "high-cand", campaignId: "camp1", status: "Pending Manual Send" }),
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
    outreachMsg({ id: "tie-draft", candidateId: "approve-cand", campaignId: "camp1", status: "Needs Approval" }),
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
    msgs.push(outreachMsg({ id: `draft-${i}`, candidateId: `cand-${i}`, campaignId: "camp1", status: "Needs Approval" }));
  }
  s.candidates = cands;
  s.outreach = msgs;
  const recs = deriveRecommendations(s, NOW);
  const rollup = recs.find((r) => r.id.endsWith(":rollup"));
  ok("more than the cap produces exactly one rollup row", !!rollup, recs);
  ok("individual rows + rollup account for every item", recs.filter((r) => r.count === 1).length + (rollup?.count ?? 0) === 12, recs);
  ok("rollup sits below the individually-shown items of its kind", recs[recs.length - 1]?.id.endsWith(":rollup") ?? false, recs);
}

/* ---- handled replies / already-booked candidates / non-actionable statuses don't surface --- */
{
  const s = emptyState();
  s.replies = [reply({ id: "handled", candidateId: "c1", campaignId: "camp1", intent: "INTERESTED", handled: true })];
  s.candidates = [
    candidate({ id: "already-booked", campaignId: "camp1", stage: "Interested", booking: seed.bookings[0] ?? null }),
  ];
  s.outreach = [outreachMsg({ id: "already-approved", candidateId: "c1", campaignId: "camp1", status: "Approved" })];
  const recs = deriveRecommendations(s, NOW);
  ok("handled reply, already-booked candidate, and approved message all stay out of the queue", recs.length === 0, recs);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
