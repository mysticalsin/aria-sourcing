/**
 * E2E helper: mirrors /intake → Create campaign → workspace_state materialization.
 * Env: WORK (scratch dir with job_analysis.json, ws_row.json).
 * Writes: new_state.json, intake_ui_campaign_id.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createCampaign } from "../src/lib/mock-ai";
import { e2eReadyJob, buildSeedState } from "../src/lib/seed";
import { stripSharedRole } from "../src/lib/live-role-authority";
import { normalizeHermesState } from "../src/lib/store/migrations";
import type { JobAnalysis } from "../src/lib/types";

const work = process.env.WORK?.trim();
if (!work) {
  console.error("materialize-intake-campaign: WORK env not set");
  process.exit(1);
}

/** Merge parsed intake fields onto the E2E-ready baseline so createCampaign never sees undefined arrays or Unspecified gates. */
function normalizeJobAnalysis(raw: Partial<JobAnalysis>): JobAnalysis {
  const base = e2eReadyJob();
  const pick = <T extends string>(value: T | undefined, fallback: T): T =>
    value && value !== "Unspecified" ? value : fallback;
  return {
    ...base,
    ...raw,
    title: raw.title?.trim() || base.title,
    department: raw.department?.trim() || base.department,
    seniority: pick(raw.seniority, base.seniority),
    employmentType: pick(raw.employmentType, base.employmentType),
    locationType: pick(raw.locationType, base.locationType),
    urgency: pick(raw.urgency, base.urgency),
    requiredSkills: raw.requiredSkills?.length ? raw.requiredSkills : base.requiredSkills,
    niceToHaveSkills: raw.niceToHaveSkills ?? base.niceToHaveSkills,
    regions: raw.regions?.length ? raw.regions : base.regions,
    industryExperience: raw.industryExperience?.length
      ? raw.industryExperience
      : base.industryExperience,
    companyStageTarget: raw.companyStageTarget?.length
      ? raw.companyStageTarget
      : base.companyStageTarget,
    validationWarnings: raw.validationWarnings ?? base.validationWarnings,
  };
}

const job = normalizeJobAnalysis(
  JSON.parse(readFileSync(`${work}/job_analysis.json`, "utf8")) as Partial<JobAnalysis>,
);
let state;
try {
  const rows = JSON.parse(readFileSync(`${work}/ws_row.json`, "utf8"));
  const row = Array.isArray(rows) ? rows[0] : null;
  state = row?.state ? normalizeHermesState(row.state) : buildSeedState();
} catch {
  state = buildSeedState();
}

const campaign = createCampaign(job, {
  hiringManager: "E2E Intake",
  hiringManagerEmail: "e2e-intake@amaris.com",
});

state = {
  ...state,
  campaigns: [campaign, ...state.campaigns],
  activeCampaignId: campaign.id,
};

writeFileSync(`${work}/new_state.json`, JSON.stringify(stripSharedRole(state)));
writeFileSync(`${work}/intake_ui_campaign_id.txt`, campaign.id);
