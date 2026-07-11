import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "aria-receipt-digest-"));
const compact = join(root, "compact.json");
const pretty = join(root, "pretty.json");
const document = { z: [1, 2, 3], a: { approved: true } };
writeFileSync(compact, JSON.stringify(document));
writeFileSync(pretty, `${JSON.stringify(document, null, 2)}\n`);

const run = (path: string) =>
  spawnSync(process.execPath, ["scripts/recovery-receipt-digest.mjs", path], { encoding: "utf8" });
const compactResult = run(compact);
const prettyResult = run(pretty);
assert.equal(compactResult.status, 0);
assert.equal(prettyResult.status, 0);
assert.match(compactResult.stdout.trim(), /^[0-9a-f]{64}$/);
assert.equal(compactResult.stdout, prettyResult.stdout, "formatting must not change the dispatch digest");

const invalid = join(root, "invalid.json");
writeFileSync(invalid, "not json");
assert.notEqual(run(invalid).status, 0, "invalid JSON must fail closed");

console.log("recovery-receipt-digest: 5/5 passed");
