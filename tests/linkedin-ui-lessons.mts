/* ==========================================================================
   tests/linkedin-ui-lessons.mts
   VM second-brain LinkedIn UI lessons — compact index, LLM skip, adaptive pace.
   Copy lessons stay in outreach_skill.
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
  readLinkedInUiLessonIndex,
  linkedInUiLessonHints,
  preferConnectFromLessons,
  preferNamedHeuristic,
  preferredControlNames,
  humanUiPaceMs,
  linkedInUiLessonConfidence,
  shouldSkipLinkedInUiLlm,
  pickElementByLesson,
  recordLinkedInUiLlmSkip,
  linkedInUiLessonEfficiency,
} = await import("../src/lib/openbot/linkedin-ui-lessons.ts");

ok("starts empty", readLinkedInUiLessons().length === 0);
ok("index starts empty", readLinkedInUiLessonIndex().entries.length === 0);

appendLinkedInUiLesson({
  goal: "path",
  ok: false,
  detail: "Message path failed — try Connect first",
  preferredName: "Message",
  seatId: "seat-a",
});
appendLinkedInUiLesson({
  goal: "connect",
  ok: true,
  detail: "Connect worked",
  preferredName: "Connect",
  seatId: "seat-a",
  durationMs: 400,
});
appendLinkedInUiLesson({
  goal: "connect",
  ok: true,
  detail: "Connect worked again",
  preferredName: "Connect",
  seatId: "seat-a",
  durationMs: 350,
});
appendLinkedInUiLesson({
  goal: "path",
  ok: true,
  detail: "Connect+note path landed",
  preferredName: "Connect",
  seatId: "seat-a",
  durationMs: 1200,
});
appendLinkedInUiLesson({
  goal: "path",
  ok: true,
  detail: "Connect+note path landed again",
  preferredName: "Connect",
  seatId: "seat-a",
  durationMs: 1100,
});

ok("stores lessons", readLinkedInUiLessons().length === 5);
ok("index has entries", readLinkedInUiLessonIndex().entries.length >= 2);
ok("preferConnectFromLessons true after connect wins", preferConnectFromLessons("seat-a") === true);

const hints = linkedInUiLessonHints("connect", 3, "seat-a");
ok("hints are compact prefer: form", /prefer:Connect/.test(hints));
ok("hints stay short (token-cheap)", hints.length < 120);

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

const conf = linkedInUiLessonConfidence("connect", "seat-a");
ok("confidence high after 2 connect wins", conf.score >= 0.7 && conf.preferredName === "Connect");
ok("shouldSkipLinkedInUiLlm true when confident", shouldSkipLinkedInUiLlm("connect", "seat-a") === true);

const picked = pickElementByLesson(
  [
    { name: "More", disabled: false },
    { name: "Connect", disabled: false },
    { name: "Message", disabled: false },
  ],
  "connect",
  "seat-a",
);
ok("pickElementByLesson finds Connect without LLM", picked?.name === "Connect");

const before = readLinkedInUiLessonIndex().totals.tokensSaved;
recordLinkedInUiLlmSkip({
  goal: "connect",
  preferredName: "Connect",
  seatId: "seat-a",
  tokensSaved: 900,
});
const after = readLinkedInUiLessonIndex().totals;
ok("recordLinkedInUiLlmSkip increments tokens", after.tokensSaved >= before + 900);
ok("recordLinkedInUiLlmSkip increments llmSkips", after.llmSkips >= 1);

const coldPace = humanUiPaceMs("click", "seat-cold");
const hotPace = humanUiPaceMs("click", "seat-a");
ok("humanUiPaceMs click is human-scale when cold", coldPace >= 400 && coldPace < 1000);
ok("confident seat paces faster than cold seat", hotPace <= coldPace * 0.85);

const eff = linkedInUiLessonEfficiency("seat-a");
ok("efficiency reports lessons", eff.lessons >= 5);
ok("efficiency reports llmSkips", eff.llmSkips >= 1);
ok("efficiency reports tokensSaved", eff.tokensSaved >= 900);
ok("efficiency paceMultiplier faster when confident", eff.paceMultiplier <= 0.6);
ok("efficiency topControls includes Connect", eff.topControls.some((c) => c.name === "Connect"));

// Seat isolation: seat-b should not inherit seat-a confidence blindly when it has its own fails
appendLinkedInUiLesson({
  goal: "connect",
  ok: false,
  detail: "Connect missing on this desk",
  preferredName: "Connect",
  seatId: "seat-b",
});
ok(
  "seat-b confidence lower than seat-a for connect",
  linkedInUiLessonConfidence("connect", "seat-b").score <
    linkedInUiLessonConfidence("connect", "seat-a").score,
);

const send = readFileSync("src/lib/openbot/linkedin-send.ts", "utf8");
ok("send imports ui lessons", send.includes("linkedin-ui-lessons"));
ok("send appends lessons on outcomes", send.includes("appendLinkedInUiLesson"));
ok("send injects compact lesson hints", send.includes("linkedInUiLessonHints"));
ok("send scopes lessons with seatId", send.includes("seatId: input.seatId"));
ok("send uses human pacing", send.includes("humanUiPause"));
ok("send re-ranks with preferNamedHeuristic", send.includes("preferNamedHeuristic"));
ok("send skips LLM when lessons confident", send.includes("shouldSkipLinkedInUiLlm"));
ok("send picks by lesson before Aria", send.includes("pickElementByLesson"));
ok("send records LLM skip token savings", send.includes("recordLinkedInUiLlmSkip"));

const llmPick = readFileSync("src/lib/openbot/llm-pick-element.ts", "utf8");
ok("llm pick shrinks element dump when prefer hints present", llmPick.includes("preferredNamesFromGoal"));

rmSync(dir, { recursive: true, force: true });
console.log(`linkedin-ui-lessons: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
