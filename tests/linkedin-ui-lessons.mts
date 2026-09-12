/* ==========================================================================
   tests/linkedin-ui-lessons.mts
   VM second-brain LinkedIn UI lesson store — copy lessons stay in outreach_skill.
   ========================================================================== */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const dir = mkdtempSync(path.join(tmpdir(), "aria-li-lessons-"));
process.env.ARIA_DATA_DIR = dir;
process.env.ARIA_DATA_DIR = dir;

const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const {
  appendLinkedInUiLesson,
  readLinkedInUiLessons,
  linkedInUiLessonHints,
  preferConnectFromLessons,
} = await import("../src/lib/openbot/linkedin-ui-lessons.ts");

ok("starts empty", readLinkedInUiLessons().length === 0);

appendLinkedInUiLesson({
  goal: "path",
  ok: false,
  detail: "Message path failed — try Connect first",
});
appendLinkedInUiLesson({
  goal: "connect",
  ok: true,
  detail: "Connect worked",
  preferredName: "Connect",
});
appendLinkedInUiLesson({
  goal: "path",
  ok: true,
  detail: "Connect+note path landed",
  preferredName: "Connect",
});

ok("stores lessons", readLinkedInUiLessons().length === 3);
ok("preferConnectFromLessons true after connect wins", preferConnectFromLessons() === true);
ok(
  "hints mention Connect",
  /Connect/.test(linkedInUiLessonHints("connect")),
);
ok(
  "hints mention prior Message failure",
  /Message path failed/.test(linkedInUiLessonHints("path")),
);

// Contract: linkedin-send wires lessons
const { readFileSync } = await import("node:fs");
const send = readFileSync("src/lib/openbot/linkedin-send.ts", "utf8");
ok("send imports ui lessons", send.includes("linkedin-ui-lessons"));
ok("send appends lessons on outcomes", send.includes("appendLinkedInUiLesson"));
ok("send injects lesson hints into resolveRef", send.includes("linkedInUiLessonHints"));
ok("send scopes lessons with seatId", send.includes("seatId: input.seatId"));

rmSync(dir, { recursive: true, force: true });
console.log(`linkedin-ui-lessons: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
