import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  NEXT_ADVISORIES,
  formatNextVersionReport,
  unmetAdvisories,
} from "../scripts/check-next-version.mjs";

const floors: ReadonlyArray<readonly [string, string]> = [
  ["GHSA-mfr8-8qww-v76h", "16.4.5"],
  ["GHSA-vc7v-qv4w-wrv8", "16.4.5"],
  ["GHSA-vvgp-ww4w-46vf", "16.4.5"],
  ["GHSA-rhh4-g77r-r9qj", "16.4.5"],
  ["GHSA-pc58-hwjq-p385", "16.4.5"],
  ["GHSA-7qx7-33qx-rqx2", "16.4.5"],
  ["GHSA-f3mh-rxg3-f5g2", "16.4.5"],
];

test("each npm-audit Next.js advisory cites its GHSA id and first patched release", () => {
  assert.deepEqual(
    NEXT_ADVISORIES.map((advisory) => [advisory.id, advisory.patched]),
    floors,
  );
  for (const advisory of NEXT_ADVISORIES) {
    assert.match(advisory.id, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
    assert.ok(advisory.summary.length > 0);
  }
});

test("next 16.4.3 misses every patched floor and 16.4.5 meets them", () => {
  assert.deepEqual(
    unmetAdvisories("16.4.3").map((advisory) => advisory.id),
    floors.map(([id]) => id),
  );
  assert.match(formatNextVersionReport("16.4.3"), /GHSA-mfr8-8qww-v76h requires >= 16\.4\.5/);
  assert.deepEqual(unmetAdvisories("16.4.5"), []);
  assert.deepEqual(unmetAdvisories("16.4.6"), []);
  assert.equal(unmetAdvisories("16.4.5-canary.1").length, floors.length);
  assert.equal(unmetAdvisories("16.4").length, floors.length);
});

test("the installed next package meets every advisory floor", () => {
  const result = spawnSync(process.execPath, ["scripts/check-next-version.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${result.stderr ?? ""}${result.stdout ?? ""}${result.error ? result.error.message : ""}`,
  );
});
