/* ============================================================================
   tests/email-match.mts
   Area: inbound-email candidate matching (src/lib/email-match.ts).

   Tests prove that matchCandidateByEmail correctly resolves a sender address
   to a candidate, handles case-insensitivity, campaign scoping, and safely
   returns undefined for no-match and empty/whitespace inputs.
   ========================================================================== */

import { matchCandidateByEmail } from "../src/lib/email-match";
import type { Candidate } from "../src/lib/types";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- Fixtures ---- */

const base: Omit<Candidate, "id" | "campaignId" | "name" | "email"> = {
  avatarInitials: "AA",
  currentTitle: "Engineer",
  currentCompany: "Acme",
  location: "NYC",
  timezone: "UTC",
  linkedinUrl: "",
  githubUrl: "",
  sourcePlatform: "GitHub",
  sourceQuery: "",
  matchScore: 80,
  matchBreakdown: [],
  techStack: [],
  yearsExperience: 5,
  companyStageExperience: [],
  industryExperience: [],
  recentActivity: "",
  stage: "Contacted",
  lastContactedAt: null,
  outreachHistory: [],
  replyHistory: [],
  booking: null,
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

const cand1: Candidate = {
  ...base,
  id: "c1",
  campaignId: "camp-a",
  name: "Alice",
  email: "alice@example.com",
};

const cand2: Candidate = {
  ...base,
  id: "c2",
  campaignId: "camp-b",
  name: "Bob",
  email: "bob@example.com",
};

const cand3: Candidate = {
  ...base,
  id: "c3",
  campaignId: "camp-a",
  name: "Carol",
  email: "carol@example.com",
};

const candidates: Candidate[] = [cand1, cand2, cand3];

/* ---- Tests ---- */

// Exact match
ok(
  "exact match returns the correct candidate",
  matchCandidateByEmail(candidates, "alice@example.com")?.id === "c1",
);

// Case-insensitive match
ok(
  "case-insensitive match (upper input)",
  matchCandidateByEmail(candidates, "ALICE@EXAMPLE.COM")?.id === "c1",
);
ok(
  "case-insensitive match (mixed case)",
  matchCandidateByEmail(candidates, "Alice@Example.Com")?.id === "c1",
);

// No match returns undefined
ok(
  "no match returns undefined",
  matchCandidateByEmail(candidates, "nobody@example.com") === undefined,
);

// Campaign-scoped match includes same campaign
ok(
  "campaign-scoped match returns candidate in that campaign",
  matchCandidateByEmail(candidates, "alice@example.com", "camp-a")?.id === "c1",
);

// Campaign-scoped match excludes other campaigns
ok(
  "campaign-scoped match excludes candidate in different campaign",
  matchCandidateByEmail(candidates, "bob@example.com", "camp-a") === undefined,
);

// Empty fromAddress returns undefined
ok(
  "empty string fromAddress returns undefined",
  matchCandidateByEmail(candidates, "") === undefined,
);

// Whitespace-only fromAddress returns undefined
ok(
  "whitespace-only fromAddress returns undefined",
  matchCandidateByEmail(candidates, "   ") === undefined,
);

console.log(`RESULT email-match: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
