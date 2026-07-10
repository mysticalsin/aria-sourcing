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
ok("STATUS.md contains today's date", status.includes("2026-07-10"));
ok("STATUS.md contains 98", status.includes("98"));

console.log(`RESULT docs-truth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
