import { existsSync, readFileSync } from "node:fs";
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
ok("release tip tracks no machine-local Graphify state", !tracked.some((path) => path.startsWith("graphify-out/")));

const gitignore = readFileSync(".gitignore", "utf8");
ok("machine-local tool directory is ignored", /^\/\.localbin\/$/m.test(gitignore));
ok("raw agent execution directory is ignored", /^\/\.rocket-fuel\/$/m.test(gitignore));
ok("generated Graphify output is ignored", /^\/graphify-out\/$/m.test(gitignore));

const setupSources = [
  "DEPLOY_VERCEL_DEMO.md",
  "production-readiness/LOCAL_SETUP.md",
  "scripts/local-supabase-up.sh",
].map((path) => readFileSync(path, "utf8")).join("\n");

ok("setup uses a PATH Supabase CLI instead of a committed binary", !setupSources.includes("./.localbin/supabase"));
ok("setup no longer claims the Supabase CLI is vendored", !/Supabase CLI is already vendored/i.test(setupSources));

const replayModelPath = "src/components/sessions/replay-model.ts";
const auditPackSource = readFileSync("src/components/sessions/audit-pack.tsx", "utf8");
const decisionReplaySource = readFileSync("src/components/sessions/decision-replay.tsx", "utf8");
ok("session replay types have a neutral module owner", existsSync(replayModelPath));
ok(
  "audit pack does not import the component that renders it",
  !auditPackSource.includes("@/components/sessions/decision-replay") &&
    auditPackSource.includes("@/components/sessions/replay-model"),
);
ok(
  "decision replay consumes the neutral replay model",
  decisionReplaySource.includes("@/components/sessions/replay-model") &&
    !/export type ReplayStepKind\s*=/.test(decisionReplaySource) &&
    !/export interface ReplayStep\s*\{/.test(decisionReplaySource),
);

console.log(`RESULT repository-hygiene: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
