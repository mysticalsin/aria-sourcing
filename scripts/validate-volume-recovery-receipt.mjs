#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

function fail(message) {
  process.stderr.write(`Recovery receipt rejected: ${message}\n`);
  process.exit(1);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function exactKeys(value, expected, name) {
  const actual = Object.keys(object(value, name)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${name} has missing or unexpected fields`);
  }
}

function requiredString(value, name, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${name} is invalid`);
  return value;
}

function timestamp(value, name) {
  requiredString(value, name, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const parsed = Date.parse(value);
  const normalized = Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  const normalizedWithoutMilliseconds = normalized.endsWith(".000Z") ? normalized.replace(".000Z", "Z") : normalized;
  if (!Number.isFinite(parsed) || (value !== normalized && value !== normalizedWithoutMilliseconds)) {
    fail(`${name} is not a canonical UTC timestamp`);
  }
  return parsed;
}

function providerTimestamp(value, name) {
  if (typeof value !== "string") fail(`${name} is missing`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${name} is invalid`);
  return parsed;
}

function jsonFile(path, name, privateFile = false) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    fail(`${name} is missing`);
  }
  if (!stats.isFile() || stats.size < 2 || stats.size > 65_536) fail(`${name} has an invalid size or type`);
  if (privateFile && (stats.mode & 0o077) !== 0) fail(`${name} must have mode 0400 or 0600`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function oneOf(row, keys) {
  for (const key of keys) {
    if (Object.hasOwn(row, key)) return row[key];
  }
  return undefined;
}

function canonicalJsonSha256(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

const [
  receiptPath,
  volumesPath,
  snapshotsPath,
  restoreVolumesPath,
  sourceIpsPath,
  restoreIpsPath,
  restoreRequestPath,
  restoreResponsePath,
  sourceMachinesPath,
  restoreMachinesPath,
  expectedReleaseSha,
] = process.argv.slice(2);
if (
  !receiptPath ||
  !volumesPath ||
  !snapshotsPath ||
  !restoreVolumesPath ||
  !sourceIpsPath ||
  !restoreIpsPath ||
  !restoreRequestPath ||
  !restoreResponsePath ||
  !sourceMachinesPath ||
  !restoreMachinesPath ||
  !expectedReleaseSha ||
  process.argv.length !== 13
) {
  fail(
    "usage: validate-volume-recovery-receipt.mjs <receipt> <volumes-json> <snapshots-json> <restore-volumes-json> <source-ips-json> <restore-ips-json> <restore-request-json> <restore-response-json> <source-machines-json> <restore-machines-json> <release-sha>",
  );
}
requiredString(expectedReleaseSha, "release SHA", /^[0-9a-f]{40}$/);

const receipt = object(jsonFile(receiptPath, "receipt", true), "receipt");
exactKeys(receipt, ["schemaVersion", "releaseSha", "production", "recoveryPoint", "restoreDrill", "approval"], "receipt");
if (receipt.schemaVersion !== 2) fail("schemaVersion must equal 2");
if (receipt.releaseSha !== expectedReleaseSha) fail("releaseSha does not match the dispatched release");

const production = object(receipt.production, "production");
exactKeys(production, ["app", "volumeName", "volumeId", "machineId", "region"], "production");
if (production.app !== "aria-mantu-db") fail("production.app must be aria-mantu-db");
if (production.volumeName !== "aria_db_data") fail("production.volumeName must be aria_db_data");
requiredString(production.volumeId, "production.volumeId", /^vol_[A-Za-z0-9]+$/);
requiredString(production.machineId, "production.machineId", /^[0-9a-f]{14}$/);
if (production.region !== "cdg") fail("production.region must be cdg");

const recoveryPoint = object(receipt.recoveryPoint, "recoveryPoint");
exactKeys(
  recoveryPoint,
  ["provider", "snapshotId", "snapshotDigest", "createdAt", "writesQuiescedAt"],
  "recoveryPoint",
);
if (recoveryPoint.provider !== "fly-volume-snapshot") fail("unsupported recoveryPoint.provider");
requiredString(recoveryPoint.snapshotId, "recoveryPoint.snapshotId", /^vs_[A-Za-z0-9]+$/);
requiredString(recoveryPoint.snapshotDigest, "recoveryPoint.snapshotDigest", /^[A-Za-z0-9_-]{16,256}(?:-[0-9]+)?$/);
const snapshotCreatedAt = timestamp(recoveryPoint.createdAt, "recoveryPoint.createdAt");
const writesQuiescedAt = timestamp(recoveryPoint.writesQuiescedAt, "recoveryPoint.writesQuiescedAt");

const restoreDrill = object(receipt.restoreDrill, "restoreDrill");
exactKeys(
  restoreDrill,
  [
    "status",
    "targetApp",
    "targetVolumeId",
    "targetMachineId",
    "completedAt",
    "destroyAfter",
    "restoreOperation",
    "postgresMajor",
    "schemaFingerprintSha256",
    "rowFingerprintSha256",
    "migrationManifestSha256",
    "migrationState",
    "recoveryPreflightSha256",
    "legacyBaselineApprovalSha256",
  ],
  "restoreDrill",
);
if (restoreDrill.status !== "passed") fail("restoreDrill.status must be passed");
requiredString(restoreDrill.targetApp, "restoreDrill.targetApp", /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
if (restoreDrill.targetApp !== `aria-mantu-db-recovery-${expectedReleaseSha.slice(0, 12)}`) {
  fail("restore drill app must be the exact release-scoped private recovery app");
}
requiredString(restoreDrill.targetVolumeId, "restoreDrill.targetVolumeId", /^vol_[A-Za-z0-9]+$/);
if (restoreDrill.targetVolumeId === production.volumeId) fail("restore drill must use a different volume");
requiredString(restoreDrill.targetMachineId, "restoreDrill.targetMachineId", /^[0-9a-f]{14}$/);
if (restoreDrill.targetMachineId === production.machineId) fail("restore drill must use a different machine");
const restoreCompletedAt = timestamp(restoreDrill.completedAt, "restoreDrill.completedAt");
const destroyAfter = timestamp(restoreDrill.destroyAfter, "restoreDrill.destroyAfter");
const restoreOperation = object(restoreDrill.restoreOperation, "restoreDrill.restoreOperation");
exactKeys(
  restoreOperation,
  [
    "requestedSnapshotId",
    "requestedApp",
    "requestedVolumeName",
    "requestedRegion",
    "requestedSizeGb",
    "createdVolumeId",
    "providerRequestSha256",
    "providerResponseSha256",
  ],
  "restoreDrill.restoreOperation",
);
if (restoreOperation.requestedSnapshotId !== recoveryPoint.snapshotId) {
  fail("restore request does not bind the selected snapshot");
}
if (restoreOperation.requestedApp !== restoreDrill.targetApp) fail("restore request app does not match receipt");
if (restoreOperation.requestedVolumeName !== "aria_db_data_restore") fail("restore request volume name is invalid");
if (restoreOperation.requestedRegion !== production.region) fail("restore request region does not match production");
if (!Number.isInteger(restoreOperation.requestedSizeGb) || restoreOperation.requestedSizeGb < 1) {
  fail("restore request size is invalid");
}
if (restoreOperation.createdVolumeId !== restoreDrill.targetVolumeId) {
  fail("restore response volume does not match receipt");
}
requiredString(
  restoreOperation.providerRequestSha256,
  "restoreDrill.restoreOperation.providerRequestSha256",
  /^(?!0{64}$)[0-9a-f]{64}$/,
);
requiredString(
  restoreOperation.providerResponseSha256,
  "restoreDrill.restoreOperation.providerResponseSha256",
  /^(?!0{64}$)[0-9a-f]{64}$/,
);

const restoreRequest = object(jsonFile(restoreRequestPath, "captured restore request", true), "captured restore request");
exactKeys(
  restoreRequest,
  ["schemaVersion", "operation", "snapshotId", "app", "volumeName", "region", "sizeGb"],
  "captured restore request",
);
if (restoreRequest.schemaVersion !== 1 || restoreRequest.operation !== "create-volume-from-snapshot") {
  fail("captured restore request has an unsupported contract");
}
if (
  restoreRequest.snapshotId !== restoreOperation.requestedSnapshotId ||
  restoreRequest.app !== restoreOperation.requestedApp ||
  restoreRequest.volumeName !== restoreOperation.requestedVolumeName ||
  restoreRequest.region !== restoreOperation.requestedRegion ||
  restoreRequest.sizeGb !== restoreOperation.requestedSizeGb
) {
  fail("captured restore request does not match the approved operation");
}
if (canonicalJsonSha256(restoreRequest) !== restoreOperation.providerRequestSha256) {
  fail("captured restore request digest does not match the receipt");
}

const restoreResponse = object(
  jsonFile(restoreResponsePath, "captured provider response", true),
  "captured provider response",
);
if (canonicalJsonSha256(restoreResponse) !== restoreOperation.providerResponseSha256) {
  fail("captured provider response digest does not match the receipt");
}
if (
  oneOf(restoreResponse, ["id", "ID"]) !== restoreOperation.createdVolumeId ||
  oneOf(restoreResponse, ["name", "Name"]) !== restoreOperation.requestedVolumeName ||
  oneOf(restoreResponse, ["state", "State"]) !== "created" ||
  oneOf(restoreResponse, ["size_gb", "sizeGb", "SizeGB"]) !== restoreOperation.requestedSizeGb ||
  oneOf(restoreResponse, ["region", "Region"]) !== restoreOperation.requestedRegion ||
  oneOf(restoreResponse, ["encrypted", "Encrypted"]) !== true
) {
  fail("captured provider response does not match the approved restore operation");
}
const responseCreatedAt = providerTimestamp(
  oneOf(restoreResponse, ["created_at", "createdAt", "CreatedAt"]),
  "captured provider response createdAt",
);
if (restoreDrill.postgresMajor !== 17) fail("restoreDrill.postgresMajor must equal 17");
requiredString(restoreDrill.schemaFingerprintSha256, "restoreDrill.schemaFingerprintSha256", /^(?!0{64}$)[0-9a-f]{64}$/);
requiredString(restoreDrill.rowFingerprintSha256, "restoreDrill.rowFingerprintSha256", /^(?!0{64}$)[0-9a-f]{64}$/);
requiredString(
  restoreDrill.migrationManifestSha256,
  "restoreDrill.migrationManifestSha256",
  /^(?!0{64}$)[0-9a-f]{64}$/,
);
if (!["verified-empty", "complete-ledger", "verified-pre-ledger"].includes(restoreDrill.migrationState)) {
  fail("restoreDrill.migrationState is unsupported");
}
requiredString(
  restoreDrill.recoveryPreflightSha256,
  "restoreDrill.recoveryPreflightSha256",
  /^(?!0{64}$)[0-9a-f]{64}$/,
);
if (restoreDrill.migrationState === "verified-pre-ledger") {
  if (restoreDrill.legacyBaselineApprovalSha256 !== restoreDrill.recoveryPreflightSha256) {
    fail("verified pre-ledger recovery requires the exact approved baseline digest");
  }
} else if (restoreDrill.legacyBaselineApprovalSha256 !== null) {
  fail("non-legacy recovery must not authorize legacy baselining");
}

const approval = object(receipt.approval, "approval");
exactKeys(approval, ["approvedAt", "expiresAt", "approvedBy"], "approval");
const approvedAt = timestamp(approval.approvedAt, "approval.approvedAt");
const expiresAt = timestamp(approval.expiresAt, "approval.expiresAt");
requiredString(approval.approvedBy, "approval.approvedBy", /^(?=.{1,39}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/);

const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;
if (writesQuiescedAt > snapshotCreatedAt || snapshotCreatedAt - writesQuiescedAt > 15 * minute) {
  fail("database write quiescence must be confirmed within 15 minutes before snapshot creation");
}
if (snapshotCreatedAt > now + 5 * minute || now - snapshotCreatedAt > 24 * hour) {
  fail("recovery point must be complete and less than 24 hours old");
}
if (restoreCompletedAt < snapshotCreatedAt || restoreCompletedAt > approvedAt) {
  fail("restore drill chronology is invalid");
}
if (
  destroyAfter <= now ||
  destroyAfter <= restoreCompletedAt ||
  destroyAfter - restoreCompletedAt > 24 * hour
) {
  fail("disposable restore target cleanup deadline is invalid");
}
if (
  approvedAt > now + 5 * minute ||
  expiresAt <= now ||
  expiresAt <= approvedAt ||
  expiresAt - approvedAt > 4 * hour
) {
  fail("approval is not current or its validity window exceeds four hours");
}

const volumes = jsonFile(volumesPath, "provider volumes");
if (!Array.isArray(volumes)) fail("provider volumes must be an array");
const matchingVolumes = volumes.filter((candidate) => {
  const row = object(candidate, "provider volume");
  return oneOf(row, ["name", "Name"]) === production.volumeName;
});
if (matchingVolumes.length !== 1 || volumes.length !== 1) fail("production must expose exactly one named volume");
const liveVolume = matchingVolumes[0];
if (oneOf(liveVolume, ["id", "ID"]) !== production.volumeId) fail("provider volume ID does not match receipt");
if (oneOf(liveVolume, ["state", "State"]) !== "created") fail("provider volume is not in the created state");
if (oneOf(liveVolume, ["region", "Region"]) !== production.region) fail("provider volume region does not match receipt");
if (oneOf(liveVolume, ["encrypted", "Encrypted"]) !== true) fail("provider volume must be encrypted");
if (oneOf(liveVolume, ["auto_backup_enabled", "autoBackupEnabled", "AutoBackupEnabled"]) !== true) {
  fail("provider scheduled snapshots must be enabled");
}
const sourceSnapshotRetention = oneOf(liveVolume, ["snapshot_retention", "snapshotRetention", "SnapshotRetention"]);
if (!Number.isInteger(sourceSnapshotRetention) || sourceSnapshotRetention < 14) {
  fail("provider snapshot retention must be at least 14 days");
}
const sourceSizeGb = oneOf(liveVolume, ["size_gb", "sizeGb", "SizeGB"]);
if (!Number.isInteger(sourceSizeGb) || sourceSizeGb < 1) fail("provider source volume size is invalid");
providerTimestamp(oneOf(liveVolume, ["created_at", "createdAt", "CreatedAt"]), "provider volume createdAt");
const attachedMachine = oneOf(liveVolume, ["attached_machine_id", "attachedMachineId", "AttachedMachineID"]);
if (typeof attachedMachine !== "string" || attachedMachine.length === 0) fail("provider volume is not attached");
if (attachedMachine !== production.machineId) fail("production volume attachment does not match the receipt machine");

const sourceMachines = jsonFile(sourceMachinesPath, "provider source machines");
if (!Array.isArray(sourceMachines) || sourceMachines.length !== 1) {
  fail("production database app must expose exactly one machine");
}
const liveSourceMachine = object(sourceMachines[0], "provider source machine");
if (oneOf(liveSourceMachine, ["id", "ID"]) !== production.machineId) {
  fail("production machine ID does not match the receipt");
}
if (oneOf(liveSourceMachine, ["region", "Region"]) !== production.region) {
  fail("production machine region does not match the receipt");
}
if (!["started", "stopped"].includes(oneOf(liveSourceMachine, ["state", "State"]))) {
  fail("production machine must be in a stable started or stopped state");
}

const snapshots = jsonFile(snapshotsPath, "provider snapshots");
if (!Array.isArray(snapshots)) fail("provider snapshots must be an array");
const matchingSnapshots = snapshots.filter((candidate) => {
  const row = object(candidate, "provider snapshot");
  return oneOf(row, ["id", "ID"]) === recoveryPoint.snapshotId;
});
if (matchingSnapshots.length !== 1) fail("provider snapshot ID is absent or ambiguous");
const liveSnapshot = matchingSnapshots[0];
const snapshotStatus = oneOf(liveSnapshot, ["status", "state", "Status", "State"]);
if (snapshotStatus !== undefined && snapshotStatus !== "created") fail("provider snapshot is not complete");
const snapshotSize = oneOf(liveSnapshot, ["size", "Size"]);
const snapshotDigest = oneOf(liveSnapshot, ["digest", "Digest"]);
if (!Number.isInteger(snapshotSize) || snapshotSize <= 0) fail("provider snapshot has no stored data");
if (snapshotDigest !== recoveryPoint.snapshotDigest) fail("provider snapshot digest does not match receipt");
const snapshotRetentionDays = oneOf(liveSnapshot, ["retention_days", "retentionDays", "RetentionDays"]);
if (!Number.isInteger(snapshotRetentionDays) || snapshotRetentionDays < 14) {
  fail("provider snapshot retention is below policy");
}
const liveSnapshotCreatedAt = providerTimestamp(
  oneOf(liveSnapshot, ["created_at", "createdAt", "CreatedAt"]),
  "provider snapshot createdAt",
);
if (Math.abs(liveSnapshotCreatedAt - snapshotCreatedAt) > 5 * minute) {
  fail("provider snapshot creation time does not match receipt");
}

const restoreVolumes = jsonFile(restoreVolumesPath, "provider restore volumes");
if (!Array.isArray(restoreVolumes) || restoreVolumes.length !== 1) {
  fail("disposable restore app must expose exactly one volume");
}
const liveRestoreVolume = object(restoreVolumes[0], "provider restore volume");
if (oneOf(liveRestoreVolume, ["id", "ID"]) !== restoreDrill.targetVolumeId) {
  fail("provider restore volume ID does not match receipt");
}
if (oneOf(liveRestoreVolume, ["state", "State"]) !== "created") {
  fail("provider restore volume is not in the created state");
}
if (oneOf(liveRestoreVolume, ["region", "Region"]) !== production.region) {
  fail("provider restore volume region does not match production");
}
if (oneOf(liveRestoreVolume, ["name", "Name"]) !== restoreOperation.requestedVolumeName) {
  fail("provider restore volume name does not match the approved request");
}
if (oneOf(liveRestoreVolume, ["encrypted", "Encrypted"]) !== true) {
  fail("provider restore volume must be encrypted");
}
const restoreSizeGb = oneOf(liveRestoreVolume, ["size_gb", "sizeGb", "SizeGB"]);
if (!Number.isInteger(restoreSizeGb) || restoreSizeGb < sourceSizeGb) {
  fail("provider restore volume is smaller than its source");
}
if (restoreSizeGb !== restoreOperation.requestedSizeGb) {
  fail("provider restore volume size does not match the approved request");
}
const restoreCreatedAt = providerTimestamp(
  oneOf(liveRestoreVolume, ["created_at", "createdAt", "CreatedAt"]),
  "provider restore volume createdAt",
);
if (restoreCreatedAt < snapshotCreatedAt || restoreCreatedAt > restoreCompletedAt) {
  fail("provider restore volume chronology does not match the receipt");
}
if (Math.abs(restoreCreatedAt - responseCreatedAt) > 5 * minute) {
  fail("captured provider response does not match the live restore creation time");
}
const restoreAttachedMachine = oneOf(liveRestoreVolume, [
  "attached_machine_id",
  "attachedMachineId",
  "AttachedMachineID",
]);
if (typeof restoreAttachedMachine !== "string" || restoreAttachedMachine.length === 0) {
  fail("provider restore volume is not attached");
}
if (restoreAttachedMachine !== restoreDrill.targetMachineId) {
  fail("restore volume attachment does not match the receipt machine");
}

const restoreMachines = jsonFile(restoreMachinesPath, "provider restore machines");
if (!Array.isArray(restoreMachines) || restoreMachines.length !== 1) {
  fail("disposable restore app must expose exactly one machine");
}
const liveRestoreMachine = object(restoreMachines[0], "provider restore machine");
if (oneOf(liveRestoreMachine, ["id", "ID"]) !== restoreDrill.targetMachineId) {
  fail("restore machine ID does not match the receipt");
}
if (oneOf(liveRestoreMachine, ["region", "Region"]) !== production.region) {
  fail("restore machine region does not match production");
}
if (oneOf(liveRestoreMachine, ["state", "State"]) !== "started") {
  fail("disposable restore machine must be started for preflight");
}

for (const [path, name] of [
  [sourceIpsPath, "production database public IPs"],
  [restoreIpsPath, "restore target public IPs"],
]) {
  const ips = jsonFile(path, name);
  if (!Array.isArray(ips) || ips.length !== 0) fail(`${name} must be an empty array`);
}

process.stdout.write("Production volume recovery receipt accepted.\n");
