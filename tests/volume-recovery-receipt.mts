import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const releaseSha = "a".repeat(40);
const now = Date.now();
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();
const sourceVolumeId = "vol_source123";
const restoreVolumeId = "vol_restore456";
const snapshotId = "vs_snapshot123";
const sourceMachineId = "0123456789abcd";
const restoreMachineId = "fedcba98765432";

type Json = Record<string, unknown>;

const canonicalSha256 = (value: unknown) =>
  createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");

function validRestoreRequest(): Json {
  return {
    schemaVersion: 1,
    operation: "create-volume-from-snapshot",
    snapshotId,
    app: `aria-mantu-db-recovery-${releaseSha.slice(0, 12)}`,
    volumeName: "aria_db_data_restore",
    region: "cdg",
    sizeGb: 10,
  };
}

function validRestoreResponse(): Json {
  return {
    id: restoreVolumeId,
    name: "aria_db_data_restore",
    state: "created",
    size_gb: 10,
    region: "cdg",
    encrypted: true,
    created_at: iso(now - 59 * 60 * 1000),
  };
}

function validReceipt(): Json {
  return {
    schemaVersion: 2,
    releaseSha,
    production: {
      app: "aria-mantu-db",
      volumeName: "aria_db_data",
      volumeId: sourceVolumeId,
      machineId: sourceMachineId,
      region: "cdg",
    },
    recoveryPoint: {
      provider: "fly-volume-snapshot",
      snapshotId,
      snapshotDigest: "76d64a69199766d1600d46f0fd48ad9c-1",
      createdAt: iso(now - 60 * 60 * 1000),
      writesQuiescedAt: iso(now - 61 * 60 * 1000),
    },
    restoreDrill: {
      status: "passed",
      targetApp: `aria-mantu-db-recovery-${releaseSha.slice(0, 12)}`,
      targetVolumeId: restoreVolumeId,
      targetMachineId: restoreMachineId,
      completedAt: iso(now - 30 * 60 * 1000),
      destroyAfter: iso(now + 12 * 60 * 60 * 1000),
      restoreOperation: {
        requestedSnapshotId: snapshotId,
        requestedApp: `aria-mantu-db-recovery-${releaseSha.slice(0, 12)}`,
        requestedVolumeName: "aria_db_data_restore",
        requestedRegion: "cdg",
        requestedSizeGb: 10,
        createdVolumeId: restoreVolumeId,
        providerRequestSha256: canonicalSha256(validRestoreRequest()),
        providerResponseSha256: canonicalSha256(validRestoreResponse()),
      },
      postgresMajor: 17,
      schemaFingerprintSha256: "b".repeat(64),
      rowFingerprintSha256: "c".repeat(64),
      migrationManifestSha256: "d".repeat(64),
      migrationState: "verified-pre-ledger",
      recoveryPreflightSha256: "f".repeat(64),
      legacyBaselineApprovalSha256: "f".repeat(64),
    },
    approval: {
      approvedAt: iso(now - 15 * 60 * 1000),
      expiresAt: iso(now + 60 * 60 * 1000),
      approvedBy: "release-owner",
    },
  };
}

function validVolumes(): unknown[] {
  return [
    {
      id: sourceVolumeId,
      name: "aria_db_data",
      state: "created",
      region: "cdg",
      attached_machine_id: sourceMachineId,
      encrypted: true,
      size_gb: 10,
      snapshot_retention: 14,
      auto_backup_enabled: true,
      created_at: iso(now - 30 * 24 * 60 * 60 * 1000),
    },
  ];
}

function validSnapshots(): unknown[] {
  return [
    {
      id: snapshotId,
      size: 36_007_729,
      digest: "76d64a69199766d1600d46f0fd48ad9c-1",
      created_at: iso(now - 60 * 60 * 1000),
      retention_days: 14,
    },
  ];
}

function validRestoreVolumes(): unknown[] {
  return [
    {
      id: restoreVolumeId,
      name: "aria_db_data_restore",
      state: "created",
      region: "cdg",
      attached_machine_id: restoreMachineId,
      encrypted: true,
      size_gb: 10,
      created_at: iso(now - 59 * 60 * 1000),
    },
  ];
}

function validSourceMachines(): unknown[] {
  return [{ id: sourceMachineId, state: "stopped", region: "cdg" }];
}

function validRestoreMachines(): unknown[] {
  return [{ id: restoreMachineId, state: "started", region: "cdg" }];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function run(
  receipt: unknown,
  volumes: unknown = validVolumes(),
  snapshots: unknown = validSnapshots(),
  restoreVolumes: unknown = validRestoreVolumes(),
  sourceIps: unknown = [],
  restoreIps: unknown = [],
  restoreRequest: unknown = validRestoreRequest(),
  restoreResponse: unknown = validRestoreResponse(),
  sourceMachines: unknown = validSourceMachines(),
  restoreMachines: unknown = validRestoreMachines(),
) {
  const root = mkdtempSync(join(tmpdir(), "aria-recovery-receipt-"));
  const receiptPath = join(root, "receipt.json");
  const volumesPath = join(root, "volumes.json");
  const snapshotsPath = join(root, "snapshots.json");
  const restoreVolumesPath = join(root, "restore-volumes.json");
  const sourceIpsPath = join(root, "source-ips.json");
  const restoreIpsPath = join(root, "restore-ips.json");
  const restoreRequestPath = join(root, "restore-request.json");
  const restoreResponsePath = join(root, "restore-response.json");
  const sourceMachinesPath = join(root, "source-machines.json");
  const restoreMachinesPath = join(root, "restore-machines.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  writeFileSync(volumesPath, `${JSON.stringify(volumes)}\n`);
  writeFileSync(snapshotsPath, `${JSON.stringify(snapshots)}\n`);
  writeFileSync(restoreVolumesPath, `${JSON.stringify(restoreVolumes)}\n`);
  writeFileSync(sourceIpsPath, `${JSON.stringify(sourceIps)}\n`);
  writeFileSync(restoreIpsPath, `${JSON.stringify(restoreIps)}\n`);
  writeFileSync(restoreRequestPath, `${JSON.stringify(restoreRequest)}\n`, { mode: 0o600 });
  writeFileSync(restoreResponsePath, `${JSON.stringify(restoreResponse)}\n`, { mode: 0o600 });
  writeFileSync(sourceMachinesPath, `${JSON.stringify(sourceMachines)}\n`);
  writeFileSync(restoreMachinesPath, `${JSON.stringify(restoreMachines)}\n`);
  return spawnSync(
    process.execPath,
    [
      "scripts/validate-volume-recovery-receipt.mjs",
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
      releaseSha,
    ],
    { encoding: "utf8" },
  );
}

assert.equal(run(validReceipt()).status, 0, "valid bound receipt and provider state must pass");

const wrongSha = validReceipt();
wrongSha.releaseSha = "d".repeat(40);
assert.notEqual(run(wrongSha).status, 0, "receipt must bind the exact release SHA");

const wrongApp = validReceipt();
(wrongApp.production as Json).app = "other-db";
assert.notEqual(run(wrongApp).status, 0, "receipt must bind the production database app");

const sameRestoreTarget = validReceipt();
(sameRestoreTarget.restoreDrill as Json).targetVolumeId = sourceVolumeId;
assert.notEqual(run(sameRestoreTarget).status, 0, "restore drill must use a disposable volume");

const failedRestore = validReceipt();
(failedRestore.restoreDrill as Json).status = "failed";
assert.notEqual(run(failedRestore).status, 0, "failed restore drills must block release");

const expired = validReceipt();
(expired.approval as Json).expiresAt = iso(now - 1);
assert.notEqual(run(expired).status, 0, "expired owner approvals must block release");

const staleSnapshot = validReceipt();
(staleSnapshot.recoveryPoint as Json).createdAt = iso(now - 25 * 60 * 60 * 1000);
(staleSnapshot.recoveryPoint as Json).writesQuiescedAt = iso(now - 25 * 60 * 60 * 1000 - 60_000);
(staleSnapshot.restoreDrill as Json).completedAt = iso(now - 24 * 60 * 60 * 1000);
assert.notEqual(run(staleSnapshot).status, 0, "stale recovery points must block release");

const unquiesced = validReceipt();
(unquiesced.recoveryPoint as Json).writesQuiescedAt = iso(now - 30 * 60 * 1000);
assert.notEqual(run(unquiesced).status, 0, "write-quiescence must precede the recovery point");

const wrongOrder = validReceipt();
(wrongOrder.restoreDrill as Json).completedAt = iso(now - 90 * 60 * 1000);
assert.notEqual(run(wrongOrder).status, 0, "restore completion must follow snapshot creation");

const missingFingerprint = validReceipt();
delete (missingFingerprint.restoreDrill as Json).schemaFingerprintSha256;
assert.notEqual(run(missingFingerprint).status, 0, "restore proof must include a schema fingerprint");

const missingManifest = validReceipt();
delete (missingManifest.restoreDrill as Json).migrationManifestSha256;
assert.notEqual(run(missingManifest).status, 0, "restore proof must include the exact migration manifest");

const liveVolumeMismatch = validVolumes();
(liveVolumeMismatch[0] as Json).id = "vol_other123";
assert.notEqual(run(validReceipt(), liveVolumeMismatch).status, 0, "provider volume must match the receipt");

const ambiguousVolumes = [...validVolumes(), ...validVolumes()];
assert.notEqual(run(validReceipt(), ambiguousVolumes).status, 0, "production must have exactly one source volume");

const detachedVolumes = validVolumes();
(detachedVolumes[0] as Json).attached_machine_id = null;
assert.notEqual(run(validReceipt(), detachedVolumes).status, 0, "source volume must be attached");

const incompleteSnapshot = validSnapshots();
(incompleteSnapshot[0] as Json).status = "running";
assert.notEqual(run(validReceipt(), validVolumes(), incompleteSnapshot).status, 0, "provider snapshot must be complete");

const wrongSnapshotTime = validSnapshots();
(wrongSnapshotTime[0] as Json).created_at = iso(now - 2 * 60 * 60 * 1000);
assert.notEqual(run(validReceipt(), validVolumes(), wrongSnapshotTime).status, 0, "receipt time must match provider state");

const wrongRestoreVolume = validRestoreVolumes();
(wrongRestoreVolume[0] as Json).id = "vol_unapproved789";
assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), wrongRestoreVolume).status,
  0,
  "live disposable restore volume must match the receipt",
);

const wrongRestoreProvenance = validReceipt();
((wrongRestoreProvenance.restoreDrill as Json).restoreOperation as Json).requestedSnapshotId = "vs_unreviewed";
assert.notEqual(run(wrongRestoreProvenance).status, 0, "restore operation must bind the selected snapshot");

const wrongRequestArtifact = validRestoreRequest();
wrongRequestArtifact.snapshotId = "vs_unreviewed";
assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), validRestoreVolumes(), [], [], wrongRequestArtifact).status,
  0,
  "captured restore request must bind the selected snapshot",
);

const wrongResponseArtifact = validRestoreResponse();
wrongResponseArtifact.id = "vol_unreviewed789";
assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), validRestoreVolumes(), [], [], validRestoreRequest(), wrongResponseArtifact).status,
  0,
  "captured provider response must bind the created restore volume",
);

const forgedProviderHash = validReceipt();
((forgedProviderHash.restoreDrill as Json).restoreOperation as Json).providerResponseSha256 = "e".repeat(64);
assert.notEqual(run(forgedProviderHash).status, 0, "provider response digest must be recomputed from the private artifact");

assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), validRestoreVolumes(), [], [], validRestoreRequest(), validRestoreResponse(), [
    ...validSourceMachines(),
    { id: "11111111111111", state: "stopped", region: "cdg" },
  ]).status,
  0,
  "production recovery must reject extra database machines",
);

assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), validRestoreVolumes(), [], [], validRestoreRequest(), validRestoreResponse(), validSourceMachines(), [
    { id: "22222222222222", state: "started", region: "cdg" },
  ]).status,
  0,
  "restore recovery must bind the only machine to the restored volume",
);

const lowRetention = validVolumes();
(lowRetention[0] as Json).snapshot_retention = 5;
assert.notEqual(run(validReceipt(), lowRetention).status, 0, "live source retention must meet policy");

const backupsDisabled = validVolumes();
(backupsDisabled[0] as Json).auto_backup_enabled = false;
assert.notEqual(run(validReceipt(), backupsDisabled).status, 0, "scheduled source snapshots must be enabled");

const unencryptedRestore = validRestoreVolumes();
(unencryptedRestore[0] as Json).encrypted = false;
assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), unencryptedRestore).status,
  0,
  "disposable restore volume must be encrypted",
);

assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), validRestoreVolumes(), [{ address: "203.0.113.1" }]).status,
  0,
  "production database app must not have public IPs",
);
assert.notEqual(
  run(validReceipt(), validVolumes(), validSnapshots(), validRestoreVolumes(), [], [{ address: "203.0.113.2" }]).status,
  0,
  "disposable restore app must not have public IPs",
);

const reversedApproval = validReceipt();
(reversedApproval.approval as Json).expiresAt = iso(now - 16 * 60 * 1000);
assert.notEqual(run(reversedApproval).status, 0, "approval expiry must follow approval");

const impossibleDate = validReceipt();
(impossibleDate.approval as Json).approvedAt = "2026-02-30T12:00:00.000Z";
assert.notEqual(run(impossibleDate).status, 0, "impossible calendar dates must fail canonical validation");

const invalidMigrationState = validReceipt();
(invalidMigrationState.restoreDrill as Json).migrationState = "trust-me";
assert.notEqual(run(invalidMigrationState).status, 0, "migration state must use a reviewed mode");

const completeLedger = validReceipt();
(completeLedger.restoreDrill as Json).migrationState = "complete-ledger";
(completeLedger.restoreDrill as Json).legacyBaselineApprovalSha256 = null;
assert.equal(run(completeLedger).status, 0, "complete-ledger recovery must not authorize legacy baselining");

const verifiedEmpty = validReceipt();
(verifiedEmpty.restoreDrill as Json).migrationState = "verified-empty";
(verifiedEmpty.restoreDrill as Json).legacyBaselineApprovalSha256 = null;
assert.equal(run(verifiedEmpty).status, 0, "verified-empty recovery must proceed without ledger adoption authority");

const malformed = run("not-an-object");
assert.notEqual(malformed.status, 0, "malformed receipt must fail closed");

console.log("volume-recovery-receipt: 35/35 passed");
