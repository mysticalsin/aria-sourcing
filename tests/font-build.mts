import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

ok("root layout does not trigger a build-time Google font fetch", !layout.includes("next/font/google"));
ok("root layout does not instantiate Google font loaders", !layout.includes("Geist(") && !layout.includes("EB_Garamond("));
ok("system typography supplies the sans display variable", styles.includes("--font-geist:"));
ok("the retired serif display face stays removed", !styles.includes("--font-garamond") && !styles.includes(".font-garamond"));

console.log(`RESULT font-build: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
