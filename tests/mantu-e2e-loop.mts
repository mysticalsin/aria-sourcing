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
  "rankTopCandidates returns top 10 above min score",
  rankTopCandidates(
    Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, matchScore: 95 - i })),
    TOP_CANDIDATE_SHORTLIST_SIZE,
  ).length === 10,
);

ok(
  "rankTopCandidates drops below-min-score candidates",
  rankTopCandidates(
    [
      { id: "low", matchScore: 40 },
      { id: "mid", matchScore: 69 },
      { id: "ok", matchScore: 70 },
    ],
    TOP_CANDIDATE_SHORTLIST_SIZE,
  ).map((c) => c.id).join(",") === "ok",
);

ok(
  "rankTopCandidates honors workspace minScore below default",
  rankTopCandidates(
    [
      { id: "low", matchScore: 40 },
      { id: "mid", matchScore: 65 },
      { id: "ok", matchScore: 70 },
    ],
    TOP_CANDIDATE_SHORTLIST_SIZE,
    60,
  ).map((c) => c.id).join(",") === "ok,mid",
);

void (async () => {
  const scored = [
    { id: "a", matchScore: 90 },
    { id: "b", matchScore: 80 },
    { id: "c", matchScore: 70 },
  ];
  const state = await runRecruitingGraph({
    workspaceId: "ws-1",
    inboundId: "inb-1",
    campaignId: "camp-1",
    candidateIds: ["a", "b", "c"],
    scoredCandidates: scored,
    preferLiveCritics: false,
    drafts: {
      a: {
        subject: "Your work",
        body: "Hi Sam, I noticed your recent React work and wondered if you would be open to a brief chat about a senior role at Mantu.",
        channel: "Email",
      },
    },
  });
  ok(
    "langgraph recruiting pipeline ends at approval without bookingId",
    state.stage === "queued_for_approval" || state.stage === "approval_blocked",
  );
  ok("langgraph does not fake interview_scheduled without bookingId", state.stage !== "interview_scheduled");

  const booked = await runRecruitingGraph({
    workspaceId: "ws-1",
    inboundId: "inb-1",
    campaignId: "camp-1",
    candidateIds: ["a"],
    scoredCandidates: [{ id: "a", matchScore: 95 }],
    bookingId: "book-1",
    preferLiveCritics: false,
    drafts: {
      a: {
        subject: "Your work",
        body: "Hi Sam, I noticed your recent React work and wondered if you would be open to a brief chat about a senior role at Mantu.",
        channel: "Email",
      },
    },
  });
  ok(
    "langgraph reports interview_scheduled only with bookingId",
    booked.stage === "interview_scheduled" || booked.stage === "approval_blocked",
  );

  // intent:full defaults to live critics — without peers must fail closed (not invent approval).
  const fullLiveRequired = await runRecruitingGraph({
    workspaceId: "ws-1",
    inboundId: "inb-1",
    campaignId: "camp-1",
    candidateIds: ["a"],
    scoredCandidates: [{ id: "a", matchScore: 95 }],
    drafts: {
      a: {
        subject: "Your work",
        body: "Hi Sam, I noticed your recent React work and wondered if you would be open to a brief chat about a senior role at Mantu.",
        channel: "Email",
      },
    },
  });
  ok(
    "full intent defaults to live critics fail-closed without peers",
    fullLiveRequired.stage === "quality_critics_incomplete"
      || fullLiveRequired.stage === "queued_for_approval"
      || fullLiveRequired.stage === "approval_blocked",
  );
  ok(
    "full intent default path never invents interview_scheduled without bookingId",
    fullLiveRequired.stage !== "interview_scheduled",
  );

  const failed = await runRecruitingGraph({
    workspaceId: "ws-1",
    candidateIds: ["a"],
  });
  ok("langgraph fail-stops on missing inboundId", failed.stage === "parse_requisition_failed");

  const failedCampaign = await runRecruitingGraph({
    workspaceId: "ws-1",
    inboundId: "inb-1",
  });
  ok("langgraph fail-stops on missing campaignId", failedCampaign.stage === "parse_requisition_failed");

  const emptySource = await runRecruitingGraph({
    intent: "source_only",
    workspaceId: "ws-1",
    campaignId: "camp-1",
    candidateIds: [],
  });
  ok("langgraph fail-stops source_only without candidates", emptySource.stage === "sourcing_failed");

  const unscoredRank = await runRecruitingGraph({
    intent: "rank_only",
    workspaceId: "ws-1",
    candidateIds: ["c1", "c2"],
  });
  ok("langgraph fail-stops rank_only without scores", unscoredRank.stage === "shortlist_rank_failed");

  const draftOnly = await runRecruitingGraph({
    intent: "draft_quality",
    workspaceId: "ws-1",
    candidateIds: ["a"],
    preferLiveCritics: false,
    drafts: {
      a: {
        subject: "Your work",
        body: "Hi Sam, I noticed your recent React work and wondered if you would be open to a brief chat about a senior role at Mantu.",
        channel: "Email",
      },
    },
  });
  ok(
    "draft_quality intent never claims interview_scheduled",
    draftOnly.stage === "queued_for_approval" || draftOnly.stage === "approval_blocked",
  );

  const draftLiveRequired = await runRecruitingGraph({
    intent: "draft_quality",
    workspaceId: "ws-1",
    candidateIds: ["a"],
    drafts: {
      a: {
        subject: "Your work",
        body: "Hi Sam, I noticed your recent React work and wondered if you would be open to a brief chat about a senior role at Mantu.",
        channel: "Email",
      },
    },
  });
  ok(
    "draft_quality defaults to live critics fail-closed without peers",
    draftLiveRequired.stage === "quality_critics_incomplete"
      || draftLiveRequired.stage === "queued_for_approval"
      || draftLiveRequired.stage === "approval_blocked",
  );
  ok(
    "draft_quality default path never invents interview_scheduled",
    draftLiveRequired.stage !== "interview_scheduled",
  );

  const emptyDrafts = await runRecruitingGraph({
    intent: "draft_quality",
    workspaceId: "ws-1",
    candidateIds: ["a"],
    drafts: {},
  });
  ok("draft_quality fail-stops on empty drafts", emptyDrafts.stage === "draft_failed");

  const parseOnly = await runRecruitingGraph({
    intent: "parse_only",
    workspaceId: "ws-1",
    inboundId: "inb-1",
    campaignId: "camp-1",
  });
  ok("parse_only checkpoint lands on requisition_parsed", parseOnly.stage === "requisition_parsed");

  const sourceOnly = await runRecruitingGraph({
    intent: "source_only",
    workspaceId: "ws-1",
    campaignId: "camp-1",
    candidateIds: ["c1", "c2"],
  });
  ok("source_only checkpoint lands on sourcing_complete", sourceOnly.stage === "sourcing_complete");

  const rankOnly = await runRecruitingGraph({
    intent: "rank_only",
    workspaceId: "ws-1",
    candidateIds: ["c1", "c2", "c3"],
    scoredCandidates: [
      { id: "c1", matchScore: 90 },
      { id: "c2", matchScore: 80 },
      { id: "c3", matchScore: 70 },
    ],
  });
  ok(
    "rank_only checkpoint lands on shortlist_ranked",
    rankOnly.stage === "shortlist_ranked" && rankOnly.shortlistIds[0] === "c1",
  );

  const rankWorkspaceFloor = await runRecruitingGraph({
    intent: "rank_only",
    workspaceId: "ws-1",
    candidateIds: ["low", "mid"],
    scoredCandidates: [
      { id: "low", matchScore: 55 },
      { id: "mid", matchScore: 65 },
    ],
    shortlistMinScore: 60,
  });
  ok(
    "rank_only uses workspace shortlistMinScore (not hardcoded 70)",
    rankWorkspaceFloor.stage === "shortlist_ranked"
      && rankWorkspaceFloor.shortlistIds.join(",") === "mid",
  );

  const rankWorkspaceFloorEmpty = await runRecruitingGraph({
    intent: "rank_only",
    workspaceId: "ws-1",
    candidateIds: ["low"],
    scoredCandidates: [{ id: "low", matchScore: 55 }],
    shortlistMinScore: 60,
  });
  ok(
    "rank_only fail-stops when workspace floor clears nobody",
    rankWorkspaceFloorEmpty.stage === "shortlist_rank_failed",
  );

  const bookWithoutId = await runRecruitingGraph({
    intent: "book_only",
    workspaceId: "ws-1",
  });
  ok(
    "book_only without bookingId never claims interview_scheduled",
    bookWithoutId.stage === "interview_proposed" && bookWithoutId.stage !== "interview_scheduled",
  );

  console.log(`RESULT mantu-e2e-loop: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
