const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const artifact = process.env.ARTIFACT_DIR;
const resultsPath = path.join(artifact, 'playwright-results.json');

function walk(node, acc = []) {
  for (const spec of node.specs || []) {
    for (const test of spec.tests || []) {
      const result = (test.results || [])[test.results.length - 1] || {};
      acc.push({
        name: `${spec.title}`,
        status: result.status || test.status || 'unknown',
        duration_ms: result.duration || 0,
      });
    }
  }
  for (const suite of node.suites || []) walk(suite, acc);
  return acc;
}

function runPlaywright(extraArgs) {
  const bin = path.join(__dirname, 'node_modules', '.bin', 'playwright');
  const child = spawnSync(bin, ['test', ...extraArgs], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env,
  });
  return child.status === null ? 1 : child.status;
}

function readTests() {
  if (!fs.existsSync(resultsPath)) return [];
  const report = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  return walk(report);
}

const { classifyRetry } = require('./lib/classify-retry');

function main() {
  const started = Date.now();
  let status = runPlaywright([]);
  let tests = readTests();
const timedOut = tests.filter((test) => test.status === 'timedOut');
const failed = tests.filter((test) => test.status === 'failed' || test.status === 'interrupted');
let infraRetried = false;
if (timedOut.length && failed.length === 0) {
  infraRetried = true;
  const pattern = timedOut.map((test) => test.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  fs.copyFileSync(resultsPath, path.join(artifact, 'playwright-results-attempt-1.json'));
  status = runPlaywright(['--grep', pattern]);
  const retried = readTests();
  const byName = new Map(retried.map((test) => [test.name, test]));
  tests = tests.map((test) => classifyRetry(test, byName.get(test.name)));
}

const counts = { passed: 0, failed: 0, skipped: 0, infra_error: 0, timedOut: 0, total: tests.length };
for (const test of tests) {
  if (test.status === 'passed') counts.passed += 1;
  else if (test.status === 'skipped') counts.skipped += 1;
  else if (test.status === 'infra_error') counts.infra_error += 1;
  else if (test.status === 'timedOut') counts.timedOut += 1;
  else counts.failed += 1;
}

const digests = {
  odoo: 'odoo:19@sha256:03a47921f9eef2c225ded1167fe7828465d2b3177883f30d173bb1c3c792949b',
  postgres: 'postgres:16@sha256:3950ad7c3148ca2175ef1b6c36c9efbf78957ae8fbe8b3a5d7c35af50500382f',
  playwright: '@playwright/test@1.65.1',
};

const summary = {
  head_sha: process.env.HEAD_SHA || '',
  tree_sha: process.env.TREE_SHA || '',
  started_at: new Date(started).toISOString(),
  total_duration_ms: Date.now() - started,
  counts,
  tests,
  image_digests: digests,
  forge: {
    property_tests: tests.some((test) => test.name.includes('verifier property')),
    spec_boundary_tests: tests.some((test) => test.name.startsWith('boundary:')),
    skip_xfail_gate: counts.skipped === 0 ? 'pass' : 'fail',
    timeout_policy: 'playwright retries 0; one rerun only when the failure is a timeout, then infra_error',
    infra_retried: infraRetried,
  },
  known_gaps: [],
};
fs.writeFileSync(path.join(artifact, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('E2E summary');
for (const test of tests) {
  console.log(`${test.status}\t${test.duration_ms}ms\t${test.name}`);
}
console.log(`counts passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} infra_error=${counts.infra_error} timedOut=${counts.timedOut} total=${counts.total}`);

  if (counts.skipped > 0 || counts.failed > 0 || counts.infra_error > 0 || counts.timedOut > 0 || status !== 0) {
    process.exit(status === 0 ? 1 : status);
  }
}

if (require.main === module) {
  main();
}
