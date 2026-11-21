/**
 * L-06: the Rust workspace lockfile is committed and CI resolves with it.
 * No network.
 */
import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("the Rust workspace lockfile is committed", existsSync("core/Cargo.lock"));

const workflow = readFileSync(".github/workflows/core-rust.yml", "utf8");
const cargo = workflow.split("\n").filter((line) => /\bcargo (test|bench|build|run|metadata)\b/.test(line));
ok("CI runs at least one cargo command", cargo.length > 0);
ok(
  "every cargo command resolves with the lockfile",
  cargo.length > 0 && cargo.every((line) => line.includes("--locked")),
);
if (cargo.some((line) => !line.includes("--locked"))) {
  console.log("unlocked:", cargo.filter((line) => !line.includes("--locked")).length);
}

console.log(`RESULT core-lockfile: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
