import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const FINGERPRINT = /^[0-9a-f]{40}:[^:*\s]+:[^:*\s]+:[0-9]+$/;

const REQUIRED_FINGERPRINTS = [
  "da301b172b1796738f402b779297dfa9fadced88:src/lib/store/sourcing-actions.ts:linkedin-client-secret:333",
  "0f2b86e1238067f7525245a7f492d90ee25737b9:scripts/jwt-secret-policy.mjs:generic-api-key:4",
  "fc1d82a8e16b0ec2e0dc3cc8b5c9db749f1bd32e:services/channels/harness_test.go:generic-api-key:22",
  "db67293906e5f29e9d8a5401ea386484a827ee87:services/channels/harness_test.go:generic-api-key:20",
  "63dcc26f52c6a0b1775d992bd9f57a9a6e3bfd67:services/internal/odoo/json2_test.go:generic-api-key:325",
  "63dcc26f52c6a0b1775d992bd9f57a9a6e3bfd67:services/internal/odoo/idempotency_test.go:generic-api-key:45",
  "63dcc26f52c6a0b1775d992bd9f57a9a6e3bfd67:services/internal/odoo/idempotency_test.go:generic-api-key:95",
];

function serviceBlock(compose: string, name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = compose.indexOf(marker);
  assert.ok(start >= 0, `compose service ${name} is present`);
  const rest = compose.slice(start + 1);
  const next = rest.search(/\n  [a-z0-9-]+:\n|\nvolumes:\n/);
  assert.ok(next > 0, `compose service ${name} has an end`);
  return rest.slice(0, next);
}

test("gitleaks ignores are fingerprint lines only", () => {
  const text = read(".gitleaksignore");
  assert.ok(text.endsWith("\n"), ".gitleaksignore ends with a newline");
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  for (const entry of entries) {
    assert.match(entry, FINGERPRINT, entry);
    assert.equal(entry.includes("*"), false, entry);
  }
  for (const required of REQUIRED_FINGERPRINTS) {
    assert.ok(entries.includes(required), required);
  }
});

test("agents healthcheck probes pid 1", () => {
  const compose = read("docker-compose.yml");
  const agents = serviceBlock(compose, "agents");
  assert.match(agents, /command: \["node", "scripts\/agents-runner\.mjs"\]/);
  assert.match(agents, /test: \["CMD", "node", "-e", "process\.kill\(1,0\)"\]/);
  assert.match(agents, /interval: 5s\n/);
  assert.match(agents, /timeout: 5s\n/);
  assert.match(agents, /retries: 12\n/);
  assert.match(agents, /start_period: 5s\n/);
  assert.doesNotMatch(agents, /disable: true/);
  assert.doesNotMatch(agents, /process\.exit\(0\)/);
});

test("local demo fills the manual intake fields by id", () => {
  const demo = read("scripts/accept-local-demo.mjs");
  assert.match(demo, /const manualTab = dialog\.getByRole\("tab", \{ name: "Manual", exact: true \}\);/);
  assert.match(demo, /aria-selected/);
  assert.match(demo, /Manual intake tab did not become selected/);
  assert.match(demo, /dialog\.locator\("\[id\$='-manual-name'\]"\)/);
  assert.match(demo, /dialog\.locator\("\[id\$='-manual-lawful-basis'\]"\)/);
  assert.equal(
    demo.includes('await dialog.getByLabel("Name", { exact: true }).fill(marker + " Person")'),
    false,
  );
});

test("CI jobs cover the stack and pin ubuntu-24.04", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.equal(ci.includes("runs-on: ubuntu-latest"), false);
  for (const job of [
    "quality:",
    "dependency-audit:",
    "secret-scan:",
    "database-security:",
    "local-demo:",
    "channel-adapters:",
    "release-gate:",
  ]) {
    assert.ok(ci.includes(`  ${job}\n`), job);
  }
  assert.equal((ci.match(/runs-on: ubuntu-24\.04/g) ?? []).length, 7);
  assert.match(ci, /gitleaks git \. --redact=100 --no-banner --config \.gitleaks\.toml --log-opts='--all'/);
  assert.match(ci, /git cat-file -e "\$\{sha\}\^\{commit\}"/);
  assert.match(ci, /gitleaks ignore commit is not reachable with --all/);
  assert.match(ci, /test:db-approval-dispatch/);
  assert.match(ci, /services\/channels\/go\.mod/);
  assert.match(ci, /go vet \.\/\.\.\./);
  assert.match(ci, /go test -race \.\/\.\.\./);
  assert.match(ci, /needs: \[quality, dependency-audit, secret-scan, database-security, local-demo, channel-adapters\]/);
  assert.match(ci, /CHANNEL_ADAPTERS_RESULT/);
});

test("handoff records the shared config and the public-repo hygiene watch", () => {
  const handoff = read("_relay/HANDOFF.md");
  assert.match(
    handoff,
    /Shared config for the ordered pull request stack lives in \.gitleaksignore, docker-compose\.yml, scripts\/accept-local-demo\.mjs, \.github\/workflows\/ci\.yml, and _relay\/HANDOFF\.md\./,
  );
  assert.match(handoff, /process\.kill\(1, 0\)/);
  assert.match(handoff, /interval 5s, timeout 5s, retries 12, start_period 5s/);
  assert.match(handoff, /tests\/public-repo-hygiene\.mts/);
  assert.match(handoff, /non-placeholder address outside `tests\/`/);
});
