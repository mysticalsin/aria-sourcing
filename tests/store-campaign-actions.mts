import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSeedState } from "../src/lib/seed";
import {
  createCampaignActions,
  type CampaignActionDependencies,
} from "../src/lib/store/campaign-actions";
import { githubSkillQueryToken } from "../src/lib/sourcing/github-search-language";
import { summarizeCampaignLaunch } from "../src/lib/store/campaign-launch";
import type {
  Activity,
  Campaign,
  HermesState,
  JobAnalysis,
} from "../src/lib/types";

type ActivityDraft = Parameters<CampaignActionDependencies["makeActivity"]>[0];

const campaignActionsSource = readFileSync(
  new URL("../src/lib/store/campaign-actions.ts", import.meta.url),
  "utf8",
);
const storeSource = readFileSync(
  new URL("../src/lib/store.ts", import.meta.url),
  "utf8",
);
const intakePageSource = readFileSync(
  new URL("../src/app/intake/page.tsx", import.meta.url),
  "utf8",
);
const launchPageSource = readFileSync(
  new URL("../src/app/launch/page.tsx", import.meta.url),
  "utf8",
);
const campaignPageSource = readFileSync(
  new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
  "utf8",
);

test("campaign action boundary is React-free and memoized from stable dependencies", () => {
  assert.doesNotMatch(campaignActionsSource, /["']use client["']/);
  assert.doesNotMatch(campaignActionsSource, /from ["']react["']/);
  const runtimeImports = campaignActionsSource
    .split("\n")
    .filter((line) => /^import\s+(?!type\b)/.test(line));
  assert.deepEqual(runtimeImports, ["import {", 'import { evaluateNeedReadiness } from "../needs/readiness";']);
  assert.match(
    campaignActionsSource,
    /CAMPAIGN_STATUSES,[\s\S]*COMPANY_STAGES,[\s\S]*SENIORITY_LEVELS,[\s\S]*URGENCY_LEVELS,[\s\S]*from "\.\.\/types";/,
  );
  assert.equal(
    storeSource.indexOf("function makeActivity(") <
      storeSource.indexOf("export function HermesProvider("),
    true,
    "pure activity helpers must stay outside the provider render cycle",
  );
  assert.match(
    storeSource,
    /createCampaignActions\([\s\S]*?\),\n\s*\[commit, campaignMutationAllowed\],/,
  );
});

test("campaign callers handle rejected creation, updates, queries, and sourcing", () => {
  assert.match(
    intakePageSource,
    /const campaign = actions\.createCampaignFromAnalysis[\s\S]*?if \(!campaign\)[\s\S]*?return;[\s\S]*?actions\.sourceNextBatch/,
  );
  assert.match(
    launchPageSource,
    /if \(!campaign\) return \{ created: false, sourcingComplete: false \};/,
  );
  assert.match(
    launchPageSource,
    /const sourceResult = await actions\.sourceNextBatch[\s\S]*?if \(!sourceResult\.ok\)[\s\S]*?sourcingComplete: false/,
  );
  assert.match(
    launchPageSource,
    /summarizeCampaignLaunch\(roleBlocks\.length, results\)/,
  );
  assert.match(intakePageSource, /sourceRejectedToast/);
  assert.match(launchPageSource, /sourceRejectedToast/);
  assert.match(intakePageSource, /variant: "error"/);
  assert.doesNotMatch(launchPageSource, /if \(failLoud\) \{/);
  assert.equal(
    (campaignPageSource.match(/if \(!actions\.updateCampaign/g) ?? []).length,
    6,
  );
  assert.equal(
    (campaignPageSource.match(/if \(!actions\.regenerateQueries/g) ?? []).length,
    1,
  );
  assert.match(campaignPageSource, /tokenizeMustHaveSkills/);
  assert.match(campaignPageSource, /parseSkillList[\s\S]*tokenizeMustHaveSkills\(raw\)/);
  assert.match(intakePageSource, /SAMPLE_CALYPSO_APP_SUPPORT_NEED/);
  assert.match(intakePageSource, /Calypso Application Support stays loaded/);
});

test("campaign launch summary requires every requested role to complete", () => {
  const success = summarizeCampaignLaunch(2, [
    { created: true, sourcingComplete: true },
    { created: true, sourcingComplete: true },
  ]);
  assert.equal(success.status, "success");
  assert.equal(success.created, 2);
  assert.equal(success.sourcingComplete, 2);

  const creationFailure = summarizeCampaignLaunch(2, [
    { created: true, sourcingComplete: true },
    { created: false, sourcingComplete: false },
  ]);
  assert.equal(creationFailure.status, "partial");
  assert.equal(creationFailure.created, 1);
  assert.equal(creationFailure.creationFailed, 1);
  assert.equal(creationFailure.sourcingFailed, 0);

  const sourcingFailure = summarizeCampaignLaunch(2, [
    { created: true, sourcingComplete: true },
    { created: true, sourcingComplete: false },
  ]);
  assert.equal(sourcingFailure.status, "partial");
  assert.equal(sourcingFailure.creationFailed, 0);
  assert.equal(sourcingFailure.sourcingFailed, 1);

  const totalFailure = summarizeCampaignLaunch(2, [
    { created: false, sourcingComplete: false },
    null,
  ]);
  assert.equal(totalFailure.status, "failed");
  assert.equal(totalFailure.created, 0);
  assert.equal(totalFailure.creationFailed, 2);
});

function campaignFixture(state: HermesState, id = "camp_created"): Campaign {
  const source = state.campaigns[0];
  return {
    ...source,
    id,
    title: "Created campaign",
    hiringManager: "Test Manager",
    hiringManagerEmail: "manager@example.test",
    activities: [],
  };
}

function createHarness(
  initialState = buildSeedState(),
  options: {
    campaignMutationAllowed?: boolean;
    commitAllowed?: boolean;
  } = {},
) {
  let state = structuredClone(initialState);
  let commitCalls = 0;
  let lastCommitPreservedIdentity = false;
  let recomputeCalls = 0;
  let scoreCalls = 0;
  let effectiveWeightCalls = 0;
  const activityDrafts: ActivityDraft[] = [];
  const buildInputs: Array<{
    jobAnalysis: JobAnalysis;
    meta: { hiringManager: string; hiringManagerEmail: string };
  }> = [];
  const effectiveWeightInputs: Array<{
    skills: HermesState["skills"];
    weights: Campaign["scoringWeights"];
  }> = [];
  const scoredJobTitles: string[] = [];
  const createdCampaign = campaignFixture(state);

  const dependencies: CampaignActionDependencies = {
    commit: (update) => {
      commitCalls += 1;
      if (options.commitAllowed === false) return false;
      const previous = state;
      state = update(state);
      lastCommitPreservedIdentity = previous === state;
      return true;
    },
    buildCampaign: (jobAnalysis, meta) => {
      buildInputs.push({ jobAnalysis, meta });
      return createdCampaign;
    },
    makeActivity: (draft) => {
      activityDrafts.push(draft);
      return {
        ...draft,
        id: `activity_${activityDrafts.length}`,
        createdAt: draft.createdAt ?? "2026-07-13T00:00:00.000Z",
      };
    },
    withActivity: (current, activity, campaignId) => ({
      ...current,
      campaigns: campaignId
        ? current.campaigns.map((campaign) =>
            campaign.id === campaignId
              ? { ...campaign, activities: [activity, ...campaign.activities] }
              : campaign,
          )
        : current.campaigns,
      activities: [activity, ...current.activities],
    }),
    recomputeMetrics: (current, campaignId) => {
      recomputeCalls += 1;
      return {
        ...current,
        campaigns: current.campaigns.map((campaign) =>
          campaign.id === campaignId
            ? {
                ...campaign,
                metrics: { ...campaign.metrics, avgMatchScore: 42 },
              }
            : campaign,
        ),
      };
    },
    effectiveWeights: (weights, skills) => {
      effectiveWeightCalls += 1;
      effectiveWeightInputs.push({ weights, skills });
      return weights;
    },
    scoreCandidate: (_candidate, jobAnalysis) => {
      scoreCalls += 1;
      scoredJobTitles.push(jobAnalysis.title);
      return {
        score: 42,
        breakdown: [
          {
            key: "skills",
            label: "Test score",
            score: 42,
            weight: 1,
            contribution: 42,
            rationale: "Deterministic factory test",
          },
        ],
      };
    },
    campaignMutationAllowed: () => options.campaignMutationAllowed ?? true,
    currentState: () => state,
  };

  return {
    actions: createCampaignActions(dependencies),
    activityDrafts,
    buildInputs,
    createdCampaign,
    get commitCalls() {
      return commitCalls;
    },
    get effectiveWeightCalls() {
      return effectiveWeightCalls;
    },
    effectiveWeightInputs,
    get lastCommitPreservedIdentity() {
      return lastCommitPreservedIdentity;
    },
    get recomputeCalls() {
      return recomputeCalls;
    },
    get scoreCalls() {
      return scoreCalls;
    },
    scoredJobTitles,
    get state() {
      return state;
    },
  };
}

test("setActiveCampaign accepts a campaign id and null", () => {
  const harness = createHarness();

  harness.actions.setActiveCampaign("camp_selected");
  assert.equal(harness.state.activeCampaignId, "camp_selected");

  harness.actions.setActiveCampaign(null);
  assert.equal(harness.state.activeCampaignId, null);
});

test("createCampaignFromAnalysis prepends, selects, returns, and records the campaign", () => {
  const harness = createHarness();
  const jobAnalysis = harness.createdCampaign.jobAnalysis;
  const previousCount = harness.state.campaigns.length;
  const previousFirstId = harness.state.campaigns[0]?.id;

  const created = harness.actions.createCampaignFromAnalysis(jobAnalysis, {
    hiringManager: "Test Manager",
    hiringManagerEmail: "manager@example.test",
  });

  assert.equal(
    created === harness.createdCampaign,
    true,
    "factory must return the exact campaign built by its dependency",
  );
  assert.equal(harness.state.campaigns[0]?.id, "camp_created");
  assert.equal(harness.state.campaigns.length, previousCount + 1);
  assert.equal(harness.state.campaigns[1]?.id, previousFirstId);
  assert.equal(harness.state.activeCampaignId, "camp_created");
  assert.equal(harness.state.activities[0]?.title, "Campaign created");
  assert.equal(harness.state.campaigns[0]?.activities[0]?.title, "Campaign created");
  assert.equal(harness.activityDrafts[0]?.campaignId, "camp_created");
  assert.equal(harness.activityDrafts[0]?.type, "campaign");
  assert.equal(harness.activityDrafts[0]?.outcome, "Sourcing strategy generated");
  assert.equal(harness.activityDrafts[0]?.linkedEntityType, "campaign");
  assert.equal(harness.activityDrafts[0]?.linkedEntityId, "camp_created");
  assert.equal(
    harness.state.activities[0] === harness.state.campaigns[0]?.activities[0],
    true,
    "global and campaign timelines must reference the same activity",
  );
  assert.equal(harness.buildInputs.length, 1);
  assert.equal(harness.buildInputs[0]?.jobAnalysis === jobAnalysis, true);
  assert.equal(harness.buildInputs[0]?.meta.hiringManager, "Test Manager");
  assert.equal(
    harness.buildInputs[0]?.meta.hiringManagerEmail,
    "manager@example.test",
  );
});

test("createCampaignFromAnalysis fails closed when campaign mutation is denied", () => {
  const harness = createHarness(buildSeedState(), {
    campaignMutationAllowed: false,
  });
  const previousCampaignCount = harness.state.campaigns.length;

  const created = harness.actions.createCampaignFromAnalysis(
    harness.createdCampaign.jobAnalysis,
    {
      hiringManager: "Blocked Manager",
      hiringManagerEmail: "blocked@example.test",
    },
  );

  assert.equal(created, null);
  assert.equal(harness.state.campaigns.length, previousCampaignCount);
  assert.equal(harness.buildInputs.length, 0);
  assert.equal(harness.activityDrafts.length, 0);
});

test("createCampaignFromAnalysis returns no orphan when commit is rejected", () => {
  const harness = createHarness(buildSeedState(), { commitAllowed: false });
  const previousCampaignCount = harness.state.campaigns.length;

  const created = harness.actions.createCampaignFromAnalysis(
    harness.createdCampaign.jobAnalysis,
    {
      hiringManager: "Blocked Manager",
      hiringManagerEmail: "blocked@example.test",
    },
  );

  assert.equal(created, null);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.state.campaigns.length, previousCampaignCount);
  assert.equal(harness.activityDrafts.length, 0);
});

test("updateCampaign is a strict no-op for an unknown campaign", () => {
  const harness = createHarness();

  const applied = harness.actions.updateCampaign("camp_missing", {
    status: "Paused",
  });

  assert.equal(applied, false);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.recomputeCalls, 0);
  assert.equal(harness.scoreCalls, 0);
  assert.equal(harness.activityDrafts.length, 0);
});

test("updateCampaign merges a supported status patch without re-scoring", () => {
  const harness = createHarness();
  const campaignId = harness.state.campaigns[0].id;
  const originalDepartment = harness.state.campaigns[0].department;
  const originalStatus = harness.state.campaigns[0].status;

  const applied = harness.actions.updateCampaign(campaignId, {
    status: "Paused",
    previousStatus: harness.state.campaigns[0].status,
  });

  const updated = harness.state.campaigns.find((campaign) => campaign.id === campaignId);
  assert.equal(applied, true);
  assert.equal(updated?.status, "Paused");
  assert.equal(updated?.previousStatus, originalStatus);
  assert.equal(updated?.department, originalDepartment);
  assert.equal(harness.effectiveWeightCalls, 0);
  assert.equal(harness.recomputeCalls, 0);
  assert.equal(harness.scoreCalls, 0);
  assert.equal(harness.activityDrafts.length, 1);
  assert.equal(harness.activityDrafts[0]?.title, "Campaign status changed");
  assert.equal(harness.activityDrafts[0]?.notes, `${originalStatus} to Paused.`);
  assert.equal(harness.activityDrafts[0]?.outcome, "Paused");
});

test("updateCampaign re-scores only matching candidates after a scoring edit", () => {
  const harness = createHarness();
  const campaignId = harness.state.campaigns[0].id;
  const affectedCount = harness.state.candidates.filter(
    (candidate) => candidate.campaignId === campaignId,
  ).length;
  const unrelated = harness.state.candidates.find(
    (candidate) => candidate.campaignId !== campaignId,
  );
  assert.ok(unrelated, "seed must contain an unrelated candidate");
  const unrelatedScore = unrelated.matchScore;

  harness.actions.updateCampaign(campaignId, {
    scoringWeights: {
      ...harness.state.campaigns[0].scoringWeights,
      skills: 50,
    },
  });

  assert.equal(harness.effectiveWeightCalls, 1);
  assert.equal(
    harness.effectiveWeightInputs[0]?.weights.skills,
    50,
  );
  assert.equal(
    harness.effectiveWeightInputs[0]?.skills === harness.state.skills,
    true,
    "scoring must receive the workspace skill configuration",
  );
  assert.equal(harness.scoreCalls, affectedCount);
  assert.equal(harness.recomputeCalls, 1);
  assert.equal(
    harness.state.candidates
      .filter((candidate) => candidate.campaignId === campaignId)
      .every((candidate) => candidate.matchScore === 42),
    true,
    "all matching candidates must receive the new score",
  );
  assert.equal(
    harness.state.candidates.find((candidate) => candidate.id === unrelated.id)?.matchScore,
    unrelatedScore,
  );
  assert.equal(harness.activityDrafts[0]?.title, "Candidates re-scored");
  assert.match(harness.activityDrafts[0]?.notes ?? "", new RegExp(`^${affectedCount} candidates? re-scored`));
  assert.equal(
    harness.state.candidates
      .filter((candidate) => candidate.campaignId === campaignId)
      .every(
        (candidate) =>
          candidate.matchBreakdown[0]?.rationale ===
          "Deterministic factory test",
      ),
    true,
    "all matching candidates must receive the new score breakdown",
  );
  assert.equal(
    harness.state.campaigns.find((campaign) => campaign.id === campaignId)?.metrics
      .avgMatchScore,
    42,
    "the metrics dependency result must be adopted",
  );
});

test("updateCampaign rejects immutable and derived campaign fields at runtime", () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const originalCreatedAt = campaign.createdAt;
  const originalMetric = campaign.metrics.sourced;
  const originalActivityCount = campaign.activities.length;

  const unsafeUpdate = harness.actions.updateCampaign as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => boolean;
  const applied = unsafeUpdate(campaign.id, {
    id: "camp_injected",
    createdAt: "1900-01-01T00:00:00.000Z",
    metrics: { ...campaign.metrics, sourced: 999999 },
    activities: [] as Activity[],
  });

  const updated = harness.state.campaigns.find((item) => item.id === campaign.id);
  assert.equal(applied, false);
  assert.equal(harness.lastCommitPreservedIdentity, false);
  assert.equal(harness.state.campaigns.some((item) => item.id === "camp_injected"), false);
  assert.equal(updated?.createdAt, originalCreatedAt);
  assert.equal(updated?.metrics.sourced, originalMetric);
  assert.equal(updated?.activities.length, originalActivityCount);
});

test("updateCampaign rejects undefined and malformed editable fields", () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const unsafeUpdate = harness.actions.updateCampaign as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => boolean;

  assert.equal(
    unsafeUpdate(campaign.id, {
      status: undefined,
      previousStatus: undefined,
      jobAnalysis: undefined,
      scoringWeights: undefined,
    }),
    false,
  );
  assert.equal(unsafeUpdate(campaign.id, { status: "Administrator" }), false);
  assert.equal(unsafeUpdate(campaign.id, { jobAnalysis: {} }), false);
  assert.equal(
    unsafeUpdate(campaign.id, {
      scoringWeights: {
        ...campaign.scoringWeights,
        skills: Number.NaN,
      },
    }),
    false,
  );
  assert.equal(harness.commitCalls, 0);
  assert.equal(
    harness.state.campaigns.find((item) => item.id === campaign.id)?.status,
    campaign.status,
  );
});

test("updateCampaign rejects invalid JD enums and projects unknown JD fields away", () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const unsafeUpdate = harness.actions.updateCampaign as unknown as (
    id: string,
    patch: Record<string, unknown>,
  ) => boolean;
  const invalidAnalyses = [
    { ...campaign.jobAnalysis, seniority: "Administrator" },
    { ...campaign.jobAnalysis, employmentType: "Permanent" },
    { ...campaign.jobAnalysis, locationType: "Anywhere" },
    { ...campaign.jobAnalysis, urgency: "Whenever" },
    { ...campaign.jobAnalysis, companyStageTarget: ["Unknown stage"] },
    {
      ...campaign.jobAnalysis,
      validationWarnings: [
        { field: "title", severity: "secret", message: "Invalid severity" },
      ],
    },
  ];
  for (const invalidAnalysis of invalidAnalyses) {
    assert.equal(
      unsafeUpdate(campaign.id, { jobAnalysis: invalidAnalysis }),
      false,
    );
  }
  assert.equal(harness.commitCalls, 0);

  const projectedAnalysis = {
    ...campaign.jobAnalysis,
    secret: "SECRET_SENTINEL",
    validationWarnings: [
      {
        field: "title",
        severity: "warning",
        message: "Review title",
        secret: "SECRET_SENTINEL",
      },
    ],
  };
  assert.equal(
    unsafeUpdate(campaign.id, { jobAnalysis: projectedAnalysis }),
    true,
  );
  const stored = harness.state.campaigns.find(
    (item) => item.id === campaign.id,
  )?.jobAnalysis as JobAnalysis & { secret?: string };
  assert.equal(stored.secret, undefined);
  assert.equal(
    "secret" in
      (stored.validationWarnings[0] as unknown as Record<string, unknown>),
    false,
  );
  assert.equal(stored.validationWarnings[0]?.severity, "warning");
  assert.equal(stored.validationWarnings[0]?.message, "Review title");
});

test("update and query actions propagate commit rejection", () => {
  const harness = createHarness(buildSeedState(), { commitAllowed: false });
  const campaign = harness.state.campaigns[0];
  const originalStatus = campaign.status;
  const originalQueryCount = campaign.sourcingStrategy.githubQueries.length;

  const updated = harness.actions.updateCampaign(campaign.id, {
    status: "Paused",
  });
  const regenerated = harness.actions.regenerateQueries(campaign.id);

  assert.equal(updated, false);
  assert.equal(regenerated, false);
  assert.equal(harness.commitCalls, 2);
  assert.equal(harness.state.campaigns[0].status, originalStatus);
  assert.equal(
    harness.state.campaigns[0].sourcingStrategy.githubQueries.length,
    originalQueryCount,
  );
  assert.equal(harness.activityDrafts.length, 0);
});

test("campaign mutations fail closed for a viewer while selection remains available", () => {
  const harness = createHarness(buildSeedState(), {
    campaignMutationAllowed: false,
  });
  const campaign = harness.state.campaigns[0];
  const previousTitle = campaign.title;
  const previousQueryCount = campaign.sourcingStrategy.githubQueries.length;

  harness.actions.setActiveCampaign(campaign.id);
  const updated = harness.actions.updateCampaign(campaign.id, { status: "Paused" });
  const regenerated = harness.actions.regenerateQueries(campaign.id);

  const unchanged = harness.state.campaigns.find((item) => item.id === campaign.id);
  assert.equal(harness.state.activeCampaignId, campaign.id);
  assert.equal(updated, false);
  assert.equal(regenerated, false);
  assert.equal(unchanged?.title, previousTitle);
  assert.equal(unchanged?.status, campaign.status);
  assert.equal(unchanged?.sourcingStrategy.githubQueries.length, previousQueryCount);
  assert.equal(harness.activityDrafts.length, 0);
});

test("updateCampaign scores against the merged job analysis", () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const updatedAnalysis: JobAnalysis = {
    ...campaign.jobAnalysis,
    title: "Merged analysis title",
  };

  harness.actions.updateCampaign(campaign.id, { jobAnalysis: updatedAnalysis });

  assert.equal(harness.scoredJobTitles.length > 0, true);
  assert.equal(
    harness.scoredJobTitles.every((title) => title === "Merged analysis title"),
    true,
  );
});

test("updateCampaign records a singular re-score activity for one candidate", () => {
  const initialState = buildSeedState();
  const campaignId = initialState.campaigns[0].id;
  const matching = initialState.candidates.find(
    (candidate) => candidate.campaignId === campaignId,
  );
  assert.ok(matching, "seed must contain a matching candidate");
  initialState.candidates = [
    matching,
    ...initialState.candidates.filter(
      (candidate) => candidate.campaignId !== campaignId,
    ),
  ];
  const harness = createHarness(initialState);

  const applied = harness.actions.updateCampaign(campaignId, {
    scoringWeights: {
      ...harness.state.campaigns[0].scoringWeights,
      location: 25,
    },
  });

  assert.equal(applied, true);
  assert.equal(
    harness.activityDrafts[0]?.notes,
    "1 candidate re-scored after the JD/weights update.",
  );
});

test("updateCampaign recomputes metrics but does not log a score event with no candidates", () => {
  const initialState = buildSeedState();
  const campaignId = initialState.campaigns[0].id;
  initialState.candidates = initialState.candidates.filter(
    (candidate) => candidate.campaignId !== campaignId,
  );
  const harness = createHarness(initialState);

  harness.actions.updateCampaign(campaignId, {
    scoringWeights: {
      ...harness.state.campaigns[0].scoringWeights,
      experience: 30,
    },
  });

  assert.equal(harness.effectiveWeightCalls, 1);
  assert.equal(harness.scoreCalls, 0);
  assert.equal(harness.recomputeCalls, 1);
  assert.equal(harness.activityDrafts.length, 0);
});

test("regenerateQueries appends the derived query and records sourcing activity", () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const previousQueryCount = campaign.sourcingStrategy.githubQueries.length;
  const expectedSkill = campaign.jobAnalysis.requiredSkills[
    previousQueryCount % campaign.jobAnalysis.requiredSkills.length
  ];
  assert.ok(expectedSkill);
  const expectedRegion = campaign.jobAnalysis.regions[0] ?? "EU";
  const expectedResults = 80 + Math.round((campaign.metrics.sourced + 1) * 3.5);

  const regenerated = harness.actions.regenerateQueries(campaign.id);

  assert.equal(regenerated, true);
  const updated = harness.state.campaigns.find((item) => item.id === campaign.id);
  const appended = updated?.sourcingStrategy.githubQueries.at(-1);
  assert.equal(updated?.sourcingStrategy.githubQueries.length, previousQueryCount + 1);
  assert.equal(appended?.label, `Adjacent: ${expectedSkill} maintainers`);
  assert.equal(
    appended?.query,
    `${githubSkillQueryToken(expectedSkill)} sort:updated location:"${expectedRegion}" forks:>5`,
  );
  assert.equal(appended?.estimatedResults, expectedResults);
  assert.equal(harness.activityDrafts[0]?.title, "Generated additional query");
  assert.equal(harness.activityDrafts[0]?.notes, appended?.query);
  assert.equal(harness.activityDrafts[0]?.outcome, `~${expectedResults} estimated results`);
});

test("regenerateQueries is a strict no-op for an unknown campaign", () => {
  const harness = createHarness();

  const regenerated = harness.actions.regenerateQueries("camp_missing");

  assert.equal(regenerated, false);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.activityDrafts.length, 0);
});

test("regenerateQueries reuses only explicit role facts and preserves unrelated campaigns", () => {
  const initialState = buildSeedState();
  const campaign = initialState.campaigns[0];
  campaign.jobAnalysis = {
    ...campaign.jobAnalysis,
    requiredSkills: [campaign.jobAnalysis.requiredSkills[0] ?? "Primary"],
    regions: [],
  };
  campaign.metrics = { ...campaign.metrics, sourced: 0 };
  const unrelated = initialState.campaigns[1];
  assert.ok(unrelated, "seed must contain a second campaign");
  const unrelatedQueryCount = unrelated.sourcingStrategy.githubQueries.length;
  const harness = createHarness(initialState);

  harness.actions.regenerateQueries(campaign.id);

  const updated = harness.state.campaigns.find((item) => item.id === campaign.id);
  const appended = updated?.sourcingStrategy.githubQueries.at(-1);
  const explicitSkill = campaign.jobAnalysis.requiredSkills[0];
  assert.ok(explicitSkill);
  assert.equal(appended?.label, `Adjacent: ${explicitSkill} maintainers`);
  assert.equal(
    appended?.query,
    `${githubSkillQueryToken(explicitSkill)} sort:updated forks:>5`,
  );
  assert.equal(appended?.estimatedResults, 84);
  assert.equal(
    harness.state.campaigns.find((item) => item.id === unrelated.id)?.sourcingStrategy
      .githubQueries.length,
    unrelatedQueryCount,
  );
});

test("campaign action tests do not serialize the full workspace state", () => {
  const source = new URL("./store-campaign-actions.mts", import.meta.url);
  const testSource = readFileSync(source, "utf8");

  assert.doesNotMatch(testSource, /JSON\.stringify\(harness\.state/);
  assert.doesNotMatch(testSource, /assert\.fail\([^)]*harness\.state/s);
});
