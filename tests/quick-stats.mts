import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandCenterStats } from "../src/components/dashboard/command-center-stats.tsx";
import { MetricCard } from "../src/components/dashboard/metric-card.tsx";
import {
  formatQuickStatValue,
  selectAwaitingApproval,
  selectCandidatesToRate,
  selectHires,
  selectInAssessment,
  selectInterviewsThisWeek,
  selectQuickStats,
  selectReplies,
  type QuickStatSource,
} from "../src/lib/quick-stats.ts";
import { processingStageIdFor } from "../src/lib/processing-stages.ts";

const WEEK = new Date("2026-11-20T15:00:00.000Z");

test("MetricCard renders zero, a large number, and missing data", () => {
  const zero = renderToStaticMarkup(
    createElement(MetricCard, { label: "Candidates to rate", value: 0, hint: "None waiting" }),
  );
  assert.match(zero, /Candidates to rate/);
  assert.match(zero, />0</);
  assert.match(zero, /None waiting/);

  const large = renderToStaticMarkup(
    createElement(MetricCard, { label: "Replies", value: "1,000,000", hint: "Received" }),
  );
  assert.match(large, /1,000,000/);
  assert.doesNotMatch(large, /999\+/);

  const missing = renderToStaticMarkup(
    createElement(MetricCard, { label: "Hires", value: "—", hint: "Count unavailable" }),
  );
  assert.match(missing, /—/);
  assert.match(missing, /Count unavailable/);
});

test("formatQuickStatValue keeps zero, groups large numbers, and marks missing data", () => {
  assert.equal(formatQuickStatValue(0), "0");
  assert.equal(formatQuickStatValue(10000), "10,000");
  assert.equal(formatQuickStatValue(1_000_000), "1,000,000");
  assert.equal(formatQuickStatValue(null), "—");
});

test("candidates to rate is zero, unclamped, or missing", () => {
  assert.equal(selectCandidatesToRate([]), 0);
  assert.equal(selectCandidatesToRate(null), null);
  assert.equal(selectCandidatesToRate(undefined), null);
  const many = Array.from({ length: 10000 }, () => ({ stage: "Sourced" }));
  many.push({ stage: "To Rate" }, { stage: "Hired" }, { stage: "Contacted" });
  assert.equal(selectCandidatesToRate(many), 10001);
});

test("in assessment counts Contacted and To Assess only", () => {
  assert.equal(selectInAssessment([]), 0);
  assert.equal(selectInAssessment(null), null);
  assert.equal(
    selectInAssessment([
      { stage: "Contacted" },
      { stage: "To Assess" },
      { stage: "Sourced" },
      { stage: null },
      {},
    ]),
    2,
  );
});

test("interviews this week honour the UTC week and drop cancelled or undated rows", () => {
  assert.equal(selectInterviewsThisWeek([], WEEK), 0);
  assert.equal(selectInterviewsThisWeek(null, WEEK), null);
  assert.equal(selectInterviewsThisWeek(undefined, WEEK), null);
  assert.equal(
    selectInterviewsThisWeek(
      [
        { startTime: "2026-11-16T00:00:00.000Z", status: "Confirmed" },
        { startTime: "2026-11-22T23:59:59.000Z", status: "Proposed" },
        { startTime: "2026-11-15T23:59:59.000Z", status: "Confirmed" },
        { startTime: "2026-11-23T00:00:00.000Z", status: "Confirmed" },
        { startTime: "2026-11-18T12:00:00.000Z", status: "Cancelled" },
        { startTime: "2026-11-18T12:00:00.000Z", status: "No Show" },
        { startTime: null, status: "Confirmed" },
        { startTime: "not-a-date", status: "Confirmed" },
        { status: "Confirmed" },
      ],
      WEEK,
    ),
    2,
  );
});

test("outreach awaiting approval counts Needs Approval only", () => {
  assert.equal(selectAwaitingApproval([]), 0);
  assert.equal(selectAwaitingApproval(null), null);
  assert.equal(
    selectAwaitingApproval([
      { status: "Needs Approval" },
      { status: "Needs Approval" },
      { status: "Draft" },
      { status: "Approved" },
      { status: "Pending Manual Send" },
      { status: "needs approval" },
      {},
    ]),
    2,
  );
});

test("replies count every row, including a row with no id", () => {
  assert.equal(selectReplies([]), 0);
  assert.equal(selectReplies(null), null);
  assert.equal(selectReplies(undefined), null);
  assert.equal(selectReplies([{}, { id: "r1" }, { id: null }]), 3);
});

test("hires count Hired and ignore To Hire", () => {
  assert.equal(selectHires([]), 0);
  assert.equal(selectHires(null), null);
  assert.equal(
    selectHires([{ stage: "Hired" }, { stage: "Hired" }, { stage: "To Hire" }, { stage: "Offer" }]),
    2,
  );
});

test("selectQuickStats returns the six sourcing metrics in order", () => {
  const missing: QuickStatSource = {
    candidates: null,
    interviews: null,
    approvals: null,
    replies: null,
    now: WEEK,
  };
  const stats = selectQuickStats(missing);
  assert.deepEqual(
    stats.map((stat) => stat.id),
    ["toRate", "inAssessment", "interviewsThisWeek", "awaitingApproval", "replies", "hires"],
  );
  assert.deepEqual(
    stats.map((stat) => stat.label),
    [
      "Candidates to rate",
      "In assessment",
      "Interviews this week",
      "Outreach awaiting approval",
      "Replies",
      "Hires",
    ],
  );
  assert.deepEqual(
    stats.map((stat) => stat.value),
    [null, null, null, null, null, null],
  );
  for (const stat of stats) assert.equal(stat.hint, "Count unavailable");

  const zeros = selectQuickStats({ candidates: [], interviews: [], approvals: [], replies: [], now: WEEK });
  assert.deepEqual(
    zeros.map((stat) => stat.value),
    [0, 0, 0, 0, 0, 0],
  );
});

test("Command Center stats render selector results through MetricCard", () => {
  const html = renderToStaticMarkup(
    createElement(CommandCenterStats, {
      source: {
        now: WEEK,
        candidates: [{ stage: "Sourced" }, { stage: "Contacted" }, { stage: "Hired" }],
        interviews: [{ startTime: "2026-11-20T09:00:00.000Z", status: "Confirmed" }],
        approvals: [{ status: "Needs Approval" }],
        replies: [{ id: "r1" }, { id: "r2" }],
      },
    }),
  );
  assert.match(html, /aria-label="Quick stats"/);
  assert.match(html, /Candidates to rate/);
  assert.match(html, /In assessment/);
  assert.match(html, /Interviews this week/);
  assert.match(html, /Outreach awaiting approval/);
  assert.match(html, /Replies/);
  assert.match(html, /Hires/);
  assert.match(html, />2</);
  assert.equal((html.match(/>1</g) ?? []).length >= 3, true);
});

test("processing stages cover the sourcing flow and leave unknown stages out", () => {
  assert.equal(processingStageIdFor("Sourced"), "to-rate");
  assert.equal(processingStageIdFor("To Rate"), "to-rate");
  assert.equal(processingStageIdFor("Contacted"), "to-assess");
  assert.equal(processingStageIdFor("To Assess"), "to-assess");
  assert.equal(processingStageIdFor("Replied"), "to-interview");
  assert.equal(processingStageIdFor("Interested"), "to-interview");
  assert.equal(processingStageIdFor("To Interview"), "to-interview");
  assert.equal(processingStageIdFor("Booked"), "shoot");
  assert.equal(processingStageIdFor("Shoot"), "shoot");
  assert.equal(processingStageIdFor("Interviewed"), "qm");
  assert.equal(processingStageIdFor("QM"), "qm");
  assert.equal(processingStageIdFor("Offer"), "to-hire");
  assert.equal(processingStageIdFor("To Hire"), "to-hire");
  assert.equal(processingStageIdFor("Hired"), "hired");
  assert.equal(processingStageIdFor("Rejected"), "rejected");
  assert.equal(processingStageIdFor("Not Interested"), "rejected");
  assert.equal(processingStageIdFor("Suppressed"), "withdrawn");
  assert.equal(processingStageIdFor("Withdrawn"), "withdrawn");
  assert.equal(processingStageIdFor("Somewhere else"), null);
  assert.equal(processingStageIdFor(null), null);
  assert.equal(processingStageIdFor(undefined), null);
});
