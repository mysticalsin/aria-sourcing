/* tests/layout-overflow.mts — page shell must not expand document width
 * Run: tsx tests/layout-overflow.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const css = readFileSync(resolve("src/styles/globals.css"), "utf8");
const shell = readFileSync(resolve("src/components/app/app-shell.tsx"), "utf8");

ok("globals clip html overflow-x", /html\s*\{[\s\S]*?overflow-x:\s*clip/.test(css));
ok("globals clip body overflow-x", /body\s*\{[\s\S]*?overflow-x:\s*clip/.test(css));
ok("skip-link does not use left:-9999px", !/\.skip-link\s*\{[^}]*left:\s*-9999px/.test(css));
ok("skip-link uses clip technique", /\.skip-link\s*\{[\s\S]*?clip:\s*rect\(0,\s*0,\s*0,\s*0\)/.test(css));
ok("app shell has overflow-x-clip", /overflow-x-clip/.test(shell));
ok("app shell has min-w-0 on main column", /min-w-0/.test(shell));
ok("app shell caps max-w-[100vw]", /max-w-\[100vw\]/.test(shell));

console.log(`RESULT layout-overflow: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
