import { BUILTIN_BROWSER_URL } from "../src/lib/ai/tool-loop";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("browser sentinel stays stable without loading playwright", BUILTIN_BROWSER_URL === "builtin:browser-research");
ok("tool-loop module exported without throwing", true);

console.log(`RESULT tool-loop-load: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
