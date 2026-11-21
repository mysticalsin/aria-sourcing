/**
 * Characterization of the console feature split.
 * The read models, UI state machines, and action factories below are the
 * behaviour the pages and the workspace store already had. They fail closed
 * when a module is missing, and they stay green only when a refactor keeps
 * the same transitions.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { bindConsoleCommands } from "../src/features/api/commands.ts";
import { createWorkspaceConsoleClient } from "../src/features/api/workspace-client.ts";
import {
  initialApprovalBatch,
  reduceApprovalBatch,
} from "../src/features/approvals/machine.ts";
import { projectOdooSync } from "../src/features/odoo-sync/projection.ts";
import { initialOdooSync, reduceOdooSync } from "../src/features/odoo-sync/machine.ts";
import { filterByCampaign } from "../src/features/outreach/selectors.ts";
import {
  initialOutreachQueue,
  reduceOutreachQueue,
} from "../src/features/outreach/machine.ts";
import { createPipelineActions } from "../src/features/pipeline/actions.ts";
import {
  filterPipelineCandidates,
  initialPipelineList,
  reducePipelineList,
} from "../src/features/pipeline/machine.ts";
import { buildPipelineRows } from "../src/lib/pipeline.ts";
import {
  effectiveReportCampaignId,
  sortSkillUpdates,
} from "../src/features/reports/selectors.ts";
import {
  initialReportsConsole,
  reduceReportsConsole,
} from "../src/features/reports/machine.ts";
import { reduceReportPeriod } from "../src/features/reports/period.ts";
import { createSettingsActions } from "../src/features/settings/actions.ts";
import {
  initialSettingsConsole,
  reduceSettingsConsole,
} from "../src/features/settings/machine.ts";
import { projectSettingsIntegrations } from "../src/features/settings/selectors.ts";
import { buildSeedState } from "../src/lib/seed.ts";
import { stageRank } from "../src/lib/metrics.ts";
import type { WorkspaceActions } from "../src/lib/store/contracts.ts";
import type { OutreachMessage, SkillUpdate } from "../src/lib/types.ts";

const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("workspace console client is the single read model over current data", () => {
  const seed = buildSeedState();
  const client = createWorkspaceConsoleClient(seed);

  assert.equal(client.backend, "workspace");
  assert.deepEqual(client.pipeline().rows, buildPipelineRows(seed.campaigns, seed.candidates));
  assert.equal(client.pipeline().campaigns, seed.campaigns);
  assert.equal(client.pipeline().candidates, seed.candidates);
  assert.deepEqual(
    client.approvals().pending.map((message) => message.id),
    seed.outreach.filter((message) => message.status === "Needs Approval").map((message) => message.id),
  );
  assert.deepEqual(
    client.outreach().scheduled.map((message) => message.id),
    seed.outreach.filter((message) => message.status === "Scheduled").map((message) => message.id),
  );
  const firstReport = seed.reports[0];
  assert.ok(firstReport);
  assert.equal(client.reports().forCampaign(firstReport.campaignId)?.id, firstReport.id);
  assert.equal(client.settings().settings, seed.settings);
  assert.equal(client.odoo().preview.records.length, seed.candidates.length);
});

test("campaign filter and approval queue keep today's outreach slices", () => {
  const rows = [
    { id: "a", campaignId: "one", status: "Needs Approval" },
    { id: "b", campaignId: "two", status: "Scheduled" },
  ] as OutreachMessage[];
  assert.deepEqual(filterByCampaign(rows, "all").map((row) => row.id), ["a", "b"]);
  assert.deepEqual(filterByCampaign(rows, "two").map((row) => row.id), ["b"]);
  assert.deepEqual(filterByCampaign(rows, "missing"), []);
});

test("report selection falls back to the active campaign, then the first", () => {
  assert.equal(effectiveReportCampaignId("picked", "active", [{ id: "first" }]), "picked");
  assert.equal(effectiveReportCampaignId("", "active", [{ id: "first" }]), "active");
  assert.equal(effectiveReportCampaignId("", null, [{ id: "first" }]), "first");
  assert.equal(effectiveReportCampaignId("", null, []), "");
});

test("skill updates still surface proposals before newer decisions", () => {
  const updates = [
    { status: "accepted", createdAt: "2026-03-02T00:00:00.000Z", id: "new-accepted" },
    { status: "proposed", createdAt: "2026-01-01T00:00:00.000Z", id: "old-proposed" },
    { status: "proposed", createdAt: "2026-02-01T00:00:00.000Z", id: "new-proposed" },
    { status: "rejected", createdAt: "2026-04-01T00:00:00.000Z", id: "rejected" },
  ] as SkillUpdate[];
  assert.deepEqual(
    sortSkillUpdates(updates).map((update) => update.id),
    ["new-proposed", "old-proposed", "rejected", "new-accepted"],
  );
});

test("settings integrations overlay follows the live Supabase flag", () => {
  const stored = buildSeedState().integrations;
  const live = projectSettingsIntegrations(stored, true).find((item) => item.id === "int_supabase");
  const demo = projectSettingsIntegrations(stored, false).find((item) => item.id === "int_supabase");
  assert.equal(live?.status, "connected");
  assert.equal(live?.mode, "live");
  assert.deepEqual(live?.errors, []);
  assert.equal(demo?.status, "not_configured");
  assert.equal(demo?.mode, "mock");
  assert.deepEqual(demo?.errors, ["No project URL configured: demo runs on localStorage."]);
  assert.equal(projectSettingsIntegrations(stored, true).find((item) => item.id !== "int_supabase"), stored.find((item) => item.id !== "int_supabase"));
});

test("odoo preview maps sanctioned intake and blocks everything else", () => {
  const input = [
    {
      id: "applicant-1",
      campaignId: "role-1",
      email: "ada.example@people.example.test",
      name: "Ada Example",
      leadSource: "Applicant" as const,
      sourcePlatform: "Referral" as const,
    },
    {
      id: "referral-1",
      campaignId: "role-1",
      email: "bea.example@people.example.test",
      name: "Bea Example",
      leadSource: "Referral" as const,
      sourcePlatform: "Referral" as const,
    },
    {
      id: "manual-1",
      campaignId: "role-1",
      email: "cy.example@people.example.test",
      name: "Cy Example",
      leadSource: "Outbound" as const,
      sourcePlatform: "Manual" as const,
    },
    {
      id: "github-1",
      campaignId: "role-1",
      email: "linus.example@people.example.test",
      name: "Linus Example",
      leadSource: "Outbound" as const,
      sourcePlatform: "GitHub" as const,
    },
    {
      id: "blank-1",
      campaignId: "role-1",
      email: "   ",
      name: "No Address",
      leadSource: "Applicant" as const,
      sourcePlatform: "Manual" as const,
    },
  ];
  const view = projectOdooSync(input);
  assert.equal(view.records[0]?.status, "ready");
  assert.equal(view.records[0]?.source, "Job application");
  assert.equal(view.records[0]?.idempotencyKey, "applicant_applicant-1");
  assert.equal(view.records[1]?.source, "Candidate-supplied");
  assert.equal(view.records[2]?.source, "Candidate-supplied");
  assert.equal(view.records[3]?.status, "blocked");
  assert.equal(view.records[3]?.reason, "unsanctioned source");
  assert.equal(view.records[4]?.reason, "missing recipient");
  assert.equal(view.ready, 3);
  assert.equal(view.blocked, 2);
  assert.equal(input[3]?.email, "linus.example@people.example.test");
});

test("odoo sync is an explicit preview machine and never sends", () => {
  const ready = projectOdooSync([
    {
      id: "applicant-1",
      campaignId: "role-1",
      email: "ada.example@people.example.test",
      name: "Ada Example",
      leadSource: "Applicant",
      sourcePlatform: "Manual",
    },
  ]);
  const mixed = projectOdooSync([
    {
      id: "applicant-1",
      campaignId: "role-1",
      email: "ada.example@people.example.test",
      name: "Ada Example",
      leadSource: "Applicant",
      sourcePlatform: "Manual",
    },
    {
      id: "github-1",
      campaignId: "role-1",
      email: "linus.example@people.example.test",
      name: "Linus Example",
      leadSource: "Outbound",
      sourcePlatform: "GitHub",
    },
  ]);

  assert.equal(initialOdooSync().phase, "idle");
  assert.equal(reduceOdooSync(initialOdooSync(), { type: "queue" }).phase, "idle");
  assert.equal(reduceOdooSync(initialOdooSync(), { type: "mirror" }).phase, "idle");

  const preview = reduceOdooSync(initialOdooSync(), { type: "preview", view: mixed });
  assert.equal(preview.phase, "preview");
  assert.equal(reduceOdooSync(preview, { type: "queue" }).phase, "preview");
  assert.equal(reduceOdooSync(preview, { type: "mirror" }).phase, "preview");

  const clean = reduceOdooSync(preview, { type: "preview", view: ready });
  const queued = reduceOdooSync(clean, { type: "queue" });
  assert.equal(queued.phase, "queued");
  const recorded = reduceOdooSync(queued, { type: "mirror" });
  assert.equal(recorded.phase, "recorded");
  assert.notEqual(recorded.phase, "mirrored");
  assert.equal(reduceOdooSync(queued, { type: "reset" }).phase, "idle");
});

test("each sanctioned odoo source is reachable", () => {
  const person = {
    id: "person-1",
    campaignId: "role-1",
    email: "ada.example@people.example.test",
    name: "Ada Example",
    leadSource: "Outbound" as const,
    sourcePlatform: "GitHub" as const,
  };
  const cases = [
    { intake: "recruiter-csv", source: "LinkedIn Recruiter CSV" },
    { intake: "rsc", source: "RSC/ATS" },
    { intake: "job-application", source: "Job application" },
    { intake: "candidate-supplied", source: "Candidate-supplied" },
  ] as const;
  for (const item of cases) {
    const view = projectOdooSync([
      { ...person, id: item.intake, intake: item.intake } as unknown as Parameters<typeof projectOdooSync>[0][number],
    ]);
    assert.equal(view.records[0]?.status, "ready", item.intake);
    assert.equal(view.records[0]?.source, item.source, item.intake);
  }
});

test("pipeline list machine resets the page when the filter changes and keeps selection explicit", () => {
  let state = reducePipelineList(initialPipelineList(), { type: "set-page", page: 3 });
  state = reducePipelineList(state, { type: "set-query", query: "ada" });
  assert.equal(state.page, 0);
  assert.equal(state.query, "ada");

  state = reducePipelineList(state, { type: "set-page", page: 2 });
  state = reducePipelineList(state, { type: "set-sort", sort: "recent" });
  state = reducePipelineList(state, { type: "set-stage", stage: "Sourced" });
  state = reducePipelineList(state, { type: "set-source", source: "GitHub" });
  state = reducePipelineList(state, { type: "set-page-size", pageSize: 25 });
  assert.equal(state.page, 0);
  assert.equal(state.sort, "recent");
  assert.equal(state.stage, "Sourced");
  assert.equal(state.source, "GitHub");
  assert.equal(state.pageSize, 25);

  state = reducePipelineList(state, { type: "toggle-select", id: "c1" });
  state = reducePipelineList(state, { type: "toggle-select", id: "c2" });
  state = reducePipelineList(state, { type: "toggle-select", id: "c1" });
  assert.deepEqual(state.selectedIds, ["c2"]);
  state = reducePipelineList(state, { type: "select-page", ids: ["c2", "c3"], mode: "add" });
  assert.deepEqual(state.selectedIds, ["c2", "c3"]);
  state = reducePipelineList(state, { type: "select-page", ids: ["c2"], mode: "remove" });
  assert.deepEqual(state.selectedIds, ["c3"]);

  state = reducePipelineList(state, { type: "set-bulk-stage", stage: "Rejected" });
  state = reducePipelineList(state, { type: "set-bulk-reason", reason: "Timing" });
  state = reducePipelineList(state, { type: "clear-selection" });
  assert.deepEqual(state.selectedIds, []);
  assert.equal(state.bulkStage, "");
  assert.equal(state.bulkReason, "");

  state = reducePipelineList(state, { type: "set-page", page: 4 });
  state = reducePipelineList(state, { type: "clear-filters" });
  assert.equal(state.query, "");
  assert.equal(state.stage, "all");
  assert.equal(state.source, "all");
  assert.equal(state.sort, "recent");
  assert.equal(state.page, 0);

  state = reducePipelineList(state, { type: "set-page", page: 9 });
  state = reducePipelineList(state, { type: "clamp-page", page: 1 });
  assert.equal(state.page, 1);
  state = reducePipelineList(state, { type: "clamp-page", page: 1 });
  assert.equal(state.page, 1);
});

test("pipeline candidate filter matches the candidates page", () => {
  const candidates = [
    {
      id: "low",
      name: "Ada Example",
      currentTitle: "Engineer",
      currentCompany: "Northwind",
      stage: "Sourced",
      sourcePlatform: "GitHub",
      matchScore: 10,
      lastContactedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "high",
      name: "Bea Example",
      currentTitle: "Staff Engineer",
      currentCompany: "Brightloop",
      stage: "Sourced",
      sourcePlatform: "Manual",
      matchScore: 90,
      lastContactedAt: "2026-02-01T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "hired",
      name: "Cy Example",
      currentTitle: "Manager",
      currentCompany: "Northwind",
      stage: "Hired",
      sourcePlatform: "GitHub",
      matchScore: 80,
      lastContactedAt: null,
      createdAt: "2026-03-01T00:00:00.000Z",
    },
  ];
  assert.deepEqual(
    filterPipelineCandidates(candidates, {
      query: "northwind",
      sort: "match",
      stage: "all",
      source: "all",
    }).map((candidate) => candidate.id),
    ["hired", "low"],
  );
  assert.deepEqual(
    filterPipelineCandidates(candidates, {
      query: "",
      sort: "recent",
      stage: "Sourced",
      source: "all",
    }).map((candidate) => candidate.id),
    ["high", "low"],
  );
});

test("outreach queue and approval batch machines keep the page transitions", () => {
  let queue = initialOutreachQueue("campaign-1");
  assert.equal(queue.campaignFilter, "campaign-1");
  queue = reduceOutreachQueue(queue, { type: "set-campaign", campaignId: "all" });
  queue = reduceOutreachQueue(queue, { type: "toggle-sent" });
  queue = reduceOutreachQueue(queue, { type: "toggle-glass", id: "m1" });
  queue = reduceOutreachQueue(queue, { type: "toggle-glass", id: "m1" });
  queue = reduceOutreachQueue(queue, { type: "toggle-expanded", id: "m2" });
  queue = reduceOutreachQueue(queue, { type: "toggle-expanded", id: "m3" });
  queue = reduceOutreachQueue(queue, { type: "set-composer", open: true });
  queue = reduceOutreachQueue(queue, { type: "draft-start", total: 4 });
  queue = reduceOutreachQueue(queue, { type: "draft-progress", done: 2, total: 4 });
  assert.equal(queue.sentOpen, true);
  assert.equal(queue.glassBoxId, null);
  assert.equal(queue.expandedId, "m3");
  assert.equal(queue.composerOpen, true);
  assert.equal(queue.draftingAll, true);
  assert.deepEqual(queue.draftProgress, { done: 2, total: 4 });
  const aborted = queue;
  queue = reduceOutreachQueue(queue, { type: "draft-finish" });
  assert.equal(queue.draftingAll, false);
  assert.deepEqual(queue.draftProgress, aborted.draftProgress);

  let batch = initialApprovalBatch();
  batch = reduceApprovalBatch(batch, { type: "toggle", id: "m1" });
  batch = reduceApprovalBatch(batch, { type: "toggle", id: "m1" });
  batch = reduceApprovalBatch(batch, { type: "replace", ids: ["m1", "m2"] });
  batch = reduceApprovalBatch(batch, { type: "begin" });
  const ignored = reduceApprovalBatch(batch, { type: "begin" });
  assert.equal(ignored, batch);
  batch = reduceApprovalBatch(batch, { type: "finish", blockedIds: ["m2"] });
  assert.deepEqual(batch.selectedIds, ["m2"]);
  assert.equal(batch.approving, false);
  batch = reduceApprovalBatch(batch, { type: "begin" });
  batch = reduceApprovalBatch(batch, { type: "end" });
  assert.equal(batch.approving, false);
  assert.deepEqual(batch.selectedIds, ["m2"]);
});

test("reports console and exec period stay on the existing defaults", () => {
  assert.equal(initialReportsConsole().generating, false);
  let reports = reduceReportsConsole(initialReportsConsole(), { type: "select", id: "campaign-9" });
  reports = reduceReportsConsole(reports, { type: "begin-generate" });
  const second = reduceReportsConsole(reports, { type: "begin-generate" });
  assert.equal(second, reports);
  reports = reduceReportsConsole(reports, { type: "finish-generate" });
  assert.equal(reports.generating, false);
  assert.equal(reports.selectedId, "campaign-9");
  assert.equal(reduceReportPeriod("30d", "7d"), "7d");
  assert.equal(reduceReportPeriod("30d", "90d"), "90d");
  assert.equal(reduceReportPeriod("7d", "nope"), "7d");
});

test("settings console machine matches the accordion and deep-link rules", () => {
  const initial = initialSettingsConsole();
  assert.equal(initial.tab, "integrations");
  assert.equal(initial.openSection, "04");

  const invalid = reduceSettingsConsole(initial, { type: "go-tab", tab: "nope", hash: null }, () => {
    throw new Error("invalid tabs do not read session");
  });
  assert.equal(invalid.state, initial);
  assert.deepEqual(invalid.effects, []);

  const ai = reduceSettingsConsole(initial, { type: "go-tab", tab: "ai", hash: null }, () => "19");
  assert.equal(ai.state.tab, "ai");
  assert.equal(ai.state.openSection, "19");
  assert.deepEqual(ai.effects, [
    { type: "persist-section", tab: "ai", section: "19" },
    { type: "replace-url", tab: "ai", hash: null },
  ]);

  const hashed = reduceSettingsConsole(
    initial,
    { type: "go-tab", tab: "integrations", hash: "#email-connections-panel" },
    () => {
      throw new Error("a hash suppresses the session read");
    },
  );
  assert.equal(hashed.state.openSection, "04");
  assert.deepEqual(
    hashed.effects.map((effect) => effect.type),
    ["persist-section", "replace-url", "scroll"],
  );

  const located = reduceSettingsConsole(
    initial,
    { type: "apply-location", tabParam: null, hash: "linkedin" },
    () => {
      throw new Error("a hash suppresses the session read");
    },
  );
  assert.equal(located.state.tab, "integrations");
  assert.equal(located.state.openSection, "20");
  assert.equal(located.effects.some((effect) => effect.type === "scroll" && effect.hash === "linkedin"), true);
  assert.equal(located.effects.some((effect) => effect.type === "replace-url" && effect.tab === "integrations"), true);

  const section = reduceSettingsConsole(initial, { type: "open-section", section: "20" }, () => null);
  assert.equal(section.state.tab, "integrations");
  assert.equal(section.state.openSection, "20");
  assert.deepEqual(section.effects, [{ type: "persist-section", tab: "integrations", section: "20" }]);

  const hashChange = reduceSettingsConsole(
    { tab: "workspace", openSection: "01" },
    { type: "hash-change", tabParam: "workspace", hash: "#linkedin", currentTab: "workspace" },
    () => null,
  );
  assert.equal(hashChange.state.tab, "integrations");
  assert.equal(hashChange.state.openSection, "20");
  assert.equal(hashChange.effects.some((effect) => effect.type === "replace-url"), true);
  assert.equal(hashChange.effects.some((effect) => effect.type === "scroll"), true);

  const emptyHash = reduceSettingsConsole(
    initial,
    { type: "hash-change", tabParam: null, hash: "", currentTab: "integrations" },
    () => null,
  );
  assert.equal(emptyHash.state, initial);
  assert.deepEqual(emptyHash.effects, []);
});

test("pipeline and settings action factories keep the store transitions and stay React-free", () => {
  const seed = buildSeedState();
  const target = seed.candidates[0];
  assert.ok(target);
  let next = seed;
  const pipeline = createPipelineActions({
    commit: (update) => {
      next = update(next);
      return true;
    },
    commitPersisted: async (update) => {
      next = update(next);
      return true;
    },
    workspaceEffectAllowed: () => true,
    sourcingMutationAllowed: () => true,
  });
  pipeline.setCandidateStage(target.id, "Interviewed");
  const updated = next.candidates.find((candidate) => candidate.id === target.id);
  assert.equal(updated?.stage, "Interviewed");
  assert.ok((updated?.maxStageRank ?? 0) >= stageRank("Interviewed"));

  const stageBeforeRefusal = seed.candidates.find((candidate) => candidate.id === target.id)?.stage;
  const blocked = createPipelineActions({
    commit: () => false,
    commitPersisted: async () => false,
    workspaceEffectAllowed: () => false,
    sourcingMutationAllowed: () => false,
  });
  blocked.setCandidateStage(target.id, "Hired");
  assert.equal(
    seed.candidates.find((candidate) => candidate.id === target.id)?.stage,
    stageBeforeRefusal,
  );

  const integration = seed.integrations[0];
  assert.ok(integration);
  const settings = createSettingsActions({
    commit: (update) => {
      next = update(next);
      return true;
    },
  });
  settings.updateSettings({ operatorName: "Synthetic Operator" });
  assert.equal(next.settings.operatorName, "Synthetic Operator");
  settings.toggleIntegrationMode(integration.id);
  assert.notEqual(
    next.integrations.find((item) => item.id === integration.id)?.mode,
    integration.mode,
  );
  assert.match(next.activities[0]?.title ?? "", /Integration mode changed/);

  for (const path of ["src/features/pipeline/actions.ts", "src/features/settings/actions.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /["']use client["']/);
    assert.doesNotMatch(source, /from ["']react["']/);
  }
  assert.match(storeSource, /createPipelineActions\(/);
  assert.match(storeSource, /createSettingsActions\(/);
  assert.equal((storeSource.match(/const setCandidateStage = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const updateSettings = useCallback/g) ?? []).length, 0);
});

test("command binding is a typed view of the existing actions and adds no send path", () => {
  const actions = {
    setCandidateStage: () => undefined,
    setRejectionReason: () => undefined,
    toggleVivier: () => undefined,
    addCandidateNote: () => undefined,
    generateOutreachFor: () => null,
    generateOutreachLive: async () => null,
    updateOutreach: () => undefined,
    regenerateOutreach: async () => undefined,
    draftFollowUpFor: async () => null,
    draftRecontactFor: async () => null,
    approveOutreach: async () => ({ allowed: false, blockers: [], warnings: [] }),
    rejectOutreach: async () => ({ ok: false }),
    sendApprovedOutreach: async () => ({ ok: false }),
    confirmManualSend: () => ({ ok: false }),
    generateReport: () => null,
    setSkillUpdateStatus: () => false,
    updateSettings: () => undefined,
    updateIntegration: () => undefined,
    toggleIntegrationMode: () => undefined,
    testIntegration: async () => ({ ok: false, detail: "synthetic" }),
  } as unknown as WorkspaceActions;
  const commands = bindConsoleCommands(actions);
  assert.deepEqual(Object.keys(commands).sort(), ["approvals", "outreach", "pipeline", "reports", "settings"]);
  assert.equal(commands.pipeline.setCandidateStage, actions.setCandidateStage);
  assert.equal(commands.approvals.approveOutreach, actions.approveOutreach);
  assert.equal(commands.outreach.generateOutreachFor, actions.generateOutreachFor);
  assert.equal(commands.reports.generateReport, actions.generateReport);
  assert.equal(commands.settings.updateSettings, actions.updateSettings);
});

test("store drops imports the feature split left unused", () => {
  const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
  const importSection = store.slice(0, store.indexOf("const ARIA_STRONG_RATINGS"));
  for (const name of [
    "firstInterviewElapsedHours",
    "realFunnelFacts",
    "computeCampaignMetrics",
    "ChatboxSubmissionStatus",
    "InterviewKind",
    "InterviewRecord",
    "LeadSource",
    "PrequalOutcome",
    "PrequalRecord",
    "SkillUpdate",
  ]) {
    assert.equal(importSection.includes(name), false, name);
  }
});

test("reports page shows the odoo hand-off preview", () => {
  const page = readFileSync(new URL("../src/app/reports/page.tsx", import.meta.url), "utf8");
  assert.match(page, /desk\.odoo/);
  assert.match(page, /No record is written/);
});

test("console hooks read through the workspace client", () => {
  for (const path of [
    "src/features/pipeline/hooks.ts",
    "src/features/outreach/hooks.ts",
    "src/features/approvals/hooks.ts",
    "src/features/reports/hooks.ts",
    "src/features/settings/hooks.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /createWorkspaceConsoleClient\(/, path);
  }
});

test("feature modules do not import linkedin, autopilot, the approval ledger, or dispatch", () => {
  const files = sourceFiles("src/features");
  assert.ok(files.length > 0);
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*linkedin/, path);
    assert.doesNotMatch(source, /from ["'][^"']*autopilot/, path);
    assert.doesNotMatch(source, /from ["'][^"']*outreach-approval/, path);
    assert.doesNotMatch(source, /from ["'][^"']*dispatch-outbound/, path);
    assert.doesNotMatch(source, /\bfetch\(/, path);
    assert.doesNotMatch(source, /linkedin\.com/, path);
  }
});
