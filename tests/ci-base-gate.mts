import { readFileSync } from "fs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const compose = source("docker-compose.yml");
const ignore = source(".gitleaksignore");
const gitleaks = source(".gitleaks.toml");
const workflow = source(".github/workflows/ci.yml");
const demo = source("scripts/accept-local-demo.mjs");

function agentsBlock(text: string): string {
  const start = text.indexOf("\n  agents:\n");
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.indexOf("\nvolumes:\n");
  return next < 0 ? rest : rest.slice(0, next);
}

function reasonPrecedes(text: string, fingerprint: string, reason: string): boolean {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === fingerprint);
  if (at < 0) return false;
  return lines.slice(Math.max(0, at - 6), at).some((line) => line.includes(reason));
}

/* Local Docker demo: compose --wait rejects a long-running service with no
   healthcheck. The image probe hits the web server, which the runner does
   not serve. The shared probe signals pid 1 with process.kill(1,0). A cmdline
   check for agents-runner.mjs is the other accepted form. */
const agents = agentsBlock(compose);
const health = agents.includes("\n    healthcheck:\n") ? agents.slice(agents.indexOf("\n    healthcheck:\n")) : "";
ok("the agents service declares a healthcheck", health.length > 0);
ok("the agents healthcheck is enabled", !/^\s*disable:\s*true\s*$/m.test(health));
ok(
  "the agents healthcheck confirms the runner is PID 1",
  health.includes("process.kill(1,0)") ||
    (health.includes("/proc/1/cmdline") && health.includes("agents-runner.mjs")),
);
/* The add-candidate dialog keeps a Name field on the LinkedIn tab. That
   panel stays mounted and hidden, so getByLabel("Name") fills the hidden
   input and times out. The acceptance script has to target the manual ids. */
ok(
  "the local demo fills the manual candidate fields",
  demo.includes("[id$='-manual-name']") && demo.includes("[id$='-manual-lawful-basis']"),
);
ok(
  "the local demo does not fill the dialog Name label",
  !demo.includes('getByLabel("Name"') && !demo.includes('getByLabel("Lawful basis"'),
);

/* Secret scan: full-history gitleaks findings that are false positives.
   Each entry is one commit:path:rule:line fingerprint plus a reason on a
   nearby comment. Paths and rules stay enabled. */
const falsePositives: ReadonlyArray<{ fingerprint: string; reason: string }> = [
  {
    fingerprint: "da301b172b1796738f402b779297dfa9fadced88:src/lib/store/sourcing-actions.ts:linkedin-client-secret:333",
    reason: "16-letter source identifier",
  },
  {
    fingerprint: "0f2b86e1238067f7525245a7f492d90ee25737b9:scripts/jwt-secret-policy.mjs:generic-api-key:4",
    reason: "SHA-256 digest of a retired sample",
  },
  {
    fingerprint: "fc1d82a8e16b0ec2e0dc3cc8b5c9db749f1bd32e:services/channels/harness_test.go:generic-api-key:22",
    reason: "expected HMAC of a synthetic test vector",
  },
  {
    fingerprint: "db67293906e5f29e9d8a5401ea386484a827ee87:services/channels/harness_test.go:generic-api-key:20",
    reason: "expected HMAC of a synthetic test vector",
  },
  {
    fingerprint: "63dcc26f52c6a0b1775d992bd9f57a9a6e3bfd67:services/internal/odoo/json2_test.go:generic-api-key:325",
    reason: "synthetic idempotency slug",
  },
  {
    fingerprint: "63dcc26f52c6a0b1775d992bd9f57a9a6e3bfd67:services/internal/odoo/idempotency_test.go:generic-api-key:45",
    reason: "synthetic idempotency slug",
  },
  {
    fingerprint: "63dcc26f52c6a0b1775d992bd9f57a9a6e3bfd67:services/internal/odoo/idempotency_test.go:generic-api-key:95",
    reason: "synthetic idempotency slug",
  },
];
for (const entry of falsePositives) {
  ok(`CI hygiene fingerprint has its reason: ${entry.fingerprint}`, reasonPrecedes(ignore, entry.fingerprint, entry.reason));
}
ok("gitleaks keeps the default rules", /useDefault\s*=\s*true/.test(gitleaks));
ok("gitleaks [[allowlists]] entries are not a path allowlist", /\[\[allowlists\]\]/.test(gitleaks) && !/^\s*paths\s*=/m.test(gitleaks) && !/useDefault\s*=\s*false/.test(gitleaks));

/* Release gate: it has no check of its own. It fails when secret scan or
   the local demo is not success. The shared workflow also needs
   channel-adapters, and the original jobs stay on that list. */
const gate = workflow.slice(workflow.indexOf("\n  release-gate:\n"));
ok(
  "the release gate always runs",
  gate.includes("if: always()") &&
    gate.includes("needs: [quality, dependency-audit, secret-scan, database-security, local-demo, channel-adapters, linkedin-token-e2e, synthetic-hire-e2e]"),
);
ok(
  "the release gate fails unless the synthetic hire playwright job succeeds",
  gate.includes("SYNTHETIC_HIRE_E2E_RESULT") && gate.includes('[ "$SYNTHETIC_HIRE_E2E_RESULT" != success ]'),
);
ok(
  "the release gate fails unless secret scan and the local demo succeed",
  gate.includes('[ "$SECRET_SCAN_RESULT" != success ]') && gate.includes('[ "$LOCAL_DEMO_RESULT" != success ]'),
);

console.log(`RESULT ci-base-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
