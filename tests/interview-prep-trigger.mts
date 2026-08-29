import {
  decideInterviewPrepEnqueue,
  parsePrepEmailTemplate,
} from "../src/lib/interview-prep-trigger";
import { buildInterviewPrepOutreach } from "../src/lib/interview-prep-dispatch";
import { buildHistoricalDemoSeedState } from "../src/lib/seed";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "skips when no provider event",
  decideInterviewPrepEnqueue({ bookingId: "bk-1", candidateId: "c-1", campaignId: "camp-1" })
    .enqueue === false,
);
ok(
  "enqueues when provider event created",
  decideInterviewPrepEnqueue({
    bookingId: "bk-1",
    candidateId: "c-1",
    campaignId: "camp-1",
    providerEventCreated: true,
  }).enqueue === true,
);
const decision = decideInterviewPrepEnqueue({
  bookingId: "bk-1",
  candidateId: "c-1",
  campaignId: "camp-1",
  providerEventCreated: true,
});
if (decision.enqueue) {
  ok("kind interview_prep_send", decision.kind === "interview_prep_send");
  ok("idempotency scoped to booking", decision.idempotencyKey === "prep:bk-1");
  ok("trigger create_booking", decision.payload.trigger === "create_booking");
}

const parsed = parsePrepEmailTemplate("Subject: Hello\n\nBody text");
ok("parse subject", parsed.subject === "Hello");
ok("parse body", parsed.body === "Body text");

const seed = buildHistoricalDemoSeedState();
const candidate = seed.candidates[0];
const campaign = seed.campaigns.find((c) => c.id === candidate.campaignId)!;
const booking = seed.bookings[0];
const outreach = buildInterviewPrepOutreach({ booking, candidate, campaign });
ok("builds two prep drafts", outreach.length === 2);
ok("both need approval", outreach.every((m) => m.status === "Needs Approval"));
ok("both dry-run", outreach.every((m) => m.dryRun === true));
ok(
  "prep drafts honest about critics (needs_review, not fake ready/100)",
  outreach.every(
    (m) =>
      m.qualityStatus === "needs_review"
      && m.qualityCriticsUsed === false
      && (m.qualityScore ?? 0) < 100,
  ),
);
ok(
  "prep drafts name Mantu in plain body",
  outreach.every((m) => /Mantu/.test(m.body) && /Aria · Mantu Group/.test(m.body)),
);
ok("interviewer override when email present", Boolean(outreach[0].recipientOverride || !booking.interviewerEmail));
ok("candidate confirmation purpose", outreach[1].prepPurpose === "candidate_confirmation");

console.log(`RESULT interview-prep: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
