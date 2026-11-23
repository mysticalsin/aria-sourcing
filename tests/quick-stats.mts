import { readFileSync } from "node:fs";
import {
  QUICK_STAT_IDS,
  formatQuickStatValue,
  quickStatNow,
  selectQuickStats,
  startOfUtcWeek,
} from "../src/lib/quick-stats.ts";
import { SEED_NOW } from "../src/lib/utils.ts";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

const missing = selectQuickStats({});
check("missing collections stay unavailable", missing.every((stat) => stat.value == null));
check("unavailable value renders an em dash", formatQuickStatValue(null) === "—");
check(
  "six cards in Tony's order",
  missing.map((stat) => stat.id).join(",") === QUICK_STAT_IDS.join(","),
);
check(
  "card labels",
  missing.map((stat) => stat.label).join("|") ===
    [
      "Candidates to rate",
      "In assessment",
      "Interviews this week",
      "Outreach awaiting approval",
      "Replies",
      "Hires",
    ].join("|"),
);

const empty = selectQuickStats({
  candidates: [],
  interviews: [],
  approvals: [],
  replies: [],
  now: SEED_NOW,
});
check("empty collections are zero", empty.every((stat) => stat.value === 0));

const counted = selectQuickStats({
  candidates: [
    { stage: "Sourced" },
    { stage: "To Rate" },
    { stage: "Contacted" },
    { stage: "To Assess" },
    { stage: "Hired" },
    { stage: "Rejected" },
    { stage: null },
  ],
  approvals: [{ status: "Needs Approval" }, { status: "Approved" }, { status: "Draft" }],
  replies: [{ id: "r1" }, { id: "r2" }],
  interviews: [],
  now: SEED_NOW,
});
check("to rate counts Sourced and To Rate", counted[0].value === 2);
check("assessment counts Contacted and To Assess", counted[1].value === 2);
check("hires count Hired only", counted[5].value === 1);
check("awaiting approval is Needs Approval", counted[3].value === 1);
check("replies count every row", counted[4].value === 2);

const weekStart = startOfUtcWeek(new Date("2026-06-26T09:00:00.000Z"));
check("Friday 26 Jun 2026 starts the week on Monday 22 Jun", weekStart === Date.parse("2026-06-22T00:00:00.000Z"));
check(
  "Monday 00:00:00 is inside the week",
  selectQuickStats({
    interviews: [{ startTime: "2026-06-22T00:00:00.000Z", status: "Confirmed" }],
    now: new Date("2026-06-26T09:00:00.000Z"),
  })[2].value === 1,
);
check(
  "one millisecond before Monday is the previous week",
  selectQuickStats({
    interviews: [{ startTime: "2026-06-21T23:59:59.999Z", status: "Confirmed" }],
    now: new Date("2026-06-22T00:00:01.000Z"),
  })[2].value === 0,
);
check(
  "Sunday 23:59:59 stays in the Monday week",
  selectQuickStats({
    interviews: [{ startTime: "2026-06-28T23:59:59.000Z", status: "Proposed" }],
    now: new Date("2026-06-22T00:00:00.000Z"),
  })[2].value === 1,
);
check(
  "the next Monday is a new week",
  selectQuickStats({
    interviews: [{ startTime: "2026-06-29T00:00:00.000Z", status: "Confirmed" }],
    now: new Date("2026-06-22T12:00:00.000Z"),
  })[2].value === 0,
);

const yearWeek = new Date("2026-01-01T12:00:00.000Z");
check(
  "1 Jan 2026 belongs to the week that opened 29 Dec 2025",
  startOfUtcWeek(yearWeek) === Date.parse("2025-12-29T00:00:00.000Z"),
);
check(
  "a booking on 1 Jan counts in that crossing week",
  selectQuickStats({
    interviews: [{ startTime: "2026-01-01T08:00:00.000Z", status: "Confirmed" }],
    now: yearWeek,
  })[2].value === 1,
);
check(
  "Cancelled and No Show are excluded",
  selectQuickStats({
    interviews: [
      { startTime: "2026-06-24T15:00:00.000Z", status: "Cancelled" },
      { startTime: "2026-06-24T16:00:00.000Z", status: "No Show" },
      { startTime: "2026-06-24T17:00:00.000Z", status: "Completed" },
    ],
    now: SEED_NOW,
  })[2].value === 1,
);
check("demo clock is the seed clock", quickStatNow({ synthetic: true }).toISOString() === SEED_NOW.toISOString());
check("live clock is not the seed clock", quickStatNow({ synthetic: false }).getTime() !== SEED_NOW.getTime());

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
check("command center selects quick stats", page.includes("selectQuickStats("));
check("command center formats each card", page.includes("formatQuickStatValue("));
check("old campaign KPI labels are gone from the card list", !page.includes('label: "Active campaigns"'));
check("old reply-rate KPI is gone from the card list", !page.includes('label: "Reply rate"'));

console.log(`RESULT quick-stats: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
