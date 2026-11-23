import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const CONCURRENCY_GROUP = "group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}";
const CANCEL_IN_PROGRESS =
  "cancel-in-progress: ${{ github.event_name != 'push' || (github.ref != 'refs/heads/twa-odoo' && github.ref != format('refs/heads/{0}', github.event.repository.default_branch)) }}";
const PUSH_BRANCHES = ["vercel-demo", "main", "twa-odoo"] as const;

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

function jobBlock(ci: string, id: string): string {
  const marker = `\n  ${id}:\n`;
  const start = ci.indexOf(marker);
  assert.ok(start >= 0, `CI job ${id} is present`);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z0-9-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
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
  assert.match(demo, /scrollIntoViewIfNeeded\(\)/);
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

test("each pull request block is present in its job", () => {
  const ci = read(".github/workflows/ci.yml");
  const secret = jobBlock(ci, "secret-scan");
  const database = jobBlock(ci, "database-security");
  const channels = jobBlock(ci, "channel-adapters");
  const release = jobBlock(ci, "release-gate");

  // #168 keeps a HEAD scan. #167 keeps the --all scan and the ignore audit.
  assert.match(secret, /name: Scan the checked-out history/);
  assert.match(secret, /--log-opts='HEAD'/);
  assert.match(secret, /name: Scan the history of this checkout/);
  assert.match(secret, /--log-opts='--all'/);
  assert.match(secret, /git rev-list --all/);
  assert.match(secret, /git cat-file -e "\$\{sha\}\^\{commit\}"/);
  assert.match(secret, /gitleaks ignore commit is not reachable with --all/);

  // #167. The npm script is absent on twa-odoo, so the steps skip.
  assert.match(database, /name: Setup Node 22/);
  assert.match(database, /name: Install dependencies/);
  assert.match(database, /name: Verify approval dispatch hashes on Postgres/);
  assert.match(database, /test:db-approval-dispatch/);
  assert.match(database, /steps\.approval-dispatch\.outputs\.present == 'true'/);
  assert.match(database, /not in package\.json on this branch/);

  // #175. services/channels is absent on twa-odoo, so vet and test skip.
  assert.match(channels, /name: Setup Go/);
  assert.match(channels, /name: Vet channel adapters/);
  assert.match(channels, /name: Test channel adapters with the race detector/);
  assert.equal((channels.match(/services\/channels\/go\.mod/g) ?? []).length, 2);
  assert.match(channels, /go vet \.\/\.\.\./);
  assert.match(channels, /go test -race \.\/\.\.\./);
  assert.match(channels, /is not on this branch yet/);

  // #180 pins the release gate, and every other job, to ubuntu-24.04.
  assert.match(release, /runs-on: ubuntu-24\.04/);
  for (const id of ["quality", "dependency-audit", "secret-scan", "database-security", "local-demo", "channel-adapters", "release-gate"]) {
    assert.match(jobBlock(ci, id), /runs-on: ubuntu-24\.04/, id);
  }
});

test("workflows cancel stale PR runs and push only the release branches", () => {
  const files = readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  assert.ok(files.includes("ci.yml"));
  assert.ok(files.includes("codeql.yml"));
  for (const file of files) {
    const text = read(`.github/workflows/${file}`);
    assert.ok(text.includes(CONCURRENCY_GROUP), file);
    assert.ok(text.includes(CANCEL_IN_PROGRESS), file);
    assert.match(text, /pull_request:\n {4}branches:/, file);
    const push = text.split("\n  push:\n")[1]?.split("\n  pull_request:\n")[0] ?? "";
    assert.ok(push.length > 0, `${file} push`);
    assert.equal(push.includes("**"), false, file);
    for (const branch of PUSH_BRANCHES) assert.match(push, new RegExp(`\\b${branch}\\b`), `${file} ${branch}`);
  }
});

test("handoff records the shared config and the hygiene watch", () => {
  const handoff = read("_relay/HANDOFF.md");
  assert.match(
    handoff,
    /Shared config for the ordered pull request stack lives in \.gitleaksignore, docker-compose\.yml, scripts\/accept-local-demo\.mjs, \.github\/workflows\/ci\.yml, and _relay\/HANDOFF\.md\./,
  );
  assert.match(handoff, /process\.kill\(1, 0\)/);
  assert.match(handoff, /interval 5s, timeout 5s, retries 12, start_period 5s/);
  assert.match(
    handoff,
    /`tests\/public-repo-hygiene\.mts` rejects a private-key block, a non-sample linkedin\.com\/in\/ URL outside `tests\/`, and a non-placeholder address outside `tests\/`/,
  );
  assert.match(handoff, /addresses in relay notes and goal records at this tip are placeholders/);
  assert.equal(read("tests/public-repo-hygiene.mts").includes("PRIVATE KEY"), true);
});
