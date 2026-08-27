/* ============================================================================
   tests/rules-confidential.mts
   Area: rules — exercises src/lib/rules.ts + src/lib/confidential.ts
   Run via tsx (not run here; sandbox blocks the runtime). Assertions are
   derived from the real source behavior, favouring robust invariants.
   ========================================================================== */

import {
  checkOutreachApproval,
  dedupeCandidates,
  type ApprovalContext,
} from "../src/lib/rules";
import {
  applyConfidentiality,
  hasOutreachPurpose,
  maskEmailBody,
} from "../src/lib/confidential";
import { recordedCandidateLawfulBasis } from "../src/lib/candidate-lawful-basis";
import { buildSeedState, defaultSettings } from "../src/lib/seed";
import { historicalSeedState } from "./seed-fixtures.mts";
import type { Candidate, OutreachMessage, SystemSettings } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- Factories ----------------------------------------------------------- */

function makeCandidate(over: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    id: "cand_test",
    campaignId: "camp_test",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    avatarInitials: "JS",
    currentTitle: "Senior Backend Engineer",
    currentCompany: "GoodCo",
    location: "Berlin, DE",
    timezone: "CET",
    linkedinUrl: "https://www.linkedin.com/in/jane-smith-1234",
    githubUrl: "https://github.com/janesmith",
    sourcePlatform: "GitHub",
    sourceQuery: "language:Go",
    matchScore: 90,
    matchBreakdown: [],
    techStack: ["Go", "Kubernetes"],
    yearsExperience: 7,
    companyStageExperience: ["Series A"],
    industryExperience: ["Fintech"],
    recentActivity: "Shipped a gRPC gateway last month.",
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    lawfulBasis: "legitimate_interest",
    lawfulBasisSource: "operator_selection",
    lawfulBasisRecordedAt: "2026-07-13T06:00:00.000Z",
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...over, complianceFlags: { ...base.complianceFlags, ...(over.complianceFlags ?? {}) } };
}

function makeMessage(over: Partial<OutreachMessage> = {}): OutreachMessage {
  const base: OutreachMessage = {
    id: "msg_test",
    candidateId: "cand_test",
    campaignId: "camp_test",
    channel: "Email",
    subject: "Quick question about your gRPC work",
    body: "Hi Jane, saw your recent gateway work...",
    tone: "Casual Professional",
    personalizationEvidence: ["Shipped a gRPC gateway last month."],
    status: "Needs Approval",
    sequenceStep: 1,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...over };
}

function approvalCtx(over: Partial<ApprovalContext> = {}): ApprovalContext {
  const settings = defaultSettings();
  return {
    candidate: makeCandidate(),
    message: makeMessage(),
    settings,
    emailsSentToday: 0,
    linkedinSentToday: 0,
    ...over,
  };
}

/* ========================================================================== */
/* checkOutreachApproval                                                       */
/* ========================================================================== */

// settings.minScoreToContact defaults to 80.
const settings: SystemSettings = defaultSettings();
ok("settings minScoreToContact is the 80 floor", settings.minScoreToContact === 80);
ok("settings emailsPerDay is positive", settings.rateLimits.emailsPerDay > 0);

// 1) Blocks when matchScore < minScoreToContact.
{
  const ctx = approvalCtx({ candidate: makeCandidate({ matchScore: settings.minScoreToContact - 20 }) });
  const r = checkOutreachApproval(ctx);
  ok("low score: not allowed", r.allowed === false);
  ok("low score: blocker mentions floor/below", r.blockers.some((b) => /below|floor|score/i.test(b)));
  ok("low score: at least one blocker", r.blockers.length >= 1);
}

// 1b) Operator fit endorsement warn-through for below-floor live leads.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({
      matchScore: settings.minScoreToContact - 20,
      fitEndorsedAt: "2026-07-13T06:00:00.000Z",
      fitEndorsedSource: "operator_selection",
    }),
  });
  const r = checkOutreachApproval(ctx);
  ok("endorsed low score: allowed", r.allowed === true);
  ok(
    "endorsed low score: warning mentions endorsement",
    r.warnings.some((w) => /endorsed|below/i.test(w)),
  );
  ok("endorsed low score: no score blocker", !r.blockers.some((b) => /below|floor/i.test(b)));
}

// 2) Blocks when personalizationEvidence is empty.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({ matchScore: 95 }),
    message: makeMessage({ personalizationEvidence: [] }),
  });
  const r = checkOutreachApproval(ctx);
  ok("no personalization: not allowed", r.allowed === false);
  ok("no personalization: blocker mentions personalization", r.blockers.some((b) => /personaliz/i.test(b)));
}

// 3) Blocks when emailsSentToday >= emailsPerDay.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({ matchScore: 95 }),
    message: makeMessage({ channel: "Email" }),
    emailsSentToday: settings.rateLimits.emailsPerDay,
  });
  const r = checkOutreachApproval(ctx);
  ok("at email limit: not allowed", r.allowed === false);
  ok("at email limit: blocker mentions limit", r.blockers.some((b) => /limit/i.test(b)));
}

// 3b) Same channel/limit logic holds for LinkedIn.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({ matchScore: 95 }),
    message: makeMessage({ channel: "LinkedIn" }),
    linkedinSentToday: settings.rateLimits.linkedinPerDay,
  });
  const r = checkOutreachApproval(ctx);
  ok("at linkedin limit: not allowed", r.allowed === false);
  ok("at linkedin limit: blocker mentions LinkedIn limit", r.blockers.some((b) => /LinkedIn/i.test(b) && /limit/i.test(b)));
}

// 3c) LinkedIn assisted-manual requires a profile URL.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({ matchScore: 95, linkedinUrl: "" }),
    message: makeMessage({ channel: "LinkedIn" }),
  });
  const r = checkOutreachApproval(ctx);
  ok("linkedin without profile url: not allowed", r.allowed === false);
  ok("linkedin without profile url: blocker mentions LinkedIn profile", r.blockers.some((b) => /LinkedIn profile/i.test(b)));
}

// 3d) Phone channels must not advance without a recipient. SMS is deliberately
// disabled until it has an equivalent consent/suppression delivery policy.
{
  const noPhone = checkOutreachApproval(
    approvalCtx({ candidate: makeCandidate({ phone: "" }), message: makeMessage({ channel: "WhatsApp" }) }),
  );
  ok("WhatsApp without phone: not allowed", noPhone.allowed === false);
  ok("WhatsApp without phone: blocker mentions phone", noPhone.blockers.some((b) => /phone/i.test(b)));

  const sms = checkOutreachApproval(
    approvalCtx({ candidate: makeCandidate({ phone: "+14155552671" }), message: makeMessage({ channel: "SMS" }) }),
  );
  ok("SMS is disabled before approval", sms.allowed === false);
  ok("SMS disabled blocker is explicit", sms.blockers.some((b) => /SMS delivery is disabled/i.test(b)));
}

// 4) Blocks when complianceFlags.doNotContact is set.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({ matchScore: 95, complianceFlags: { doNotContact: true } as Candidate["complianceFlags"] }),
  });
  const r = checkOutreachApproval(ctx);
  ok("do-not-contact: not allowed", r.allowed === false);
  ok("do-not-contact: blocker mentions do-not-contact", r.blockers.some((b) => /do-not-contact/i.test(b)));
}

// 5) Allows a clean, high-score, personalized message under the limits.
{
  const ctx = approvalCtx({
    candidate: makeCandidate({ matchScore: 95, lastContactedAt: null }),
    message: makeMessage({ channel: "Email", personalizationEvidence: ["Recent open-source PR"], sequenceStep: 1 }),
    emailsSentToday: 0,
    linkedinSentToday: 0,
  });
  const r = checkOutreachApproval(ctx);
  ok("clean message: allowed", r.allowed === true);
  ok("clean message: zero blockers", r.blockers.length === 0);
}

// 5b) Manual candidates require an operator-recorded lawful basis.
{
  const missing = checkOutreachApproval(
    approvalCtx({
      candidate: makeCandidate({
        provenance: "manual",
        sourcePlatform: "Manual",
        lawfulBasis: undefined,
        lawfulBasisSource: undefined,
        lawfulBasisRecordedAt: undefined,
      } as Partial<Candidate>),
    }),
  );
  ok("manual candidate without lawful basis: not allowed", missing.allowed === false);
  ok(
    "manual candidate without lawful basis: blocker is explicit",
    missing.blockers.some((blocker) => /lawful basis/i.test(blocker)),
  );

  const recorded = checkOutreachApproval(
    approvalCtx({
      candidate: makeCandidate({
        provenance: "manual",
        sourcePlatform: "Manual",
        lawfulBasis: "consent",
        lawfulBasisSource: "operator_selection",
        lawfulBasisRecordedAt: "2026-07-13T06:00:00.000Z",
      } as Partial<Candidate>),
    }),
  );
  ok("manual candidate with recorded lawful basis: allowed", recorded.allowed === true);

  for (const ambiguousTimestamp of ["0", "1", "2026-07-13", "2026-07-13T06:00:00Z"]) {
    const basis = recordedCandidateLawfulBasis(
      makeCandidate({
        provenance: "manual",
        sourcePlatform: "Manual",
        lawfulBasis: "consent",
        lawfulBasisSource: "operator_selection",
        lawfulBasisRecordedAt: ambiguousTimestamp,
      } as Partial<Candidate>),
    );
    ok(
      `manual candidate with non-canonical timestamp ${ambiguousTimestamp}: basis rejected`,
      basis === null,
    );
  }
}

// 5c) Provider-sourced candidates require the same operator-recorded lawful basis.
{
  const missing = checkOutreachApproval(
    approvalCtx({
      candidate: makeCandidate({
        provenance: "live",
        sourcePlatform: "GitHub",
        lawfulBasis: undefined,
        lawfulBasisSource: undefined,
        lawfulBasisRecordedAt: undefined,
      } as Partial<Candidate>),
    }),
  );
  ok("provider candidate without lawful basis: not allowed", missing.allowed === false);
  ok(
    "provider candidate without lawful basis: blocker tells operator to record basis",
    missing.blockers.some((blocker) => /provider-sourced candidate requires an operator-recorded lawful basis/i.test(blocker)),
  );

  const recorded = checkOutreachApproval(
    approvalCtx({
      candidate: makeCandidate({
        provenance: "live",
        sourcePlatform: "GitHub",
        lawfulBasis: "legitimate_interest",
        lawfulBasisSource: "operator_selection",
        lawfulBasisRecordedAt: "2026-07-13T06:00:00.000Z",
      } as Partial<Candidate>),
    }),
  );
  ok("provider candidate with recorded lawful basis: allowed", recorded.allowed === true);
}

{
  const blocked = checkOutreachApproval(
    approvalCtx({
      message: {
        ...approvalCtx().message,
        subject: "Compensation",
        body: "We offer a salary of £120k for this role. I hope this finds you well.",
      },
    }),
  );
  ok("quality-blocked outreach cannot be approved", blocked.allowed === false);
  ok(
    "quality-blocked outreach reports a quality blocker",
    blocked.blockers.some((detail) => detail.includes("Quality pipeline blocked")),
  );
}

// no-throw guard on the approval gate
try {
  checkOutreachApproval(approvalCtx());
  ok("checkOutreachApproval does not throw on valid ctx", true);
} catch {
  ok("checkOutreachApproval does not throw on valid ctx", false);
}

/* ========================================================================== */
/* dedupeCandidates                                                            */
/* ========================================================================== */

{
  const existing: Candidate[] = [
    makeCandidate({
      id: "exist_1",
      name: "Existing One",
      email: "dup@example.com",
      linkedinUrl: "https://www.linkedin.com/in/dup-9999",
      githubUrl: "",
    }),
  ];

  const dupEmail = makeCandidate({
    id: "in_email",
    name: "Dup Email",
    email: "DUP@example.com", // case-insensitive duplicate
    linkedinUrl: "https://www.linkedin.com/in/unique-email",
    githubUrl: "",
  });
  const dupLinkedin = makeCandidate({
    id: "in_li",
    name: "Dup LinkedIn",
    email: "fresh-li@example.com",
    linkedinUrl: "https://www.linkedin.com/in/DUP-9999", // case-insensitive duplicate
    githubUrl: "",
  });
  const excludedCo = makeCandidate({
    id: "in_excl",
    name: "Excluded Co",
    email: "fresh-excl@example.com",
    linkedinUrl: "",
    githubUrl: "",
    currentCompany: "BadCorp",
  });
  const cleanNew = makeCandidate({
    id: "in_clean",
    name: "Clean New",
    email: "fresh-clean@example.com",
    linkedinUrl: "https://www.linkedin.com/in/clean-new",
    githubUrl: "https://github.com/cleannew",
    currentCompany: "GoodCo",
    lastContactedAt: null,
  });

  const res = dedupeCandidates([dupEmail, dupLinkedin, excludedCo, cleanNew], existing, {
    excludedCompanies: ["BadCorp"],
  });

  ok("dedupe: exactly one accepted", res.accepted.length === 1);
  ok("dedupe: accepted is the clean candidate", res.accepted[0]?.id === "in_clean");
  ok("dedupe: three skipped", res.skipped.length === 3);

  const reasonFor = (name: string) => res.skipped.find((s) => s.name === name)?.reason ?? "";
  ok("dedupe: duplicate email skipped", /email/i.test(reasonFor("Dup Email")));
  ok("dedupe: duplicate linkedin skipped", /linkedin/i.test(reasonFor("Dup LinkedIn")));
  ok("dedupe: excluded company skipped", /exclud/i.test(reasonFor("Excluded Co")));
  ok("dedupe: clean candidate not in skipped", !res.skipped.some((s) => s.name === "Clean New"));
}

// no-throw guard on dedupe with empty inputs
try {
  const empty = dedupeCandidates([], [], { excludedCompanies: [] });
  ok("dedupe empty: zero accepted, zero skipped", empty.accepted.length === 0 && empty.skipped.length === 0);
} catch {
  ok("dedupe empty: zero accepted, zero skipped", false);
}

/* ========================================================================== */
/* applyConfidentiality                                                        */
/* ========================================================================== */

{
  const cand = makeCandidate({ name: "Jane Smith", email: "jane.smith@example.com" });

  const masked = applyConfidentiality(cand, { confidentialityMode: true, reveal: false });
  ok("mask: name is altered", masked.name !== cand.name);
  ok("mask: email is altered", masked.email !== cand.email);
  ok("mask: name or email carries the mask glyph", masked.name.includes("•") || masked.email.includes("•"));
  ok("mask: masked name is non-empty", masked.name.length > 0);

  const revealed = applyConfidentiality(cand, { confidentialityMode: true, reveal: true });
  ok("reveal: name intact", revealed.name === cand.name);
  ok("reveal: email intact", revealed.email === cand.email);

  // confidentialityMode off => intact even without reveal
  const off = applyConfidentiality(cand, { confidentialityMode: false, reveal: false });
  ok("mode off: name intact", off.name === cand.name);
  ok("mode off: email intact", off.email === cand.email);
}

// Same behavior on a real seed candidate.
{
  const state = historicalSeedState();
  const seedCand = state.candidates[0];
  ok("seed: there is at least one candidate", !!seedCand);
  if (seedCand) {
    const masked = applyConfidentiality(seedCand, { confidentialityMode: true, reveal: false });
    ok("seed mask: name altered", masked.name !== seedCand.name);
    ok("seed mask: email altered", masked.email !== seedCand.email);
    const revealed = applyConfidentiality(seedCand, { confidentialityMode: true, reveal: true });
    ok("seed reveal: name intact", revealed.name === seedCand.name);
    ok("seed reveal: email intact", revealed.email === seedCand.email);
  }
}

/* ========================================================================== */
/* hasOutreachPurpose                                                          */
/* ========================================================================== */

ok("hasOutreachPurpose('Sourced') is false", hasOutreachPurpose("Sourced") === false);
ok("hasOutreachPurpose('Contacted') is true", hasOutreachPurpose("Contacted") === true);
ok("hasOutreachPurpose('Hired') is true", hasOutreachPurpose("Hired") === true);

/* ---- maskEmailBody (reply-body PII redaction) ---------------------------- */
const _mb = maskEmailBody("reach me at john.doe@acme.com or call +1 415 555 0100, see https://acme.com/jobs");
ok("maskEmailBody redacts the email address", _mb.includes("[email]") && !_mb.includes("john.doe@acme.com"));
ok("maskEmailBody redacts the phone number", _mb.includes("[phone]"));
ok("maskEmailBody redacts the link", _mb.includes("[link]") && !_mb.includes("https://acme.com/jobs"));
ok("maskEmailBody leaves plain prose intact", maskEmailBody("Thanks, sounds interesting.") === "Thanks, sounds interesting.");
ok("maskEmailBody handles empty string", maskEmailBody("") === "");

/* ========================================================================== */

console.log(`RESULT rules: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
