import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const logDir = process.argv[2];
const reportPath = `${logDir}/playwright-report.json`;
const raw = JSON.parse(readFileSync(reportPath, "utf8"));
const tests = [];

function walk(suite) {
  for (const child of suite.suites ?? []) walk(child);
  for (const spec of suite.specs ?? []) {
    for (const item of spec.tests ?? []) {
      const result = item.results?.[item.results.length - 1];
      tests.push({
        name: spec.title,
        status: result?.status ?? item.status ?? "unknown",
        durationMs: result?.duration ?? 0,
      });
    }
  }
}
for (const suite of raw.suites ?? []) walk(suite);

const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const summary = {
  total: tests.length,
  passed: tests.filter((item) => item.status === "passed" || item.status === "expected").length,
  failed: tests.filter((item) => item.status === "failed" || item.status === "unexpected" || item.status === "timedOut").length,
  skipped: tests.filter((item) => item.status === "skipped").length,
  durationMs: raw.stats?.duration ?? tests.reduce((sum, item) => sum + item.durationMs, 0),
  head,
  tests,
};
writeFileSync(`${logDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.total} total\n`);
for (const item of tests) process.stdout.write(`${item.status}\t${item.durationMs}ms\t${item.name}\n`);
