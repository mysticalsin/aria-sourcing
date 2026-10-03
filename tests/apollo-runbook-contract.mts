import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../docs/operations/APOLLO_ENRICHMENT_RECONCILIATION.md", import.meta.url),
  "utf8",
);
const shell = [...source.matchAll(/```bash\n([\s\S]*?)```/g)]
  .map((match) => match[1])
  .join("\n");

execFileSync("bash", ["-n"], { input: shell });
assert.doesNotMatch(source, /--header\s+["']Cookie:/);
assert.doesNotMatch(source, /--arg\s+email\b/);
assert.match(source, /--config "\$ARIA_RUN_DIR\/curl-auth\.conf"/);
assert.match(source, /-perm 0600/);
assert.match(source, /trap cleanup_aria_reconciliation EXIT/);
assert.match(source, /trap 'cleanup_aria_reconciliation; exit 130' HUP INT TERM/);
assert.ok((source.match(/aria_sha256_file "\$EVIDENCE_FILE"/g) ?? []).length >= 2);
assert.doesNotMatch(source, /\/tmp\/aria-apollo-/);

console.log("RESULT apollo-runbook-contract: syntax=safe argv=secret-free cleanup=trapped digest=rechecked");
