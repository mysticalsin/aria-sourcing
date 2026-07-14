import { readFileSync, existsSync } from "fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const readme = source("README.md");
const envLocal = source(".env.local.example");
const allDocs = [
  "README.md",
  "DEPLOYMENT.md",
  "SUPABASE_SETUP.md",
  "production-readiness/DEPLOYMENT_RUNBOOK.md",
  "production-readiness/DEPLOY_CHECKLIST.md",
  "production-readiness/LOCAL_SETUP.md",
  "production-readiness/STATUS.md",
].map((path) => `${path}\n${source(path)}`).join("\n\n");

ok("README does not claim Next.js 14", !readme.includes("Next.js 14"));
ok("README does not claim React 18", !readme.includes("React 18"));
ok(".env.local.example contains TAVILY_API_KEY", envLocal.includes("TAVILY_API_KEY"));
ok(".env.local.example contains DATA_ENCRYPTION_KEY", envLocal.includes("DATA_ENCRYPTION_KEY"));
ok("docs do not say migrations stop at 0001-0005", !/apply migrations 0001[-–]0005/i.test(allDocs));
ok("docs do not say migrations stop at 0001-0012", !/apply migrations 0001[-–]0012/i.test(allDocs));
ok("docs do not say through 0005 as the full set", !/through 0005/i.test(allDocs));
ok("docs do not say through 0012 as the full set", !/through 0012/i.test(allDocs));
ok("STATUS.md exists", existsSync(new URL("../production-readiness/STATUS.md", import.meta.url)));
const status = source("production-readiness/STATUS.md");
const statusDate = status.match(/\*\*Date:\*\*\s+(\d{4}-\d{2}-\d{2})/)?.[1];
const statusDateMs = statusDate ? Date.parse(`${statusDate}T00:00:00Z`) : Number.NaN;
const ageDays = (Date.now() - statusDateMs) / (24 * 60 * 60 * 1000);
ok(
  "STATUS.md contains a recent, non-future ISO date",
  Number.isFinite(statusDateMs) && ageDays >= -1 && ageDays <= 31,
);

const packageJson = JSON.parse(source("package.json")) as {
  scripts?: Record<string, string>;
};
const countCommands = (script: string | undefined) => script?.split(/\s+&&\s+/).length ?? 0;
const canonicalTestCommands =
  countCommands(packageJson.scripts?.pretest) + countCommands(packageJson.scripts?.test);
ok(
  "STATUS.md reports the package-derived canonical test command count",
  canonicalTestCommands > 0 && status.includes(`${canonicalTestCommands} chained checks`),
);

console.log(`RESULT docs-truth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
