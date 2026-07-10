import { shouldResetAriaChecklist } from "../src/lib/aria-command-console-state";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

ok(
  "a new instruction resets after an in-flight run settles",
  shouldResetAriaChecklist({ previousText: "source backend engineers", text: "draft outreach", running: false }) === true,
);
ok(
  "a new instruction does not erase active run rows",
  shouldResetAriaChecklist({ previousText: "source backend engineers", text: "draft outreach", running: true }) === false,
);
ok(
  "the same instruction does not reset a settled checklist",
  shouldResetAriaChecklist({ previousText: "draft outreach", text: "draft outreach", running: false }) === false,
);

console.log(`RESULT aria-command-console-state: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
