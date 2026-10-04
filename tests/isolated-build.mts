import { existsSync, readFileSync } from "fs";

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
const scriptUrl = new URL("../scripts/build-isolated.mjs", import.meta.url);
const script = existsSync(scriptUrl) ? readFileSync(scriptUrl, "utf8") : "";

ok("absolute NEXT_DIST_DIR values fail with the isolated-build instruction", config.includes("path.isAbsolute") && config.includes("build:isolated"));
ok("isolated build script exists", existsSync(scriptUrl));
ok("isolated build copies application source", script.includes('"src"') && script.includes('"public"'));
ok("isolated build installs from the lockfile", script.includes('"ci"'));
ok(
  "isolated install prefers verified cache entries and bounds registry failure time",
  script.includes('"--prefer-offline"') &&
    script.includes('"--fetch-retries=2"') &&
    script.includes('"--fetch-timeout=30000"'),
);
ok("isolated build clears inherited output overrides", script.includes("delete buildEnv.NEXT_DIST_DIR"));
ok("local setup documents the isolated build command", guide.includes("npm run build:isolated"));

console.log(`RESULT isolated-build: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
