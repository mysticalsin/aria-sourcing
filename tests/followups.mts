/* ============================================================================
   tests/followups.mts
   Area: m5 follow-up guardrails (deferred item #4) — regression coverage for
   three rules that had zero prior test coverage:

     1. lastRepliedAt stale-draft blocker — checkOutreachApproval (rules.ts:79-81).
        Real, exported, pure function — imported and exercised directly.

     2. OOO-is-not-a-real-reply carve-out — deriveFollowUpsDue (recommendations.ts:137-170)
        + the stage-not-advance branch in classifyAndStoreReply (store.ts:2058-2061).
        deriveFollowUpsDue is real/exported/pure and imported directly. The
        stage-not-advance branch lives inside a React useCallback in the
        useHermesStore hook (store.ts:1902) and is not unit-reachable without
        rendering the hook — that half is a CONTRACT test that mirrors the exact
        ternary at store.ts:2061. Keep the two in sync.

     3. NEGATIVE-reply auto-reject-pending-drafts — store.ts:2216-2228, inside the
        same applyReplyAction useCallback (store.ts:2161). Also a CONTRACT test,
        same reasoning as #2. This mirrors the established pattern in
        tests/outreach-guardrails.mts (which does the same thing for the
        un-exported sanitizeHeader in the send route) — see that file's header
        for the rationale.

   Run: tsx tests/followups.mts
   ========================================================================== */

import { checkOutreachApproval, type ApprovalContext } from "../src/lib/rules";
import { deriveFollowUpsDue } from "../src/lib/recommendations";
import { buildSeedState } from "../src/lib/seed";
import type {
  Candidate,
  CandidateStage,
  ClassifiedReply,
  OutreachMessage,
  OutreachStatus,
  ReplyIntent,
} from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const seed = buildSeedState();
const settings = seed.settings;
const templateCandidate = seed.candidates[0];
ok("seed has a template candidate to clone", !!templateCandidate);

function makeCandidate(overrides: Partial<Candidate>): Candidate {
  return { ...templateCandidate, ...overrides };
}

function makeMessage(overrides: Partial<OutreachMessage>): OutreachMessage {
  return {
    id: "msg_1",
    candidateId: "cand_1",
    campaignId: templateCandidate.campaignId,
    channel: "Email",
    subject: "Quick question about your role",
    body: "Hi there, ...",
    tone: "Casual Professional",
    personalizationEvidence: ["Mentioned their recent open-source contribution."],
    status: "Needs Approval",
    sequenceStep: 2,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ===========================================================================
   1. lastRepliedAt stale-draft blocker (real, exported: checkOutreachApproval)
   ========================================================================= */
{
  const draftCreatedAt = "2026-06-01T00:00:00.000Z";
  const candidateBase = makeCandidate({
    id: "cand_stale",
    matchScore: 90,
    email: "stale@example.com",
    linkedinUrl: "https://linkedin.com/in/stale",
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
  });
  const message = makeMessage({ candidateId: "cand_stale", createdAt: draftCreatedAt });
  const ctx = (candidate: Candidate): ApprovalContext => ({
    candidate,
    message,
    settings,
    emailsSentToday: 0,
    linkedinSentToday: 0,
  });

  const repliedAfter = checkOutreachApproval(
    ctx({ ...candidateBase, lastRepliedAt: "2026-06-02T00:00:00.000Z" }),
  );
  ok(
    "reply after draft.createdAt blocks approval with the stale-draft reason",
    !repliedAfter.allowed &&
      repliedAfter.blockers.some((b) => b.includes("replied since this follow-up was drafted")),
  );

  const repliedBefore = checkOutreachApproval(
    ctx({ ...candidateBase, lastRepliedAt: "2026-05-31T00:00:00.000Z" }),
  );
  ok(
    "reply before draft.createdAt does not trigger the stale-draft blocker",
    !repliedBefore.blockers.some((b) => b.includes("replied since this follow-up was drafted")),
  );

  const neverReplied = checkOutreachApproval(ctx({ ...candidateBase, lastRepliedAt: null }));
  ok(
    "no reply on record at all does not trigger the stale-draft blocker",
    !neverReplied.blockers.some((b) => b.includes("replied since this follow-up was drafted")),
  );
}

/* ===========================================================================
   2a. OOO carve-out in the real follow-up due-queue (deriveFollowUpsDue)
   ========================================================================= */
{
  const NOW = Date.parse("2026-06-10T00:00:00.000Z");
  const gapDays = settings.rateLimits.followUpGapDays;
  const staleContactedAt = new Date(NOW - (gapDays + 5) * 86_400_000).toISOString();
  const oooReplyAt = new Date(NOW - (gapDays + 2) * 86_400_000).toISOString();

  const cleanCompliance = {
    doNotContact: false,
    suppressed: false,
    unsubscribed: false,
    gdprExportRequested: false,
    anonymized: false,
    suppressedUntil: null,
  };

  const oooCandidate = makeCandidate({
    id: "cand_ooo",
    stage: "Contacted" as CandidateStage,
    lastContactedAt: staleContactedAt,
    complianceFlags: cleanCompliance,
    replyHistory: [{ id: "rh_ooo", intent: "OOO" as ReplyIntent, confidence: 0.9, excerpt: "Out of office", at: oooReplyAt }],
  });
  const realReplyCandidate = makeCandidate({
    id: "cand_real_reply",
    stage: "Contacted" as CandidateStage,
    lastContactedAt: staleContactedAt,
    complianceFlags: cleanCompliance,
    replyHistory: [
      { id: "rh_real", intent: "NOT_INTERESTED" as ReplyIntent, confidence: 0.9, excerpt: "Not interested", at: oooReplyAt },
    ],
  });

  const oooReply: ClassifiedReply = {
    id: "reply_ooo",
    candidateId: "cand_ooo",
    campaignId: templateCandidate.campaignId,
    channel: "Email",
    body: "Out of office until next week.",
    intent: "OOO",
    confidence: 0.9,
    reasoning: "Auto-responder",
    suggestedAction: "Wait and retry",
    draftResponse: "",
    handled: true,
    slaDueAt: null,
    receivedAt: oooReplyAt,
  };
  const realReply: ClassifiedReply = {
    ...oooReply,
    id: "reply_real",
    candidateId: "cand_real_reply",
    intent: "NOT_INTERESTED",
    body: "Not interested, thanks.",
  };

  const state = {
    ...seed,
    candidates: [oooCandidate, realReplyCandidate],
    replies: [oooReply, realReply],
    outreach: [] as OutreachMessage[],
  };

  const due = deriveFollowUpsDue(state, NOW);
  ok(
    "an OOO-only reply does not block follow-up nomination",
    due.some((d) => d.candidateId === "cand_ooo"),
  );
  ok(
    "a real (non-OOO) reply blocks follow-up nomination",
    !due.some((d) => d.candidateId === "cand_real_reply"),
  );
}

/* ===========================================================================
   2b. OOO stage-not-advance branch — CONTRACT test mirroring
       store.ts:2058-2061 (classifyAndStoreReply). See file header.
   ========================================================================= */
function stageAfterReply(currentStage: CandidateStage, intent: ReplyIntent): CandidateStage {
  return currentStage === "Contacted" && intent !== "OOO" ? "Replied" : currentStage;
}
{
  ok(
    "OOO reply leaves stage at Contacted (no advance to Replied)",
    stageAfterReply("Contacted", "OOO") === "Contacted",
  );
  ok(
    "a real reply (e.g. NOT_INTERESTED) advances Contacted -> Replied",
    stageAfterReply("Contacted", "NOT_INTERESTED") === "Replied",
  );
  ok(
    "OOO on an already-past-Contacted stage is a no-op",
    stageAfterReply("Replied", "OOO") === "Replied",
  );
}

/* ===========================================================================
   3. NEGATIVE-reply auto-reject-pending-drafts — CONTRACT test mirroring
      store.ts:2216-2228 (applyReplyAction). See file header.
   ========================================================================= */
function applyNegativeAutoReject(outreach: OutreachMessage[], candidateId: string): OutreachMessage[] {
  return outreach.map((m) =>
    m.candidateId === candidateId && (m.status === "Needs Approval" || m.status === "Approved")
      ? { ...m, status: "Rejected" as OutreachStatus }
      : m,
  );
}
{
  const targetId = "cand_negative";
  const otherId = "cand_other";
  const before: OutreachMessage[] = [
    makeMessage({ id: "m_needs_approval", candidateId: targetId, status: "Needs Approval" }),
    makeMessage({ id: "m_approved", candidateId: targetId, status: "Approved" }),
    makeMessage({ id: "m_draft", candidateId: targetId, status: "Draft" }),
    makeMessage({ id: "m_pending_manual", candidateId: targetId, status: "Pending Manual Send" }),
    makeMessage({ id: "m_other_needs_approval", candidateId: otherId, status: "Needs Approval" }),
  ];
  const after = applyNegativeAutoReject(before, targetId);
  const byId = new Map(after.map((m) => [m.id, m]));

  ok("NEGATIVE reply rejects a Needs Approval draft for the same candidate", byId.get("m_needs_approval")?.status === "Rejected");
  ok("NEGATIVE reply rejects an Approved (pre-send) draft for the same candidate", byId.get("m_approved")?.status === "Rejected");
  ok("NEGATIVE reply does not touch a plain Draft for the same candidate", byId.get("m_draft")?.status === "Draft");
  ok(
    "NEGATIVE reply does not touch Pending Manual Send (LinkedIn assisted-manual, already handed to operator)",
    byId.get("m_pending_manual")?.status === "Pending Manual Send",
  );
  ok("NEGATIVE reply does not touch another candidate's pending draft", byId.get("m_other_needs_approval")?.status === "Needs Approval");
}

console.log(`RESULT followups: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
