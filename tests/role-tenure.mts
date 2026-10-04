/* ============================================================================
   tests/role-tenure.mts — current-role tenure contact gate (6–12 mo preferred)
   ========================================================================== */

import {
  assessRoleTenure,
  inferMonthsInCurrentRole,
  isContactReadyByTenure,
  MIN_MONTHS_BEFORE_CONTACT,
} from "../src/lib/sourcing/role-tenure";
import { checkOutreachApproval } from "../src/lib/rules";
import { defaultSettings } from "../src/lib/seed";
import type { Candidate, OutreachMessage } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const NOW = new Date(Date.UTC(2026, 8, 10)); // 2026-09-10

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand_t",
    campaignId: "camp_t",
    name: "Test Person",
    email: "t@example.com",
    avatarInitials: "TP",
    currentTitle: "Windows Desktop Engineer",
    currentCompany: "Acme",
    location: "Montreal",
    timezone: "",
    linkedinUrl: "https://www.linkedin.com/in/test",
    githubUrl: "",
    sourcePlatform: "LinkedIn",
    sourceQuery: "windows",
    matchScore: 90,
    matchBreakdown: [],
    techStack: ["Intune"],
    yearsExperience: 5,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "Active on LinkedIn",
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    lawfulBasis: "legitimate_interest",
    lawfulBasisSource: "operator_selection",
    lawfulBasisRecordedAt: "2026-09-01T00:00:00.000Z",
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function msg(): OutreachMessage {
  return {
    id: "msg_t",
    candidateId: "cand_t",
    campaignId: "camp_t",
    channel: "LinkedIn",
    subject: "Quick note",
    body: "Hi — saw your Intune work…",
    tone: "Casual Professional",
    personalizationEvidence: ["Intune"],
    status: "Needs Approval",
    sequenceStep: 1,
    scheduledFor: null,
    sentAt: null,
    approvedBy: null,
    dryRun: true,
    createdAt: "2026-09-10T00:00:00.000Z",
  };
}

ok(
  "Jul 2026 – Present is too early (~2 mo)",
  inferMonthsInCurrentRole(
    cand({ recentActivity: "Enterprise Windows Engineer · Jul 2026 – Present · Montreal" }),
    NOW,
  ) === 2,
);

ok(
  "Mar 2026 – Present is preferred (~6 mo)",
  inferMonthsInCurrentRole(
    cand({ recentActivity: "Desktop Engineer · Mar 2026 – Present" }),
    NOW,
  ) === 6,
);

ok(
  "Jul 2019 – Present is established",
  assessRoleTenure(
    cand({ recentActivity: "Windows Engineer · Jul 2019 – Present · Montreal" }),
    NOW,
  ).timing === "established",
);

ok(
  "just started phrase → too early",
  assessRoleTenure(cand({ recentActivity: "Just started as Desktop Support at Acme" }), NOW)
    .timing === "too_early",
);

ok(
  "explicit 8 mos → preferred",
  assessRoleTenure(cand({ recentActivity: "Current role (8 mos)" }), NOW).timing === "preferred",
);

ok(
  "experience Present line wins",
  inferMonthsInCurrentRole(
    cand({
      recentActivity: "noisy serp text without dates",
      experience: ["Windows Engineer @ Bank (Jan 2026 - Present)"],
    }),
    NOW,
  ) === 8,
);

ok(
  "contact ready false when too early",
  isContactReadyByTenure(
    cand({ recentActivity: "Role · Aug 2026 – Present" }),
    NOW,
  ) === false,
);

ok(
  "contact ready true when preferred",
  isContactReadyByTenure(
    cand({ recentActivity: "Role · Feb 2026 – Present" }),
    NOW,
  ) === true,
);

const early = checkOutreachApproval({
  candidate: cand({
    recentActivity: `Windows Desktop Engineer · Aug 2026 – Present · just started`,
  }),
  message: msg(),
  settings: defaultSettings(),
  emailsSentToday: 0,
  linkedinSentToday: 0,
});
ok("approval blocks too-early tenure", early.allowed === false);
ok(
  "approval block mentions wait window",
  early.blockers.some((b) => b.includes(String(MIN_MONTHS_BEFORE_CONTACT))),
);

const ready = checkOutreachApproval({
  candidate: cand({ recentActivity: "Windows Engineer · Jan 2026 – Present · Intune" }),
  message: msg(),
  settings: defaultSettings(),
  emailsSentToday: 0,
  linkedinSentToday: 0,
});
ok("approval allows preferred tenure", ready.allowed === true);
ok(
  "preferred tenure check passes",
  (ready.checks ?? []).some((c) => c.rule === "Role tenure" && c.status === "pass"),
);

console.log(`role-tenure: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
