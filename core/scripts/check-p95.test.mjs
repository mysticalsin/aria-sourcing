/**
 * The 10% p95 gate must reject a real slowdown. These numbers are injected;
 * they do not time the scorer.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateP95Gate } from "./check-p95.mjs";

const previous = [
  { name: "score_batch_500_p95", unit: "ns", value: 1_000_000 },
  { name: "ffi_score_batch_500_p95", unit: "ns", value: 2_000_000 },
];

test("gate fails when an injected p95 is more than 10% slower", () => {
  const current = [
    { name: "score_batch_500_p95", unit: "ns", value: 1_110_000 },
    { name: "ffi_score_batch_500_p95", unit: "ns", value: 2_000_000 },
  ];
  const failures = evaluateP95Gate(previous, current);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /score_batch_500_p95/);
  assert.match(failures[0], /111\.0%/);
});

test("gate fails when the cgo batch p95 is more than 10% slower", () => {
  const current = [
    { name: "score_batch_500_p95", unit: "ns", value: 1_000_000 },
    { name: "ffi_score_batch_500_p95", unit: "ns", value: 2_220_000 },
  ];
  const failures = evaluateP95Gate(previous, current);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ffi_score_batch_500_p95/);
});

test("gate accepts a sample at exactly 10% slower and a sample that is faster", () => {
  const atLimit = previous.map((row) => ({ ...row, value: Math.round(row.value * 1.1) }));
  const faster = previous.map((row) => ({ ...row, value: row.value - 1 }));
  assert.deepEqual(evaluateP95Gate(previous, atLimit), []);
  assert.deepEqual(evaluateP95Gate(previous, faster), []);
});

test("command exits 1 on an injected slowdown over the threshold", () => {
  const dir = mkdtempSync(join(tmpdir(), "aria-p95-"));
  const history = join(dir, "previous.json");
  const current = join(dir, "current.json");
  writeFileSync(history, `${JSON.stringify(previous)}\n`);
  writeFileSync(
    current,
    `${JSON.stringify(previous.map((row) => ({ ...row, value: row.value + Math.floor(row.value * 0.1) + 1 })))}\n`,
  );
  const ran = spawnSync(process.execPath, ["core/scripts/check-p95.mjs", "--history", history, "--current", current], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 1, ran.stderr);
  assert.match(ran.stderr, /score_batch_500_p95/);
  assert.match(ran.stderr, /ffi_score_batch_500_p95/);
});
