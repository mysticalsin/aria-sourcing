#!/usr/bin/env node
// Sandbox-safe test runner: reproduces the `npm test` (+pretest) gate exactly,
// but rewrites `tsx <file>` -> `node --import tsx <file>` because the tsx CLI
// tries to listen() on a unix IPC pipe that this sandbox blocks (EPERM).
// `node --experimental-test-module-mocks --import tsx <file>` commands run verbatim.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const commands = [pkg.scripts.pretest, pkg.scripts.test]
  .join(' && ')
  .split('&&')
  .map((c) => c.trim())
  .filter(Boolean);

let passedCmds = 0;
let failedCmds = 0;
const failures = [];

for (const cmd of commands) {
  const parts = cmd.split(/\s+/);
  let argv;
  if (parts[0] === 'tsx') {
    argv = ['--import', 'tsx', ...parts.slice(1)];
  } else if (parts[0] === 'node') {
    argv = parts.slice(1); // already node --... --import tsx <file>
  } else {
    console.error(`SKIP unknown command shape: ${cmd}`);
    continue;
  }
  const file = argv[argv.length - 1];
  const res = spawnSync('node', argv, { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const ok = res.status === 0;
  if (ok) {
    passedCmds++;
    const m = out.match(/RESULT [^\n]+/);
    console.log(`PASS ${file}  ${m ? '| ' + m[0] : ''}`);
  } else {
    failedCmds++;
    failures.push({ file, status: res.status, tail: out.split('\n').slice(-25).join('\n') });
    console.log(`FAIL ${file}  (exit ${res.status})`);
  }
}

console.log('\n==================== SUMMARY ====================');
console.log(`commands: ${commands.length}  passed: ${passedCmds}  failed: ${failedCmds}`);
if (failures.length) {
  console.log('\n---------------- FAILURE DETAIL ----------------');
  for (const f of failures) {
    console.log(`\n### ${f.file} (exit ${f.status})`);
    console.log(f.tail);
  }
}
process.exit(failedCmds ? 1 : 0);
