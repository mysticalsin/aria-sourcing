import { interviewerHandoffEnabled } from "../src/lib/interviewer-flag.ts";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

check("missing flag is off", interviewerHandoffEnabled(undefined) === false);
check("empty flag is off", interviewerHandoffEnabled("") === false);
check("false is off", interviewerHandoffEnabled("false") === false);
check("yes is off", interviewerHandoffEnabled("yes") === false);
check("true is on", interviewerHandoffEnabled("true") === true);
check("TRUE is on", interviewerHandoffEnabled("TRUE") === true);
check("True is on", interviewerHandoffEnabled("True") === true);
check("1 is on", interviewerHandoffEnabled("1") === true);

console.log(`RESULT interviewer-flag: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
