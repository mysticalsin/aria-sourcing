import { classifySendOutcome } from "../src/lib/send-outcome";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "computer_starting is wait, not hard error",
  classifySendOutcome({
    status: "deferred",
    paceReason: "computer_starting",
    detail: "Computer is starting",
  }).kind === "gap_wait",
);
ok(
  "manual_permission_mode is refused, not hard error",
  classifySendOutcome({
    status: "deferred",
    paceReason: "manual_permission_mode",
  }).kind === "refused_human_control",
);
ok(
  "human-has-control paceReason is refused",
  classifySendOutcome({
    status: "deferred",
    paceReason: "human-has-control",
  }).kind === "refused_human_control",
);
ok(
  "generic deferred is wait, not Send failed",
  classifySendOutcome({ status: "deferred", detail: "try later" }).kind === "gap_wait",
);
ok(
  "real failure still errors",
  classifySendOutcome({ status: "error", detail: "boom" }).kind === "error",
);

console.log(`RESULT send-outcome: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
