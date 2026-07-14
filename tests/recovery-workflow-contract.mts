import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/deploy-aria-mantu.yml", "utf8");
const deploy = readFileSync("deploy-fly.sh", "utf8");
const runbook = readFileSync("production-readiness/DEPLOYMENT_RUNBOOK.md", "utf8");
const receiptExample = readFileSync("production-readiness/volume-recovery-receipt.example.json", "utf8");

const recoveryStep = workflow.slice(
  workflow.indexOf("- name: Validate preserved production recovery point"),
  workflow.indexOf("- name: Install pinned Cosign verifier"),
);
const deployStep = workflow.slice(
  workflow.indexOf("- name: Deploy exact checked release"),
  workflow.indexOf("- name: Record release evidence inventory"),
);
const refreshStep = workflow.slice(
  workflow.indexOf("- name: Refresh recovery state immediately before production mutation"),
  workflow.indexOf("- name: Deploy exact checked release"),
);
const archiveStep = workflow.slice(
  workflow.indexOf("- name: Archive non-secret release candidate and supply-chain evidence"),
);

assert.ok(recoveryStep.length > 0, "workflow must have a recovery-point gate");
assert.ok(
  workflow.indexOf("- name: Validate preserved production recovery point") <
    workflow.indexOf("- name: Build exact release custom images"),
  "recovery point must be validated before artifact publication or production mutation",
);
assert.match(recoveryStep, /FLY_API_TOKEN:\s*\$\{\{ secrets\.FLY_RECOVERY_AUDIT_TOKEN \}\}/);
assert.doesNotMatch(recoveryStep, /secrets\.FLY_API_TOKEN/);
assert.match(recoveryStep, /ARIA_VOLUME_RECOVERY_RECEIPT_JSON:\s*\$\{\{ secrets\.ARIA_VOLUME_RECOVERY_RECEIPT_JSON \}\}/);
assert.match(recoveryStep, /ARIA_VOLUME_RESTORE_CREATE_REQUEST_JSON:\s*\$\{\{ secrets\.ARIA_VOLUME_RESTORE_CREATE_REQUEST_JSON \}\}/);
assert.match(recoveryStep, /ARIA_VOLUME_RESTORE_CREATE_RESPONSE_JSON:\s*\$\{\{ secrets\.ARIA_VOLUME_RESTORE_CREATE_RESPONSE_JSON \}\}/);
assert.match(workflow, /recovery_receipt_sha256:[\s\S]*required:\s*true/);
assert.match(recoveryStep, /actual_receipt_sha256[\s\S]*ARIA_RECOVERY_RECEIPT_SHA256/);
assert.match(recoveryStep, /actions\/runs\/\$GITHUB_RUN_ID\/approvals/);
assert.match(recoveryStep, /environment\?\.name === "Production"/);
assert.match(recoveryStep, /approvedBy === actor/);
assert.match(recoveryStep, /const triggeringActor = String\(process\.env\.GITHUB_TRIGGERING_ACTOR/);
assert.match(recoveryStep, /approvedBy === triggeringActor/);
assert.match(recoveryStep, /!triggeringActor/);
assert.match(recoveryStep, /initialActor:\s*actor/);
assert.match(recoveryStep, /triggeringActor/);
assert.match(recoveryStep, /recovery-receipt-sha256:\$\{process\.env\.actual_receipt_sha256\}/);
assert.match(recoveryStep, /flyctl volumes list --app aria-mantu-db --json/);
assert.match(recoveryStep, /flyctl volumes snapshots list "\$volume_id" --app aria-mantu-db --json/);
assert.match(recoveryStep, /flyctl machines list --app aria-mantu-db --json/);
assert.match(recoveryStep, /flyctl machines list --app "\$restore_app" --json/);
assert.match(recoveryStep, /flyctl ips list --app aria-mantu-db --json/);
assert.match(recoveryStep, /flyctl ips list --app "\$restore_app" --json/);
assert.match(recoveryStep, /validate-volume-recovery-receipt\.mjs/);
assert.match(recoveryStep, /aria-volume-restore-create-request\.json/);
assert.match(recoveryStep, /aria-volume-restore-create-response\.json/);
assert.ok(
  recoveryStep.indexOf("validate-volume-recovery-receipt.mjs") <
    recoveryStep.indexOf('gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/approvals"') &&
    recoveryStep.indexOf("aria-volume-recovery-cleanup-target.json") <
      recoveryStep.indexOf('gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/approvals"'),
  "validated cleanup target must be persisted before reviewer API lookup",
);
assert.match(refreshStep, /FLY_RECOVERY_AUDIT_TOKEN/);
assert.match(refreshStep, /flyctl volumes snapshots list/);
assert.match(refreshStep, /flyctl machines list --app aria-mantu-db --json/);
assert.match(refreshStep, /flyctl machines list --app "\$restore_app" --json/);
assert.match(refreshStep, /validate-volume-recovery-receipt\.mjs/);
assert.ok(
  workflow.indexOf("- name: Refresh recovery state immediately before production mutation") <
    workflow.indexOf("- name: Deploy exact checked release"),
  "live recovery state must be refreshed immediately before deployment",
);

for (const name of [
  "ARIA_VOLUME_RECOVERY_RECEIPT_PATH",
  "ARIA_VOLUME_RECOVERY_VOLUMES_PATH",
  "ARIA_VOLUME_RECOVERY_SNAPSHOTS_PATH",
  "ARIA_VOLUME_RECOVERY_RESTORE_VOLUMES_PATH",
  "ARIA_VOLUME_RESTORE_CREATE_REQUEST_PATH",
  "ARIA_VOLUME_RESTORE_CREATE_RESPONSE_PATH",
  "ARIA_VOLUME_RECOVERY_SOURCE_MACHINES_PATH",
  "ARIA_VOLUME_RECOVERY_RESTORE_MACHINES_PATH",
  "ARIA_VOLUME_RECOVERY_SOURCE_IPS_PATH",
  "ARIA_VOLUME_RECOVERY_RESTORE_IPS_PATH",
]) {
  assert.match(deployStep, new RegExp(`${name}:`), `deploy step must receive ${name}`);
  assert.match(deploy, new RegExp(name), `deploy script must fail closed on ${name}`);
}

for (const rawArtifact of [
  "aria-volume-recovery-receipt.json",
  "aria-volume-recovery-volumes.json",
  "aria-volume-recovery-snapshots.json",
  "aria-volume-recovery-restore-volumes.json",
  "aria-volume-restore-create-request.json",
  "aria-volume-restore-create-response.json",
  "aria-volume-recovery-source-machines.json",
  "aria-volume-recovery-restore-machines.json",
  "aria-volume-recovery-cleanup-target.json",
  "aria-volume-recovery-source-ips.json",
  "aria-volume-recovery-restore-ips.json",
]) {
  assert.doesNotMatch(
    archiveStep,
    new RegExp(rawArtifact.replaceAll(".", "\\.")),
    `${rawArtifact} must never be published as an artifact`,
  );
}

assert.match(archiveStep, /aria-volume-recovery-evidence\.json/);
assert.match(archiveStep, /aria-volume-recovery-cleanup\.json/);
assert.match(deployStep, /FLY_RECOVERY_CLEANUP_TOKEN/);
assert.match(deployStep, /aria-volume-recovery-cleanup-target\.json/);
assert.doesNotMatch(deployStep, /\[ ! -s "\$receipt" \] \|\| \[ ! -s "\$validation" \]/);
assert.match(deployStep, /flyctl machine destroy "\$restore_machine" --app "\$restore_app" --force/);
assert.match(deployStep, /flyctl volumes destroy "\$restore_volume" --app "\$restore_app" --yes/);
assert.match(deployStep, /flyctl apps destroy "\$restore_app" --yes/);
assert.match(deployStep, /retry_cleanup/);
assert.match(deployStep, /flyctl apps list --json/);
assert.match(deployStep, /disposable recovery target still exists after cleanup/);
assert.match(deployStep, /ARIA_FIRST_DEPLOY_APPROVAL:\s*\$\{\{ secrets\.ARIA_FIRST_DEPLOY_APPROVAL \}\}/);

assert.ok(
  deploy.indexOf("validate-volume-recovery-receipt.mjs") < deploy.indexOf("required_secrets=("),
  "deploy script must revalidate recovery evidence before loading deployment secrets",
);

assert.match(deploy, /\.vm\.\$\{RECOVERY_RESTORE_APP\}\.internal/);
assert.match(deploy, /\.vm\.aria-mantu-db\.internal/);
assert.match(deploy, /aria-first-deploy-v1:\$ARIA_RELEASE_SHA:\$RECOVERY_RECEIPT_SHA256/);
assert.match(deploy, /prior image inventory is incomplete/);
assert.match(receiptExample, /"schemaVersion": 2/);
assert.match(receiptExample, /providerRequestSha256/);
assert.match(receiptExample, /providerResponseSha256/);
assert.match(receiptExample, /machineId/);
assert.match(receiptExample, /targetMachineId/);
assert.match(runbook, /ARIA_VOLUME_RESTORE_CREATE_REQUEST_JSON/);
assert.match(runbook, /ARIA_VOLUME_RESTORE_CREATE_RESPONSE_JSON/);
assert.match(runbook, /aria-first-deploy-v1:<release-sha>:<recovery-receipt-sha256>/);
assert.match(runbook, /\.aria-layout-migration-v1/);
assert.match(runbook, /fly deploy --config fly\.db\.toml --image <previous-database-image-digest>/);

console.log("recovery-workflow-contract: passed");
