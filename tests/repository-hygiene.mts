import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", name);
  }
}

const trackedResult = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (trackedResult.status !== 0) throw new Error("git ls-files failed");
const tracked = trackedResult.stdout.split("\0").filter(Boolean);

ok("release tip tracks no machine-local Supabase binaries", !tracked.some((path) => path.startsWith(".localbin/")));
ok("release tip tracks no raw agent execution logs", !tracked.some((path) => path.startsWith(".rocket-fuel/")));

const gitignore = readFileSync(".gitignore", "utf8");
ok("machine-local tool directory is ignored", /^\/\.localbin\/$/m.test(gitignore));
ok("raw agent execution directory is ignored", /^\/\.rocket-fuel\/$/m.test(gitignore));

const setupSources = [
  "DEPLOY_VERCEL_DEMO.md",
  "production-readiness/LOCAL_SETUP.md",
  "scripts/local-supabase-up.sh",
].map((path) => readFileSync(path, "utf8")).join("\n");

ok("setup uses a PATH Supabase CLI instead of a committed binary", !setupSources.includes("./.localbin/supabase"));
ok("setup no longer claims the Supabase CLI is vendored", !/Supabase CLI is already vendored/i.test(setupSources));

console.log(`RESULT repository-hygiene: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
