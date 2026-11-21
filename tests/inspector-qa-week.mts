import assert from "node:assert/strict";
import { selectInterviewsThisWeek } from "../src/lib/quick-stats.ts";

const now = new Date("2026-06-21T14:00:00.000Z");
const count = selectInterviewsThisWeek(
  [{ startTime: "2026-06-16T00:00:00.000Z", status: "Confirmed" }],
  now,
);
assert.equal(count, 1);
