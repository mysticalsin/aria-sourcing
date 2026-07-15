import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(
  new URL("../src/lib/store.ts", import.meta.url),
  "utf8",
);
const contractsSource = readFileSync(
  new URL("../src/lib/store/contracts.ts", import.meta.url),
  "utf8",
);
const bookingCalendarSource = readFileSync(
  new URL("../src/components/calendar/booking-calendar.tsx", import.meta.url),
  "utf8",
);
const candidateDrawerSource = readFileSync(
  new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url),
  "utf8",
);
const campaignPageSource = readFileSync(
  new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
  "utf8",
);
const ariaLiveSource = readFileSync(
  new URL("../src/lib/demo/aria-live.ts", import.meta.url),
  "utf8",
);
const skillDecisionSources = [
  "../src/components/reports/skill-update-card.tsx",
  "../src/app/skills/page.tsx",
  "../src/components/skills/learning-session.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

function actionBody(start: string, end: string): string {
  const from = storeSource.indexOf(start);
  const to = storeSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return storeSource.slice(from, to);
}

test("booking creation cannot emit or return success after a rejected commit", () => {
  const body = actionBody("const createBookingFor", "const updateBooking");
  assert.match(body, /const committed = commit\(/);
  assert.match(body, /if \(!committed\)[\s\S]*?ok: false/);
  assert.ok(
    body.indexOf("if (!committed)") < body.indexOf("emit({ kind: \"book\""),
    "the rejection guard must run before the booking event",
  );
  assert.doesNotMatch(body, /Teams \+ Cal\.com links generated/);
  assert.doesNotMatch(candidateDrawerSource, /Teams \+ Cal\.com links generated/);
  assert.doesNotMatch(campaignPageSource, /Teams \+ Cal\.com links generated/);
});

test("booking updates reject unknown records, propagate commit rejection, and synchronize the candidate snapshot", () => {
  const body = actionBody("const updateBooking", "const generateReport");
  assert.ok(
    body.indexOf('if (!booking) return { ok: false, error: "Booking not found." };') <
      body.indexOf("const keys = Object.keys(patch);"),
    "unknown bookings must fail for status-only patches too",
  );
  assert.match(body, /const committed = commit\(/);
  assert.match(
    body,
    /if \(Object\.hasOwn\(safePatch, "startTime"\) \|\| Object\.hasOwn\(safePatch, "endTime"\)\)/,
  );
  assert.match(body, /booking:\s*\{\s*\.\.\.candidate\.booking,\s*\.\.\.safePatch\s*\}/);
  assert.match(body, /return committed && updated[\s\S]*?\? \{ ok: true \}/);
  assert.match(bookingCalendarSource, /const result = actions\.updateBooking\(booking\.id, \{ status \}\);[\s\S]*?if \(!result\.ok\)/);
});

test("report generation returns no report when its state commit is rejected", () => {
  const body = actionBody("const generateReport", "const setSkillUpdateStatus");
  assert.match(body, /const committed = commit\(/);
  assert.match(body, /return committed \? report : null/);
  assert.match(ariaLiveSource, /const report = actions\.generateReport\(campaign\.id\);[\s\S]*?if \(!report\)[\s\S]*?fail\(/);
});

test("a learning decision is one validated commit and every caller handles rejection", () => {
  const body = actionBody("const setSkillUpdateStatus", "candidate compliance");
  assert.match(contractsSource, /setSkillUpdateStatus:[\s\S]*?\) => boolean;/);
  assert.match(body, /if \(!campaign \|\| !skill\) return false;/);
  assert.match(body, /skill\.status !== "proposed"[\s\S]*?return false/);
  assert.match(body, /status !== "accepted"[\s\S]*?status !== "rejected"[\s\S]*?return false/);
  assert.match(body, /status === "accepted"[\s\S]*?applyLearning/);
  for (const source of skillDecisionSources) {
    assert.doesNotMatch(source, /actions\.acceptSkillLearning\(/);
    assert.match(source, /const (?:updated|accepted|rejected) = actions\.setSkillUpdateStatus/);
  }
});
