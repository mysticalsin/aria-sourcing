/* tests/pipeline.mts — area: pipeline
 * Tests src/lib/pipeline.ts (columns by next action, overdue flags, sorting,
 * closed/pooled counts) against the seed.
 * Run: tsx tests/pipeline.mts
 */
import { buildPipeline, lastActivityAt, pipelineColumnFor, PIPELINE_COLUMNS } from "../src/lib/pipeline";
import { buildSeedState } from "../src/lib/seed";
import { CANDIDATE_STAGES, type Candidate } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const NOW = new Date("2026-07-01T09:00:00.000Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const base = buildSeedState().candidates[0];
function cand(over: Partial<Candidate>): Candidate {
  return {
    ...base,
    notes: [],
    interviews: [],
    booking: null,
    lastContactedAt: null,
    lastRepliedAt: null,
    vivier: false,
    complianceFlags: { ...base.complianceFlags, doNotContact: false, suppressed: false, unsubscribed: false },
    ...over,
  };
}
const opts = { now: NOW, followUpGapDays: 3 };

/* ---- column mapping ------------------------------------------------------ */
const mapped = CANDIDATE_STAGES.filter((s) => pipelineColumnFor(s));
ok("every active stage has exactly one column", mapped.every((s) => PIPELINE_COLUMNS.filter((c) => c.stages.includes(s)).length === 1));
ok("closed stages have no column", ["Rejected", "Not Interested", "Suppressed"].every((s) => pipelineColumnFor(s as Candidate["stage"]) === null));
ok("Booked and Interviewed share Interviewing", pipelineColumnFor("Booked")?.key === "interviewing" && pipelineColumnFor("Interviewed")?.key === "interviewing");
ok("only human-decision columns accept drops", PIPELINE_COLUMNS.filter((c) => c.dropStage).map((c) => c.dropStage).join() === "Interviewed,Offer,Hired");

/* ---- last activity ------------------------------------------------------- */
ok("future booking is not activity", lastActivityAt(cand({ createdAt: daysAgo(5), booking: { ...({} as NonNullable<Candidate["booking"]>), startTime: daysAgo(-2) } }), NOW) === NOW - 5 * 86_400_000);
ok("a note counts as activity", lastActivityAt(cand({ createdAt: daysAgo(5), notes: [{ id: "n", text: "x", at: daysAgo(1) }] }), NOW) === NOW - 86_400_000);

/* ---- overdue ------------------------------------------------------------- */
const board = buildPipeline(
  [
    cand({ id: "fresh", stage: "Sourced", createdAt: daysAgo(1), matchScore: 90 }),
    cand({ id: "old", stage: "Sourced", createdAt: daysAgo(4), matchScore: 60 }),
    cand({ id: "older", stage: "Sourced", createdAt: daysAgo(9), matchScore: 50 }),
    cand({ id: "silent", stage: "Contacted", createdAt: daysAgo(10), lastContactedAt: daysAgo(3) }),
    cand({ id: "quiet", stage: "Contacted", createdAt: daysAgo(10), lastContactedAt: daysAgo(2), notes: [{ id: "n", text: "x", at: daysAgo(0) }] }),
    cand({ id: "optout", stage: "Contacted", createdAt: daysAgo(10), lastContactedAt: daysAgo(8), complianceFlags: { ...base.complianceFlags, unsubscribed: true } }),
    cand({ id: "hired", stage: "Hired", createdAt: daysAgo(90) }),
    cand({ id: "rej", stage: "Rejected" }),
    cand({ id: "pool", stage: "Not Interested", vivier: true }),
  ],
  opts,
);
const ids = (k: keyof typeof board.columns) => board.columns[k].map((e) => e.candidate.id).join();
ok("overdue first, longest wait on top, then score", ids("toContact") === "older,old,fresh");
ok("awaiting reply uses the follow-up gap", board.columns.awaitingReply.find((e) => e.candidate.id === "silent")?.overdue === true);
ok("awaiting reply counts from the last message, not the last note", board.columns.awaitingReply.find((e) => e.candidate.id === "quiet")?.waitingDays === 2);
ok("opted-out candidates are never overdue", board.columns.awaitingReply.find((e) => e.candidate.id === "optout")?.overdue === false);
ok("hired never overdue", board.columns.hired[0]?.overdue === false);
ok("overdue total", board.overdue === 3);
ok("closed and pooled counted apart", board.closed === 1 && board.pooled === 1);

/* ---- seed ---------------------------------------------------------------- */
const seed = buildSeedState();
const seeded = buildPipeline(seed.candidates, opts);
const placed = Object.values(seeded.columns).reduce((n, l) => n + l.length, 0);
ok("every seed candidate is placed or counted", placed + seeded.closed + seeded.pooled === seed.candidates.length);

console.log(`\npipeline.mts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
