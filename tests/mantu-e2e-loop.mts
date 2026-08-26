import assert from "node:assert/strict";
import { validateOutreachQuality } from "../src/lib/outreach-quality-pipeline";
import { mantuEmailHtmlWrapper, MANTU_COLORS } from "../src/lib/mantu-brand";
import { routeInboundEmail } from "../src/lib/inbound-email-router";
import { runRecruitingGraph, rankTopCandidates } from "../src/lib/langchain/recruiting-graph";
import { TOP_CANDIDATE_SHORTLIST_SIZE } from "../src/lib/recruiting-loop/constants";

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
  "empathetic personalized draft passes quality pipeline",
  validateOutreachQuality({
    subject: "Your TypeScript platform work at Acme",
    body: "Hi Alex,\n\nI noticed your recent work on TypeScript tooling at Acme — the way you structured the migration stood out. Mantu Group is hiring a senior platform engineer in London and I thought of you.\n\nWould you be open to a short first conversation to explore whether the role could be a fit?\n\nBest regards,\nMantu Talent Team",
    channel: "Email",
  }).status === "ready",
);

ok(
  "generic opener flagged for review or block",
  ["needs_review", "blocked"].includes(
    validateOutreachQuality({
      subject: "Exciting opportunity",
      body: "I hope this email finds you well. We are looking for someone like you for an exciting opportunity.",
      channel: "Email",
    }).status,
  ),
);

ok(
  "salary disclosure blocked",
  validateOutreachQuality({
    subject: "Role",
    body: "The salary is £120k and we think you would be perfect.",
    channel: "Email",
  }).status === "blocked",
);

ok("mantu email html includes brand purple", mantuEmailHtmlWrapper("Hello").includes(MANTU_COLORS.purple));

ok(
  "hiring need routes to requisition_parse",
  routeInboundEmail({
    record: { ok: true, inbound_id: "inb-1", duplicate: false },
    from: "noreply@mantu.example",
    subject: "This need is now ACTIVE: Senior Engineer",
    body: "Role: Senior Engineer\nLocation: London\nSkills: TypeScript",
    mailbox: "ops@mantu.com",
  }).route === "hiring_need",
);

ok(
  "reply with inReplyTo routes to classify",
  routeInboundEmail({
    record: { ok: true, inbound_id: "inb-2", duplicate: false },
    from: "candidate@example.com",
    subject: "Re: Your note",
    body: "Thanks — I'm interested.",
    mailbox: "ops@mantu.com",
    inReplyTo: "<msg-123>",
    correlated: true,
  }).route === "reply_classify",
);

ok(
  "rankTopCandidates returns top 10",
  rankTopCandidates(
    Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, matchScore: i * 5 })),
    TOP_CANDIDATE_SHORTLIST_SIZE,
  ).length === 10,
);

void runRecruitingGraph({
  workspaceId: "ws-1",
  inboundId: "inb-1",
  candidateIds: ["a", "b", "c"],
  drafts: {
    a: {
      subject: "Your work",
      body: "Hi Sam, I noticed your recent React work and wondered if you would be open to a brief chat about a senior role at Mantu.",
      channel: "Email",
    },
  },
}).then((state) => {
  ok(
    "langgraph recruiting pipeline completes",
    ["queued_for_approval", "approval_blocked", "interview_scheduled"].includes(state.stage),
  );
  console.log(`RESULT mantu-e2e-loop: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
});
