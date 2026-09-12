/* ==========================================================================
   tests/linkedin-ui-lessons.mts
   VM second-brain LinkedIn UI lesson store — copy lessons stay in outreach_skill.
   ========================================================================== */

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "aria-li-lessons-"));
process.env.ARIA_DATA_DIR = dir;

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
  preferNamedHeuristic,
  preferredControlNames,
  humanUiPaceMs,
} = await import("../src/lib/openbot/linkedin-ui-lessons.ts");

ok("starts empty", readLinkedInUiLessons().length === 0);

appendLinkedInUiLesson({
  goal: "path",
  ok: false,
  detail: "Message path failed — try Connect first",
  seatId: "seat-a",
});
appendLinkedInUiLesson({
  goal: "connect",
  ok: true,
  detail: "Connect worked",
  preferredName: "Connect",
  seatId: "seat-a",
});
appendLinkedInUiLesson({
  goal: "path",
  ok: true,
  detail: "Connect+note path landed",
  preferredName: "Connect",
  seatId: "seat-a",
});

ok("stores lessons", readLinkedInUiLessons().length === 3);
ok("preferConnectFromLessons true after connect wins", preferConnectFromLessons() === true);
ok("hints mention Connect", /Connect/.test(linkedInUiLessonHints("connect")));
ok(
  "hints mention prior Message failure",
  /Message path failed/.test(linkedInUiLessonHints("path")),
);
ok(
  "seat-scoped hints still see Connect for seat-a",
  /Connect/.test(linkedInUiLessonHints("connect", 4, "seat-a")),
);
ok(
  "preferredControlNames returns Connect",
  preferredControlNames("connect", "seat-a")[0] === "Connect",
);
ok(
  "preferNamedHeuristic ranks Connect first",
  preferNamedHeuristic(
    [{ name: "Message" }, { name: "Connect" }],
    "connect",
    "seat-a",
  )?.name === "Connect",
);
ok("humanUiPaceMs click is human-scale", humanUiPaceMs("click") >= 400 && humanUiPaceMs("click") < 900);

const send = readFileSync("src/lib/openbot/linkedin-send.ts", "utf8");
ok("send imports ui lessons", send.includes("linkedin-ui-lessons"));
ok("send appends lessons on outcomes", send.includes("appendLinkedInUiLesson"));
ok("send injects lesson hints into resolveRef", send.includes("linkedInUiLessonHints"));
ok("send scopes lessons with seatId", send.includes("seatId: input.seatId"));
ok("send uses human pacing", send.includes("humanUiPause"));
ok("send re-ranks with preferNamedHeuristic", send.includes("preferNamedHeuristic"));

rmSync(dir, { recursive: true, force: true });
console.log(`linkedin-ui-lessons: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
