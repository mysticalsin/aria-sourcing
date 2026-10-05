import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  campaignAllowsLiveSourcing,
  campaignAllowsManualCandidateIntake,
} from "../src/lib/sourcing/campaign-lifecycle";
import type { CampaignStatus } from "../src/lib/types";

const statuses: CampaignStatus[] = [
  "Intake",
  "Sourcing",
  "Outreach",
  "Interviewing",
  "Closing",
  "Filled",
  "Paused",
];

test("live provider sourcing is allowed only while a campaign is sourcing or outreaching", () => {
  const allowed = statuses.filter(campaignAllowsLiveSourcing);

  assert.deepEqual(allowed, ["Sourcing", "Outreach"]);
});

test("manual candidate intake remains available before completion but stops for filled or paused campaigns", () => {
  const allowed = statuses.filter(campaignAllowsManualCandidateIntake);

  assert.deepEqual(allowed, ["Intake", "Sourcing", "Outreach", "Interviewing", "Closing"]);
});

test("campaign sourcing controls use the same canonical live-sourcing predicate", () => {
  const page = readFileSync(
    new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /campaignAllowsLiveSourcing\(c\.status\)/);
  assert.match(page, /disabled=\{sourcing \|\| !liveSourcingAllowed\}/);
  assert.match(page, /onClick=\{handleSource\}/);
  assert.match(page, /onClick=\{handleAutoSource\}/);
  assert.match(page, /Auto source/);
  assert.doesNotMatch(page, /SourceApolloButton|SourceApifyButton|Source via Apify/);
});
