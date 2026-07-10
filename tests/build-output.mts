import { readFileSync } from "fs";
import { resolveNextDistDir } from "../next.config.mjs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = source("next.config.mjs");
const guide = source("NEEDS_GUIDE.md");
const externalDir = "/tmp/aria-next";
let externalError = "";
try {
  resolveNextDistDir(externalDir);
} catch (error) {
  externalError = error instanceof Error ? error.message : String(error);
}

ok("build config validates output directories", config.includes("resolveNextDistDir"));
ok("absolute output points operators to isolated builds", externalError.includes("npm run build:isolated"));
ok("relative output is preserved", resolveNextDistDir(".next-custom") === ".next-custom");
ok("unset output defaults to .next", resolveNextDistDir(undefined) === ".next");
ok("local setup documents the isolated build command", guide.includes("npm run build:isolated"));

console.log(`RESULT build-output: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
