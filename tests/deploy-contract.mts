import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deriveAgentFrameworkConfiguration } from "../src/lib/agents/framework/configuration-core.mjs";

const deploySource = readFileSync("deploy-fly.sh", "utf8");
const firstAdminPath = "scripts/provision-first-admin.sh";
const firstAdminSource = existsSync(firstAdminPath) ? readFileSync(firstAdminPath, "utf8") : "";
const deployedE2eSource = readFileSync("e2e-workflow-test.sh", "utf8");

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function executable(path: string, source: string) {
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
}

type Scenario = {
  rest?: string;
  auth?: string;
  app?: string;
  ready?: string;
  kong?: string;
  cleanupStatus?: "ok" | "degraded";
  heartbeatStatus?: "ok" | "degraded";
  failFlyMatch?: string;
  invalidJwt?: boolean;
  weakDbPassword?: boolean;
  duplicateDbPassword?: boolean;
  unsafeOwnerPassword?: boolean;
  invalidDataEncryptionKey?: boolean;
  invalidPreviousEncryptionKeys?: boolean;
  previousEncryptionKeys?: string;
  ringRetirementApproval?: boolean;
  weakCronSecret?: boolean;
  appImageRef?: string;
  dbImageRef?: string;
  bootstrapImageRef?: string;
  kongImageRef?: string;
  flyStateDir?: string;
  tavilyApiKey?: string;
  invalidRecoveryReceipt?: boolean;
  recoveryMigrationState?: "verified-empty" | "verified-pre-ledger" | "complete-ledger";
  previousImagesUnavailable?: boolean;
  firstDeployApproval?: boolean;
  protectedContext?: boolean;
  unexpectedSecret?: boolean;
  inventoryStatus?: "Deployed" | "Staged" | "Partial" | "Unknown" | "Corrupt" | "missing";
  postDeployInventoryStatus?: "Deployed" | "Staged" | "Partial" | "Unknown" | "Corrupt" | "missing";
  lateSecretDrift?: boolean;
};

type FakeSecret = {
  app: string;
  name: string;
  value: string;
};

function readFakeSecrets(path: string): FakeSecret[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [app, name, value] = line.split("\t");
      return { app, name, value };
    });
}

function readFakeSecretKeys(path: string): Array<Pick<FakeSecret, "app" | "name">> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [app, name] = line.split("\t");
      return { app, name };
    });
}

const releaseSha = "a".repeat(40);
const fakeManifest = '{"schemaVersion":2}';
const fakeManifestDigest = `sha256:${createHash("sha256").update(fakeManifest).digest("hex")}`;
const contractJwtSecret = "JwtSecret_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const contractPgPassword = "PostgresTarget_0123456789abcdefghijklmnopqrstuvwxyzAB";
const contractOwnerCurrentPassword = "contract:legacy/owner";
const contractOwnerTargetPassword = "OwnerTarget_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const contractAuthPassword = "AuthTarget_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
const contractRestPassword = "RestTarget_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
const contractDataEncryptionKey = Buffer.alloc(32, 0x42).toString("base64");
const contractPreviousEncryptionKeys = JSON.stringify([Buffer.alloc(32, 0x43).toString("base64")]);
const contractCronSecret = "c".repeat(64);
const contractFrameworkCapabilitySecret = "framework-capability-secret-contract-value-0001";
const contractDeerFlowAdapterToken = "deerflow-adapter-token-contract-value-0002";
const contractFlowiseAdapterToken = "flowise-adapter-token-contract-value-0003";
const contractFrameworkInput = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  adapterImageDigest: `registry.internal/aria-adapter@sha256:${"1".repeat(64)}`,
  redisImageDigest: `registry.internal/redis@sha256:${"2".repeat(64)}`,
  deerflowAdapterOrigin: "https://deerflow.service.internal",
  deerflowInstanceId: "20000000-0000-4000-8000-000000000002",
  deerflowSourceCommit: "fabadae4168db81f0eaaf62f209050f978e2f691",
  deerflowImageDigest: `registry.internal/deerflow@sha256:${"3".repeat(64)}`,
  deerflowDatabaseImageDigest: `registry.internal/deerflow-db@sha256:${"4".repeat(64)}`,
  deerflowModelGatewayImageDigest: `registry.internal/model-gateway@sha256:${"8".repeat(64)}`,
  deerflowCloudProviderId: "kimi",
  deerflowModelProvider: "langchain-openai",
  deerflowModelId: "gpt-contract",
  deerflowModelBaseUrl: "https://model-gateway.service.internal/v1",
  deerflowModelCredentialVersion: "model-key-contract-v1",
  flowiseAdapterOrigin: "https://flowise.service.internal",
  flowiseInstanceId: "30000000-0000-4000-8000-000000000003",
  flowiseSourceCommit: "bb773ffa710bd22639c4ba2643413a0ea2b679d3",
  flowiseImageDigest: `registry.internal/flowise@sha256:${"5".repeat(64)}`,
  flowiseWorkerImageDigest: `registry.internal/flowise-worker@sha256:${"6".repeat(64)}`,
  flowiseDatabaseImageDigest: `registry.internal/flowise-db@sha256:${"7".repeat(64)}`,
  flowiseWorkspaceId: "40000000-0000-4000-8000-000000000004",
  flowiseReadinessWorkflowId: "flow_contract",
  flowiseIsolation: "instance-per-workspace",
  flowiseQueueName: "aria-flowise",
};
const contractFrameworkEnvironment = {
  AGENT_FRAMEWORKS_REQUIRED: "true",
  AGENT_FRAMEWORK_EXECUTION_ENABLED: "false",
  AGENT_FRAMEWORK_KILL_SWITCH: "true",
  AGENT_FRAMEWORK_CONFIGURATION_SHA256: deriveAgentFrameworkConfiguration(contractFrameworkInput).sha256,
  AGENT_FRAMEWORK_READINESS_WORKSPACE_ID: contractFrameworkInput.workspaceId,
  FRAMEWORK_ADAPTER_IMAGE_DIGEST: contractFrameworkInput.adapterImageDigest,
  REDIS_IMAGE_DIGEST: contractFrameworkInput.redisImageDigest,
  DEERFLOW_ADAPTER_URL: contractFrameworkInput.deerflowAdapterOrigin,
  DEERFLOW_SOURCE_COMMIT: contractFrameworkInput.deerflowSourceCommit,
  DEERFLOW_IMAGE_DIGEST: contractFrameworkInput.deerflowImageDigest,
  DEERFLOW_DATABASE_IMAGE_DIGEST: contractFrameworkInput.deerflowDatabaseImageDigest,
  DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST: contractFrameworkInput.deerflowModelGatewayImageDigest,
  DEERFLOW_CLOUD_PROVIDER_ID: contractFrameworkInput.deerflowCloudProviderId,
  DEERFLOW_FRAMEWORK_INSTANCE_ID: contractFrameworkInput.deerflowInstanceId,
  DEERFLOW_MODEL_PROVIDER: contractFrameworkInput.deerflowModelProvider,
  DEERFLOW_MODEL_ID: contractFrameworkInput.deerflowModelId,
  DEERFLOW_MODEL_BASE_URL: contractFrameworkInput.deerflowModelBaseUrl,
  DEERFLOW_MODEL_CREDENTIAL_VERSION: contractFrameworkInput.deerflowModelCredentialVersion,
  FLOWISE_ADAPTER_URL: contractFrameworkInput.flowiseAdapterOrigin,
  FLOWISE_SOURCE_COMMIT: contractFrameworkInput.flowiseSourceCommit,
  FLOWISE_IMAGE_DIGEST: contractFrameworkInput.flowiseImageDigest,
  FLOWISE_WORKER_IMAGE_DIGEST: contractFrameworkInput.flowiseWorkerImageDigest,
  FLOWISE_DATABASE_IMAGE_DIGEST: contractFrameworkInput.flowiseDatabaseImageDigest,
  FLOWISE_FRAMEWORK_INSTANCE_ID: contractFrameworkInput.flowiseInstanceId,
  FLOWISE_WORKSPACE_ID: contractFrameworkInput.flowiseWorkspaceId,
  FLOWISE_READINESS_WORKFLOW_ID: contractFrameworkInput.flowiseReadinessWorkflowId,
  FLOWISE_TENANT_ISOLATION: contractFrameworkInput.flowiseIsolation,
  FLOWISE_QUEUE_NAME: contractFrameworkInput.flowiseQueueName,
};
function signJwt(role: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  const signature = createHmac("sha256", contractJwtSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
const contractAnonKey = signJwt("anon");
const contractServiceKey = signJwt("service_role");
const authPinnedDigest = /@(?<digest>sha256:[0-9a-f]{64})/.exec(readFileSync("fly.auth.toml", "utf8"))?.groups?.digest ?? "";
const restPinnedDigest = /@(?<digest>sha256:[0-9a-f]{64})/.exec(readFileSync("fly.rest.toml", "utf8"))?.groups?.digest ?? "";

function runDeploy(scenario: Scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "aria-deploy-contract-"));
  const bin = join(root, "bin");
  const readiness = join(root, "production-readiness");
  const temp = join(root, "tmp");
  const flyLog = join(root, "fly.log");
  const flyStateDir = scenario.flyStateDir ?? join(root, "fly-state");
  const flyStagedSecretState = join(flyStateDir, "staged-secrets.state");
  const flyStagedSecretDeletionState = join(flyStateDir, "staged-secret-deletions.state");
  const flyAmbiguousSecretState = join(flyStateDir, "ambiguous-staged-secrets.state");
  const flyActiveSecretState = join(flyStateDir, "active-secrets.state");
  const flySecretRestartLog = join(flyStateDir, "secret-restarts.log");
  const receiptPath = join(root, "deployment-receipt.json");
  const predeployReceiptPath = join(root, "predeploy-receipt.json");
  const recoveryReceiptPath = join(root, "volume-recovery-receipt.json");
  const recoveryRestoreRequestPath = join(root, "volume-restore-create-request.json");
  const recoveryRestoreResponsePath = join(root, "volume-restore-create-response.json");
  const recoveryVolumesPath = join(root, "volume-recovery-volumes.json");
  const recoverySnapshotsPath = join(root, "volume-recovery-snapshots.json");
  const recoveryRestoreVolumesPath = join(root, "volume-recovery-restore-volumes.json");
  const recoverySourceMachinesPath = join(root, "volume-recovery-source-machines.json");
  const recoveryRestoreMachinesPath = join(root, "volume-recovery-restore-machines.json");
  const recoverySourceIpsPath = join(root, "volume-recovery-source-ips.json");
  const recoveryRestoreIpsPath = join(root, "volume-recovery-restore-ips.json");

  try {
    mkdirSync(bin);
    mkdirSync(readiness);
    mkdirSync(temp);
    mkdirSync(flyStateDir, { recursive: true });
    writeFileSync(flyLog, "");
    if (!existsSync(flyStagedSecretState)) writeFileSync(flyStagedSecretState, "");
    if (!existsSync(flyStagedSecretDeletionState)) writeFileSync(flyStagedSecretDeletionState, "");
    if (!existsSync(flyAmbiguousSecretState)) writeFileSync(flyAmbiguousSecretState, "");
    if (!existsSync(flyActiveSecretState)) writeFileSync(flyActiveSecretState, "");
    if (!existsSync(flySecretRestartLog)) writeFileSync(flySecretRestartLog, "");
    if (scenario.inventoryStatus && !readFakeSecrets(flyActiveSecretState).some(({ app }) => app === "aria-mantu-app")) {
      writeFileSync(
        flyActiveSecretState,
        `${readFileSync(flyActiveSecretState, "utf8")}aria-mantu-app\tSUPABASE_SERVICE_ROLE_KEY\tcontract-existing-service-key\n`,
      );
    }
    if (
      scenario.unexpectedSecret &&
      !readFakeSecrets(flyActiveSecretState).some(
        ({ app, name }) => app === "aria-mantu-app" && name === "UNEXPECTED_LEGACY_SECRET",
      )
    ) {
      writeFileSync(
        flyActiveSecretState,
        `${readFileSync(flyActiveSecretState, "utf8")}aria-mantu-app\tUNEXPECTED_LEGACY_SECRET\tlegacy-value\n`,
      );
    }
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "src", "lib", "agents", "framework"), { recursive: true });
    copyFileSync("deploy-fly.sh", join(root, "deploy-fly.sh"));
    copyFileSync("fly.auth.toml", join(root, "fly.auth.toml"));
    copyFileSync("fly.rest.toml", join(root, "fly.rest.toml"));
    copyFileSync(
      "scripts/validate-volume-recovery-receipt.mjs",
      join(root, "scripts", "validate-volume-recovery-receipt.mjs"),
    );
    copyFileSync(
      "scripts/verify-apollo-cleanup-release.mjs",
      join(root, "scripts", "verify-apollo-cleanup-release.mjs"),
    );
    copyFileSync(
      "scripts/agent-framework-configuration.mjs",
      join(root, "scripts", "agent-framework-configuration.mjs"),
    );
    copyFileSync(
      "src/lib/agents/framework/configuration-core.mjs",
      join(root, "src", "lib", "agents", "framework", "configuration-core.mjs"),
    );
    writeFileSync(join(root, ".env.local"), "\n", { mode: 0o600 });
    writeFileSync(join(root, "supabase", "migrations", "0018_contract.sql"), "select 1;\n");
    writeFileSync(join(readiness, ".fly-token.env"), "contract-token\n", { mode: 0o600 });
    const now = Date.now();
    const recoverySnapshotCreatedAt = new Date(now - 60 * 60 * 1000).toISOString();
    const sourceMachineId = "0123456789abcd";
    const restoreMachineId = "fedcba98765432";
    const restoreCreatedAt = new Date(now - 59 * 60 * 1000).toISOString();
    const restoreRequest = {
      schemaVersion: 1,
      operation: "create-volume-from-snapshot",
      snapshotId: "vs_contractsnapshot",
      app: `aria-mantu-db-recovery-${releaseSha.slice(0, 12)}`,
      volumeName: "aria_db_data_restore",
      region: "cdg",
      sizeGb: 10,
    };
    const restoreResponse = {
      id: "vol_contractrestore",
      name: "aria_db_data_restore",
      state: "created",
      size_gb: 10,
      region: "cdg",
      encrypted: true,
      created_at: restoreCreatedAt,
    };
    const canonicalSha256 = (value: unknown) =>
      createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
    writeFileSync(recoveryRestoreRequestPath, `${JSON.stringify(restoreRequest)}\n`, { mode: 0o600 });
    writeFileSync(recoveryRestoreResponsePath, `${JSON.stringify(restoreResponse)}\n`, { mode: 0o600 });
    writeFileSync(
      recoveryReceiptPath,
      `${JSON.stringify({
        schemaVersion: 2,
        releaseSha,
        production: {
          app: "aria-mantu-db",
          volumeName: "aria_db_data",
          volumeId: "vol_contractsource",
          machineId: sourceMachineId,
          region: "cdg",
        },
        recoveryPoint: {
          provider: "fly-volume-snapshot",
          snapshotId: "vs_contractsnapshot",
          snapshotDigest: scenario.invalidRecoveryReceipt
            ? "invalidsnapshotdigest0000000000000000-1"
            : "76d64a69199766d1600d46f0fd48ad9c-1",
          createdAt: recoverySnapshotCreatedAt,
          writesQuiescedAt: new Date(now - 61 * 60 * 1000).toISOString(),
        },
        restoreDrill: {
          status: "passed",
          targetApp: `aria-mantu-db-recovery-${releaseSha.slice(0, 12)}`,
          targetVolumeId: "vol_contractrestore",
          targetMachineId: restoreMachineId,
          completedAt: new Date(now - 30 * 60 * 1000).toISOString(),
          destroyAfter: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
          restoreOperation: {
            requestedSnapshotId: "vs_contractsnapshot",
            requestedApp: `aria-mantu-db-recovery-${releaseSha.slice(0, 12)}`,
            requestedVolumeName: "aria_db_data_restore",
            requestedRegion: "cdg",
            requestedSizeGb: 10,
            createdVolumeId: "vol_contractrestore",
            providerRequestSha256: canonicalSha256(restoreRequest),
            providerResponseSha256: canonicalSha256(restoreResponse),
          },
          postgresMajor: 17,
          schemaFingerprintSha256: "b".repeat(64),
          rowFingerprintSha256: "c".repeat(64),
          migrationManifestSha256: "d".repeat(64),
          migrationState: scenario.recoveryMigrationState ?? "verified-empty",
          recoveryPreflightSha256: "f".repeat(64),
          legacyBaselineApprovalSha256:
            scenario.recoveryMigrationState === "verified-pre-ledger" ? "f".repeat(64) : null,
        },
        approval: {
          approvedAt: new Date(now - 15 * 60 * 1000).toISOString(),
          expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
          approvedBy: "contract-owner",
        },
      })}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      recoveryVolumesPath,
      `${JSON.stringify([
        {
          id: "vol_contractsource",
          name: "aria_db_data",
          state: "created",
          region: "cdg",
          attached_machine_id: sourceMachineId,
          encrypted: true,
          size_gb: 10,
          snapshot_retention: 14,
          auto_backup_enabled: true,
          created_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ])}\n`,
    );
    writeFileSync(
      recoverySnapshotsPath,
      `${JSON.stringify([
        {
          id: "vs_contractsnapshot",
          size: 36_007_729,
          digest: "76d64a69199766d1600d46f0fd48ad9c-1",
          created_at: recoverySnapshotCreatedAt,
          retention_days: 14,
        },
      ])}\n`,
    );
    writeFileSync(
      recoveryRestoreVolumesPath,
      `${JSON.stringify([
        {
          id: "vol_contractrestore",
          name: "aria_db_data_restore",
          state: "created",
          region: "cdg",
          attached_machine_id: restoreMachineId,
          encrypted: true,
          size_gb: 10,
          created_at: restoreCreatedAt,
        },
      ])}\n`,
    );
    writeFileSync(
      recoverySourceMachinesPath,
      `${JSON.stringify([{ id: sourceMachineId, state: "stopped", region: "cdg" }])}\n`,
    );
    writeFileSync(
      recoveryRestoreMachinesPath,
      `${JSON.stringify([{ id: restoreMachineId, state: "started", region: "cdg" }])}\n`,
    );
    writeFileSync(recoverySourceIpsPath, "[]\n");
    writeFileSync(recoveryRestoreIpsPath, "[]\n");
    writeFileSync(
      join(readiness, ".fly-secrets.env"),
      [
        `FLY_PG_PASSWORD=${scenario.weakDbPassword ? "too-short" : contractPgPassword}`,
        `FLY_SUPABASE_ADMIN_CURRENT_PASSWORD=${contractOwnerCurrentPassword}`,
        `FLY_SUPABASE_ADMIN_TARGET_PASSWORD=${scenario.unsafeOwnerPassword ? "unsafe'owner/password-value-0123456789" : contractOwnerTargetPassword}`,
        `FLY_AUTH_DB_PASSWORD=${scenario.duplicateDbPassword ? contractPgPassword : contractAuthPassword}`,
        `FLY_REST_DB_PASSWORD=${contractRestPassword}`,
        `FLY_JWT_SECRET=${contractJwtSecret}`,
        `FLY_SUPABASE_ANON_KEY=${scenario.invalidJwt ? "invalid" : contractAnonKey}`,
        `FLY_SUPABASE_SERVICE_KEY=${contractServiceKey}`,
        `FLY_DATA_ENCRYPTION_KEY=${scenario.invalidDataEncryptionKey ? "not-canonical-base64" : contractDataEncryptionKey}`,
        `FLY_DATA_ENCRYPTION_PREVIOUS_KEYS=${scenario.invalidPreviousEncryptionKeys ? "not-json" : scenario.previousEncryptionKeys ?? ""}`,
        `FLY_CRON_SECRET=${scenario.weakCronSecret ? "abc123" : contractCronSecret}`,
        `FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET=${contractFrameworkCapabilitySecret}`,
        `FLY_DEERFLOW_ADAPTER_TOKEN=${contractDeerFlowAdapterToken}`,
        `FLY_FLOWISE_ADAPTER_TOKEN=${contractFlowiseAdapterToken}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    executable(
      join(bin, "git"),
      `#!/bin/bash
set -eu
case "\${1:-} \${2:-}" in
  "rev-parse HEAD") printf '%s\n' "$FAKE_RELEASE_SHA" ;;
  "status --porcelain") exit 0 ;;
  *) exit 2 ;;
esac
`,
    );

    executable(
      join(bin, "flyctl"),
      `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_FLY_LOG"
app=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--app" ]; then app="$argument"; fi
  previous="$argument"
done
upsert_secret(){
  state="$1" target_app="$2" target_name="$3" target_value="$4"
  temporary="$state.tmp"
  awk -F '\\t' -v app="$target_app" -v name="$target_name" '!($1 == app && $2 == name)' "$state" > "$temporary"
  printf '%s\\t%s\\t%s\\n' "$target_app" "$target_name" "$target_value" >> "$temporary"
  mv "$temporary" "$state"
}
remove_secret(){
  state="$1" target_app="$2" target_name="$3"
  temporary="$state.tmp"
  awk -F '\\t' -v app="$target_app" -v name="$target_name" '!($1 == app && $2 == name)' "$state" > "$temporary"
  mv "$temporary" "$state"
}
secret_exists(){
  state="$1" target_app="$2" target_name="$3"
  awk -F '\\t' -v app="$target_app" -v name="$target_name" '
    $1 == app && $2 == name { found=1 }
    END { exit found ? 0 : 1 }
  ' "$state"
}
activate_staged_secrets(){
  target_app="$1"
  while IFS=$'\\t' read -r row_app row_name row_value; do
    [ "$row_app" = "$target_app" ] || continue
    upsert_secret "$FAKE_FLY_ACTIVE_SECRET_STATE" "$row_app" "$row_name" "$row_value"
  done < "$FAKE_FLY_STAGED_SECRET_STATE"
  while IFS=$'\\t' read -r row_app row_name _; do
    [ "$row_app" = "$target_app" ] || continue
    remove_secret "$FAKE_FLY_ACTIVE_SECRET_STATE" "$row_app" "$row_name"
  done < "$FAKE_FLY_STAGED_SECRET_DELETION_STATE"
  temporary="$FAKE_FLY_STAGED_SECRET_STATE.tmp"
  awk -F '\\t' -v app="$target_app" '$1 != app' "$FAKE_FLY_STAGED_SECRET_STATE" > "$temporary"
  mv "$temporary" "$FAKE_FLY_STAGED_SECRET_STATE"
  for state in "$FAKE_FLY_STAGED_SECRET_DELETION_STATE" "$FAKE_FLY_AMBIGUOUS_SECRET_STATE"; do
    temporary="$state.tmp"
    awk -F '\\t' -v app="$target_app" '$1 != app' "$state" > "$temporary"
    mv "$temporary" "$state"
  done
}
if [[ "$*" == *"secrets import"* ]]; then
  while IFS= read -r line; do
    printf 'stdin:%s\\n' "$line" >> "$FAKE_FLY_LOG"
    name="\${line%%=*}"
    value="\${line#*=}"
    remove_secret "$FAKE_FLY_STAGED_SECRET_DELETION_STATE" "$app" "$name"
    remove_secret "$FAKE_FLY_AMBIGUOUS_SECRET_STATE" "$app" "$name"
    upsert_secret "$FAKE_FLY_STAGED_SECRET_STATE" "$app" "$name" "$value"
    if [ -n "\${FAKE_FLY_FAIL_MATCH:-}" ] && [[ "$*" == *"$FAKE_FLY_FAIL_MATCH"* ]]; then
      upsert_secret "$FAKE_FLY_AMBIGUOUS_SECRET_STATE" "$app" "$name" ambiguous
    fi
  done
elif [[ "$*" == *"secrets unset"* ]]; then
  staged_only=0
  for argument in "$@"; do [ "$argument" != "--stage" ] || staged_only=1; done
  if [ "$staged_only" = 0 ]; then
    printf '%s\\n' "$app" >> "$FAKE_FLY_SECRET_RESTART_LOG"
  fi
  for argument in "$@"; do
    case "$argument" in
      secrets|unset|--stage|--app|"$app") continue ;;
    esac
    if [ "$staged_only" = 1 ]; then
      if secret_exists "$FAKE_FLY_AMBIGUOUS_SECRET_STATE" "$app" "$argument"; then
        upsert_secret "$FAKE_FLY_STAGED_SECRET_DELETION_STATE" "$app" "$argument" deletion
      elif secret_exists "$FAKE_FLY_ACTIVE_SECRET_STATE" "$app" "$argument"; then
        remove_secret "$FAKE_FLY_STAGED_SECRET_STATE" "$app" "$argument"
        upsert_secret "$FAKE_FLY_STAGED_SECRET_DELETION_STATE" "$app" "$argument" deletion
      else
        remove_secret "$FAKE_FLY_STAGED_SECRET_STATE" "$app" "$argument"
        remove_secret "$FAKE_FLY_STAGED_SECRET_DELETION_STATE" "$app" "$argument"
      fi
    else
      remove_secret "$FAKE_FLY_STAGED_SECRET_STATE" "$app" "$argument"
      remove_secret "$FAKE_FLY_STAGED_SECRET_DELETION_STATE" "$app" "$argument"
      remove_secret "$FAKE_FLY_AMBIGUOUS_SECRET_STATE" "$app" "$argument"
      remove_secret "$FAKE_FLY_ACTIVE_SECRET_STATE" "$app" "$argument"
    fi
  done
elif [[ "$*" == *"deploy --config"* ]]; then
  touch "$FAKE_FLY_STATE_DIR/deploy-started"
  case "$*" in
    *"--config fly.db.toml"*) activate_staged_secrets aria-mantu-db ;;
    *"--config fly.auth.toml"*) activate_staged_secrets aria-mantu-auth ;;
    *"--config fly.rest.toml"*) activate_staged_secrets aria-mantu-rest ;;
    *"--config fly.kong.toml"*) activate_staged_secrets aria-mantu-kong ;;
    *"--config fly.app.toml"*) activate_staged_secrets aria-mantu-app; touch "$FAKE_FLY_STATE_DIR/app-deployed" ;;
  esac
fi
if [ -n "\${FAKE_FLY_FAIL_MATCH:-}" ] && [[ "$*" == *"$FAKE_FLY_FAIL_MATCH"* ]]; then
  exit 23
fi
if [[ "$*" == *"ARIA_BOOTSTRAP_PHASE=recovery-preflight"* ]]; then
  printf 'ARIA_RECOVERY_PREFLIGHT_SHA256=%s\n' "$FAKE_RECOVERY_PREFLIGHT_SHA256"
  if [[ "$*" == *"ARIA_RECOVERY_MIGRATION_STATE=verified-pre-ledger"* ]]; then
    printf 'ARIA_LEGACY_BASELINE_APPROVAL_SHA256=%s\n' "$FAKE_RECOVERY_PREFLIGHT_SHA256"
  fi
fi
if [[ "$*" == *"secrets list"*"--json"* ]]; then
  node -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const app = process.argv[1];
    function read(path) {
      return fs.readFileSync(path, "utf8").split("\\n")
      .filter(Boolean)
      .map((line) => line.split("\\t"))
      .filter(([rowApp]) => rowApp === app);
    }
    const active = new Map(read(process.env.FAKE_FLY_ACTIVE_SECRET_STATE).map(([, name, value]) => [name, value]));
    const staged = new Map(read(process.env.FAKE_FLY_STAGED_SECRET_STATE).map(([, name, value]) => [name, value]));
    const deletions = new Set(read(process.env.FAKE_FLY_STAGED_SECRET_DELETION_STATE).map(([, name]) => name));
    const names = new Set([...active.keys(), ...staged.keys(), ...deletions]);
    let override = app === "aria-mantu-app" ? process.env.FAKE_SECRET_INVENTORY_STATUS : "";
    if (
      app === "aria-mantu-app" &&
      fs.existsSync(process.env.FAKE_FLY_STATE_DIR + "/app-deployed") &&
      process.env.FAKE_POST_DEPLOY_SECRET_INVENTORY_STATUS
    ) {
      override = process.env.FAKE_POST_DEPLOY_SECRET_INVENTORY_STATUS;
    }
    const rows = [...names].sort().map((name) => {
      const value = staged.get(name) ?? active.get(name) ?? ("pending-deletion:" + name);
      const row = {
        name,
        digest: crypto.createHash("sha256").update(value).digest("hex"),
        status: override || (staged.has(name) || deletions.has(name) ? "Staged" : "Deployed"),
      };
      if (row.status === "missing") delete row.status;
      return row;
    });
    process.stdout.write(JSON.stringify(rows) + "\\n");
  ' "$app"
elif [[ "$*" == *"ips list"*"--json"* ]]; then
  printf '[{"Type":"shared_v4"},{"Type":"v6"}]\\n'
elif [[ "$*" == *"image show"*"--json"* ]]; then
  if [ "\${FAKE_LATE_SECRET_DRIFT:-0}" = 1 ] && [ -e "$FAKE_FLY_STATE_DIR/app-deployed" ] && [ ! -e "$FAKE_FLY_STATE_DIR/late-secret-drift" ]; then
    upsert_secret "$FAKE_FLY_ACTIVE_SECRET_STATE" aria-mantu-auth UNEXPECTED_LATE_SECRET late-drift
    touch "$FAKE_FLY_STATE_DIR/late-secret-drift"
  fi
  if [ "\${FAKE_PREVIOUS_IMAGES_UNAVAILABLE:-0}" = 1 ] && [ ! -e "$FAKE_FLY_STATE_DIR/deploy-started" ]; then
    exit 24
  fi
  tag="stock"
  digest="sha256:$(printf '0%.0s' {1..64})"
  case "$*" in
    *"--app aria-mantu-db"*|*"--app aria-mantu-kong"*|*"--app aria-mantu-app"*) tag="$FAKE_RELEASE_TAG" ;;
    *"--app aria-mantu-auth"*) digest="$FAKE_AUTH_PINNED_DIGEST" ;;
    *"--app aria-mantu-rest"*) digest="$FAKE_REST_PINNED_DIGEST" ;;
  esac
  printf '[{"Digest":"%s","Tag":"%s"}]\\n' "$digest" "$tag"
elif [[ "$*" == *"machines list"*"--json"* ]]; then
  digest="sha256:$(printf '0%.0s' {1..64})"
  printf '[{"id":"contract-web","state":"started","config":{"image":"registry.fly.io/aria-mantu-app@%s","metadata":{"fly_process_group":"web"}}},{"id":"contract-cleanup","state":"started","config":{"image":"registry.fly.io/aria-mantu-app@%s","metadata":{"fly_process_group":"cleanup"}}},{"id":"contract-cleanup-standby","state":"stopped","image_ref":"registry.fly.io/aria-mantu-app@%s","config":{"metadata":{"fly_process_group":"cleanup"},"standbys":["contract-cleanup"]}},{"id":"contract-heartbeat","state":"started","config":{"image":"registry.fly.io/aria-mantu-app@%s","metadata":{"fly_process_group":"framework_heartbeat"}}},{"id":"contract-heartbeat-standby","state":"stopped","image_ref":"registry.fly.io/aria-mantu-app@%s","config":{"metadata":{"fly_process_group":"framework_heartbeat"},"standbys":["contract-heartbeat"]}}]\\n' "$digest" "$digest" "$digest" "$digest" "$digest"
elif [[ "$*" == *"logs --app aria-mantu-app"* && "$*" == *"--machine contract-cleanup"* ]]; then
  printf '{"event":"apollo_authority_cleanup","status":"%s","releaseSha":"%s","startedAt":"%s","workspacesProcessed":1,"processed":0,"expired_receipts_cleared":0,"confirmations_deleted":0,"targets_deleted":0,"expired_targets_scrubbed":0,"quota_rows_deleted":0,"sourcing_lessons_retired":0,"sourcing_lessons_deleted":0,"sourcing_artifacts_deleted":0,"sourcing_runs_deleted":0,"sourcing_quota_rows_deleted":0,"framework_authorizations_deleted":0}\\n' "\${FAKE_CLEANUP_STATUS:-ok}" "$FAKE_RELEASE_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
elif [[ "$*" == *"logs --app aria-mantu-app"* && "$*" == *"--machine contract-heartbeat"* ]]; then
  node -e '
    const [releaseSha, status, timestamp] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      timestamp,
      message: JSON.stringify({
        event: "agent_framework_heartbeat",
        releaseSha,
        status,
        targets: 2,
        ready: 2,
        recorded: 2,
        failureCodes: [],
        durationMs: 5,
      }),
    }) + "\\n");
  ' "$FAKE_RELEASE_SHA" "${scenario.heartbeatStatus ?? "ok"}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
`,
    );

    executable(
      join(bin, "docker"),
      `#!/bin/bash
set -eu
if [[ "$*" == "buildx imagetools inspect"*"--raw"* ]]; then
  printf '%s' "$FAKE_MANIFEST"
  exit 0
fi
exit 2
`,
    );

    executable(
      join(bin, "curl"),
      `#!/bin/bash
set -eu
out=/tmp/sm.out
url="\${!#}"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; continue; fi
  shift
done
printf '{"contract":true}\\n' > "$out"
case "$url" in
  */rest/v1/) code="\${FAKE_REST_STATUS:-200}" ;;
  */auth/v1/health) code="\${FAKE_AUTH_STATUS:-200}" ;;
  */api/health) code="\${FAKE_APP_STATUS:-200}" ;;
  */api/ready) code="\${FAKE_READY_STATUS:-200}" ;;
  */healthz) code="\${FAKE_KONG_STATUS:-200}" ;;
  *) code=500 ;;
esac
printf '%s' "$code"
`,
    );

    executable(
      join(bin, "sleep"),
      `#!/bin/bash
set -eu
case "\${1:-0}" in
  30|40|45|50|300|600|900) /bin/sleep 1 ;;
  *) exit 0 ;;
esac
`,
    );

    const result = spawnSync("/bin/bash", ["deploy-fly.sh"], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        NODE_ENV: "test",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: root,
        TMPDIR: temp,
        LC_ALL: "C",
        FAKE_FLY_LOG: flyLog,
        FAKE_FLY_STAGED_SECRET_STATE: flyStagedSecretState,
        FAKE_FLY_STAGED_SECRET_DELETION_STATE: flyStagedSecretDeletionState,
        FAKE_FLY_AMBIGUOUS_SECRET_STATE: flyAmbiguousSecretState,
        FAKE_FLY_ACTIVE_SECRET_STATE: flyActiveSecretState,
        FAKE_FLY_SECRET_RESTART_LOG: flySecretRestartLog,
        FAKE_FLY_STATE_DIR: flyStateDir,
        FAKE_SECRET_INVENTORY_STATUS: scenario.inventoryStatus ?? "",
        FAKE_POST_DEPLOY_SECRET_INVENTORY_STATUS: scenario.postDeployInventoryStatus ?? "",
        FAKE_LATE_SECRET_DRIFT: scenario.lateSecretDrift ? "1" : "0",
        FAKE_PREVIOUS_IMAGES_UNAVAILABLE: scenario.previousImagesUnavailable ? "1" : "0",
        FAKE_RELEASE_SHA: releaseSha,
        FAKE_RELEASE_TAG: `sha-${releaseSha}`,
        FAKE_MANIFEST: fakeManifest,
        FAKE_AUTH_PINNED_DIGEST: authPinnedDigest,
        FAKE_REST_PINNED_DIGEST: restPinnedDigest,
        FAKE_RECOVERY_PREFLIGHT_SHA256: "f".repeat(64),
        FAKE_FLY_FAIL_MATCH: scenario.failFlyMatch ?? "",
        FAKE_REST_STATUS: scenario.rest ?? "200",
        FAKE_AUTH_STATUS: scenario.auth ?? "200",
        FAKE_APP_STATUS: scenario.app ?? "200",
        FAKE_READY_STATUS: scenario.ready ?? "200",
        FAKE_KONG_STATUS: scenario.kong ?? "200",
        FAKE_CLEANUP_STATUS: scenario.cleanupStatus ?? "ok",
        TAVILY_API_KEY: scenario.tavilyApiKey ?? "",
        GITHUB_ACTIONS: "true",
        GITHUB_REF_PROTECTED: "true",
        GITHUB_WORKFLOW_REF:
          "mantu/msourcing/.github/workflows/deploy-aria-mantu.yml@refs/heads/deploy/fly-github-actions",
        GITHUB_RUN_ID: "123456789",
        GITHUB_RUN_ATTEMPT: "1",
        ARIA_RELEASE_SHA: releaseSha,
        ARIA_PROTECTED_RELEASE_CONTEXT: scenario.protectedContext === false
          ? ""
          : `aria-protected-release-v1:123456789:1:${releaseSha}`,
        FLY_API_TOKEN: "contract-token",
        FLY_PG_PASSWORD: scenario.weakDbPassword ? "too-short" : contractPgPassword,
        FLY_SUPABASE_ADMIN_CURRENT_PASSWORD: contractOwnerCurrentPassword,
        FLY_SUPABASE_ADMIN_TARGET_PASSWORD: scenario.unsafeOwnerPassword
          ? "unsafe'owner/password-value-0123456789"
          : contractOwnerTargetPassword,
        FLY_AUTH_DB_PASSWORD: scenario.duplicateDbPassword ? contractPgPassword : contractAuthPassword,
        FLY_REST_DB_PASSWORD: contractRestPassword,
        FLY_JWT_SECRET: contractJwtSecret,
        FLY_SUPABASE_ANON_KEY: scenario.invalidJwt ? "invalid" : contractAnonKey,
        FLY_SUPABASE_SERVICE_KEY: contractServiceKey,
        FLY_DATA_ENCRYPTION_KEY: scenario.invalidDataEncryptionKey
          ? "not-canonical-base64"
          : contractDataEncryptionKey,
        FLY_DATA_ENCRYPTION_PREVIOUS_KEYS: scenario.invalidPreviousEncryptionKeys
          ? "not-json"
          : scenario.previousEncryptionKeys ?? "",
        FLY_CRON_SECRET: scenario.weakCronSecret ? "abc123" : contractCronSecret,
        FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET: contractFrameworkCapabilitySecret,
        FLY_DEERFLOW_ADAPTER_TOKEN: contractDeerFlowAdapterToken,
        FLY_FLOWISE_ADAPTER_TOKEN: contractFlowiseAdapterToken,
        ...contractFrameworkEnvironment,
        ARIA_RECOVERY_RECEIPT_SHA256: createHash("sha256")
          .update(readFileSync(recoveryReceiptPath))
          .digest("hex"),
        ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL: scenario.ringRetirementApproval
          ? `aria-data-key-ring-retirement-v1:${releaseSha}:${createHash("sha256").update(readFileSync(recoveryReceiptPath)).digest("hex")}`
          : "",
        ARIA_FIRST_DEPLOY_APPROVAL: scenario.firstDeployApproval
          ? `aria-first-deploy-v1:${releaseSha}:${createHash("sha256").update(readFileSync(recoveryReceiptPath)).digest("hex")}`
          : "",
        ARIA_APP_IMAGE_REF:
          scenario.appImageRef ??
          `registry.fly.io/aria-mantu-app:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
        ARIA_DB_IMAGE_REF:
          scenario.dbImageRef ??
          `registry.fly.io/aria-mantu-db:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
        ARIA_BOOTSTRAP_IMAGE_REF:
          scenario.bootstrapImageRef ??
          `registry.fly.io/aria-mantu-bootstrap:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
        ARIA_KONG_IMAGE_REF:
          scenario.kongImageRef ??
          `registry.fly.io/aria-mantu-kong:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
        ARIA_DEPLOYMENT_RECEIPT_PATH: receiptPath,
        ARIA_PREDEPLOY_RECEIPT_PATH: predeployReceiptPath,
        ARIA_VOLUME_RECOVERY_RECEIPT_PATH: recoveryReceiptPath,
        ARIA_VOLUME_RESTORE_CREATE_REQUEST_PATH: recoveryRestoreRequestPath,
        ARIA_VOLUME_RESTORE_CREATE_RESPONSE_PATH: recoveryRestoreResponsePath,
        ARIA_VOLUME_RECOVERY_VOLUMES_PATH: recoveryVolumesPath,
        ARIA_VOLUME_RECOVERY_SNAPSHOTS_PATH: recoverySnapshotsPath,
        ARIA_VOLUME_RECOVERY_RESTORE_VOLUMES_PATH: recoveryRestoreVolumesPath,
        ARIA_VOLUME_RECOVERY_SOURCE_MACHINES_PATH: recoverySourceMachinesPath,
        ARIA_VOLUME_RECOVERY_RESTORE_MACHINES_PATH: recoveryRestoreMachinesPath,
        ARIA_VOLUME_RECOVERY_SOURCE_IPS_PATH: recoverySourceIpsPath,
        ARIA_VOLUME_RECOVERY_RESTORE_IPS_PATH: recoveryRestoreIpsPath,
      },
    });

    if (result.error) throw result.error;
    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      flyCommands: readFileSync(flyLog, "utf8"),
      temporaryFiles: readdirSync(temp),
      receipt: existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null,
      predeployReceipt: existsSync(predeployReceiptPath)
        ? JSON.parse(readFileSync(predeployReceiptPath, "utf8"))
        : null,
      recoveryReceiptSha256: createHash("sha256").update(readFileSync(recoveryReceiptPath)).digest("hex"),
      stagedSecrets: readFakeSecrets(flyStagedSecretState),
      stagedSecretDeletions: readFakeSecretKeys(flyStagedSecretDeletionState),
      ambiguousStagedSecrets: readFakeSecretKeys(flyAmbiguousSecretState),
      activeSecrets: readFakeSecrets(flyActiveSecretState),
      secretRestarts: readFileSync(flySecretRestartLog, "utf8").split("\n").filter(Boolean),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

ok("deploy uses strict shell mode", /^set -euo pipefail$/m.test(deploySource));
ok("temporary probe output has an EXIT cleanup trap", /trap cleanup EXIT/.test(deploySource));
ok("required retry calls are not swallowed", !/\b(?:rs|rd)\b[^\n]*\|\|\s*true/.test(deploySource));
ok("acceptance never updates or starts machines", !/fly machine (?:update|start)\b/.test(deploySource));

const unprotectedInvocation = runDeploy({ protectedContext: false });
ok("production mutator rejects a non-protected invocation", unprotectedInvocation.status !== 0);
ok("unprotected invocation reaches no Fly command", unprotectedInvocation.flyCommands.length === 0);

const invalidRecoveryReceipt = runDeploy({ invalidRecoveryReceipt: true });
ok("mismatched recovery evidence fails before deployment", invalidRecoveryReceipt.status !== 0);
ok("mismatched recovery evidence never reaches Fly", invalidRecoveryReceipt.flyCommands.length === 0);

const missingRollbackEvidence = runDeploy({ previousImagesUnavailable: true });
ok("missing prior image digests fail without first-deploy approval", missingRollbackEvidence.status !== 0);
ok(
  "missing prior image digests cannot reach a Fly deploy",
  !missingRollbackEvidence.flyCommands.includes("deploy --config"),
);

const approvedFirstDeploy = runDeploy({ previousImagesUnavailable: true, firstDeployApproval: true });
ok("exact release-and-recovery-bound first-deploy approval permits missing prior images", approvedFirstDeploy.status === 0);
ok(
  "first-deploy mode is explicit in predeploy and acceptance receipts",
  approvedFirstDeploy.predeployReceipt?.deploymentMode === "owner-approved-first-deploy" &&
    approvedFirstDeploy.receipt?.deploymentMode === "owner-approved-first-deploy",
);

const staleFirstDeployApproval = runDeploy({ firstDeployApproval: true });
ok("first-deploy approval is rejected once prior image digests exist", staleFirstDeployApproval.status !== 0);

const restFailure = runDeploy({ rest: "503" });
ok("REST HTTP 503 fails the deploy", restFailure.status !== 0);
ok("REST failure cannot report a pending deployment", !restFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));
ok("failure cleanup removes temporary probe output", restFailure.temporaryFiles.length === 0);

const kongFailure = runDeploy({ kong: "503" });
ok("Kong HTTP 503 fails the deploy", kongFailure.status !== 0);
ok("Kong failure cannot report a pending deployment", !kongFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));

const authFailure = runDeploy({ auth: "503" });
ok("Auth HTTP 503 fails the deploy", authFailure.status !== 0);
ok("Auth failure cannot report a pending deployment", !authFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));

const appFailure = runDeploy({ app: "503" });
ok("final app HTTP 503 fails the deploy", appFailure.status !== 0);
ok("final app failure cannot report a pending deployment", !appFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));

const readinessFailure = runDeploy({ ready: "503" });
ok("final readiness HTTP 503 fails the deploy", readinessFailure.status !== 0);
ok("readiness failure cannot report a pending deployment", !readinessFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));

const cleanupFailure = runDeploy({ cleanupStatus: "degraded" });
ok("degraded cleanup startup evidence fails the deploy", cleanupFailure.status !== 0);
ok(
  "cleanup failure cannot report a pending deployment",
  !cleanupFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"),
);

const heartbeatFailure = runDeploy({ heartbeatStatus: "degraded" });
ok("degraded framework heartbeat evidence fails the deploy", heartbeatFailure.status !== 0);
ok(
  "framework heartbeat failure cannot report a pending deployment",
  !heartbeatFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"),
);

const flyFailure = runDeploy({ failFlyMatch: "deploy --config fly.auth.toml" });
ok("required Fly deploy failure propagates", flyFailure.status !== 0);
ok("Fly command failure cannot report a pending deployment", !flyFailure.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));
ok("ambiguous activation failure never writes a successful release receipt", flyFailure.receipt === null);
ok(
  "ambiguous activation preserves only the predeploy evidence and reports fail-closed recovery",
  flyFailure.predeployReceipt?.releaseSha === releaseSha && flyFailure.output.includes("FAIL-CLOSED"),
);
ok(
  "ambiguous activation is treated as potentially active rather than staged rollback",
  flyFailure.activeSecrets.some(({ app }) => app === "aria-mantu-auth") &&
    !flyFailure.flyCommands.includes("secrets unset --stage --app aria-mantu-auth"),
);

const secretFailure = runDeploy({ failFlyMatch: "secrets import --app aria-mantu-db" });
ok("required secret staging failure propagates", secretFailure.status !== 0);
ok(
  "ambiguous first import failure never stages a destructive cleanup",
  !secretFailure.flyCommands.includes("secrets unset --stage --app aria-mantu-db"),
);
ok("early staging cleanup never restarts the running database", secretFailure.secretRestarts.length === 0);
ok(
  "ambiguous import leaves provider-visible staged values for operator reconciliation",
  secretFailure.stagedSecrets.some(({ app }) => app === "aria-mantu-db") &&
    !secretFailure.stagedSecretDeletions.some(({ app }) => app === "aria-mantu-db") &&
    secretFailure.ambiguousStagedSecrets.some(({ app }) => app === "aria-mantu-db"),
);

const authSecretFailure = runDeploy({ failFlyMatch: "secrets import --app aria-mantu-auth" });
ok(
  "later ambiguous Auth staging failure remains visible for fail-closed reconciliation",
  authSecretFailure.stagedSecrets.some(({ app }) => app === "aria-mantu-auth") &&
    !authSecretFailure.stagedSecretDeletions.some(({ app }) => app === "aria-mantu-auth"),
);
ok(
  "later staging failure does not treat an activated database as staged",
  !authSecretFailure.flyCommands.includes("secrets unset --stage --app aria-mantu-db"),
);

const appSecretFailure = runDeploy({ failFlyMatch: "secrets import --app aria-mantu-app" });
ok(
  "app staging failure preserves ambiguous staged state without staging deletion",
  !appSecretFailure.flyCommands.includes("secrets unset --stage --app aria-mantu-app") &&
    appSecretFailure.stagedSecrets.some(({ app }) => app === "aria-mantu-app") &&
    !appSecretFailure.stagedSecretDeletions.some(({ app }) => app === "aria-mantu-app"),
);
ok(
  "cleanup never claims to roll back already activated services",
  ["aria-mantu-db", "aria-mantu-auth", "aria-mantu-rest", "aria-mantu-kong"].every(
    (app) => !appSecretFailure.flyCommands.includes(`secrets unset --stage --app ${app}`),
  ),
);

const persistentFlyState = mkdtempSync(join(tmpdir(), "aria-deploy-contract-state-"));
try {
  const firstRun = runDeploy({
    failFlyMatch: "secrets import --app aria-mantu-app",
    flyStateDir: persistentFlyState,
    tavilyApiKey: "stale-optional-secret",
  });
  ok(
    "failed run leaves an explicit ambiguous staged-secret condition",
    firstRun.stagedSecrets.some(
      ({ app, name }) => app === "aria-mantu-app" && name === "TAVILY_API_KEY",
    ) &&
      !firstRun.stagedSecretDeletions.some(
        ({ app, name }) => app === "aria-mantu-app" && name === "TAVILY_API_KEY",
      ),
  );
  const laterRun = runDeploy({ flyStateDir: persistentFlyState });
  ok(
    "a later deploy is blocked before mutation while ambiguous staged secrets remain",
    laterRun.status !== 0 && !/(?:secrets import|secrets unset|deploy --config|machine run)/.test(laterRun.flyCommands),
  );
} finally {
  rmSync(persistentFlyState, { recursive: true, force: true });
}

const persistentSuccessfulFlyState = mkdtempSync(join(tmpdir(), "aria-deploy-contract-success-state-"));
try {
  const withTavily = runDeploy({
    flyStateDir: persistentSuccessfulFlyState,
    tavilyApiKey: "contract-tavily-secret",
  });
  ok(
    "a successful release activates the explicitly configured optional TAVILY secret",
    withTavily.status === 0 &&
      withTavily.activeSecrets.some(
        ({ app, name, value }) =>
          app === "aria-mantu-app" && name === "TAVILY_API_KEY" && value === "contract-tavily-secret",
      ),
  );
  const withoutTavily = runDeploy({ flyStateDir: persistentSuccessfulFlyState });
  ok("a later release without TAVILY remains deployable", withoutTavily.status === 0);
  ok(
    "the later release explicitly stages removal of the no-longer-declared TAVILY secret",
    withoutTavily.flyCommands.includes("secrets unset --stage --app aria-mantu-app TAVILY_API_KEY"),
  );
  ok(
    "the later release inventory proves TAVILY is no longer deployed",
    !withoutTavily.activeSecrets.some(
      ({ app, name }) => app === "aria-mantu-app" && name === "TAVILY_API_KEY",
    ),
  );
} finally {
  rmSync(persistentSuccessfulFlyState, { recursive: true, force: true });
}

const persistentEncryptionRingState = mkdtempSync(join(tmpdir(), "aria-deploy-contract-key-ring-state-"));
try {
  const withPreviousKeys = runDeploy({
    flyStateDir: persistentEncryptionRingState,
    previousEncryptionKeys: contractPreviousEncryptionKeys,
  });
  ok(
    "a successful release activates the explicit previous encryption-key ring",
    withPreviousKeys.status === 0 &&
      withPreviousKeys.activeSecrets.some(
        ({ app, name }) => app === "aria-mantu-app" && name === "DATA_ENCRYPTION_PREVIOUS_KEYS",
      ),
  );
  const accidentalOmission = runDeploy({ flyStateDir: persistentEncryptionRingState });
  ok("omitting an active previous-key ring fails closed", accidentalOmission.status !== 0);
  ok(
    "an unapproved key-ring omission fails before production mutation",
    !/(?:secrets import|secrets unset|deploy --config|machine run)/.test(accidentalOmission.flyCommands),
  );
  ok(
    "an unapproved omission leaves the deployed key ring active",
    accidentalOmission.activeSecrets.some(
      ({ app, name }) => app === "aria-mantu-app" && name === "DATA_ENCRYPTION_PREVIOUS_KEYS",
    ),
  );
  const approvedRetirement = runDeploy({
    flyStateDir: persistentEncryptionRingState,
    ringRetirementApproval: true,
  });
  ok("exact release-bound key-ring retirement approval permits the deploy", approvedRetirement.status === 0);
  ok(
    "approved key-ring retirement is staged with the app activation and verified absent",
    approvedRetirement.flyCommands.includes(
      "secrets unset --stage --app aria-mantu-app DATA_ENCRYPTION_PREVIOUS_KEYS",
    ) &&
      !approvedRetirement.activeSecrets.some(
        ({ app, name }) => app === "aria-mantu-app" && name === "DATA_ENCRYPTION_PREVIOUS_KEYS",
      ),
  );
} finally {
  rmSync(persistentEncryptionRingState, { recursive: true, force: true });
}

const staleRingRetirementApproval = runDeploy({ ringRetirementApproval: true });
ok("stale key-ring retirement approval is rejected", staleRingRetirementApproval.status !== 0);
ok(
  "stale key-ring retirement approval never reaches Fly mutation",
  !/(?:secrets import|secrets unset|deploy --config|machine run)/.test(staleRingRetirementApproval.flyCommands),
);

const invalidDataEncryptionKey = runDeploy({ invalidDataEncryptionKey: true });
ok("non-canonical DATA_ENCRYPTION_KEY material fails before deployment", invalidDataEncryptionKey.status !== 0);
ok("invalid DATA_ENCRYPTION_KEY material never reaches Fly", invalidDataEncryptionKey.flyCommands.length === 0);

const invalidPreviousEncryptionKeys = runDeploy({ invalidPreviousEncryptionKeys: true });
ok("malformed previous encryption-key ring fails before deployment", invalidPreviousEncryptionKeys.status !== 0);
ok("malformed previous encryption-key ring never reaches Fly", invalidPreviousEncryptionKeys.flyCommands.length === 0);

const weakCronSecret = runDeploy({ weakCronSecret: true });
ok("weak CRON_SECRET material fails before deployment", weakCronSecret.status !== 0);
ok("weak CRON_SECRET material never reaches Fly", weakCronSecret.flyCommands.length === 0);

for (const [description, inventoryStatus] of [
  ["unknown", "Unknown"],
  ["missing", "missing"],
  ["invalid", "Corrupt"],
] as const) {
  const invalidInventory = runDeploy({ inventoryStatus });
  ok(`${description} Fly secret status blocks deployment`, invalidInventory.status !== 0);
  ok(
    `${description} Fly secret status blocks before any mutation`,
    !/(?:secrets import|secrets unset|deploy --config|machine run)/.test(invalidInventory.flyCommands),
  );
}

const unexpectedSecret = runDeploy({ unexpectedSecret: true });
ok("an unexpected deployed secret blocks deployment", unexpectedSecret.status !== 0);
ok(
  "unexpected secret inventory blocks before any mutation",
  !/(?:secrets import|secrets unset|deploy --config|machine run)/.test(unexpectedSecret.flyCommands),
);

const partialPostDeployInventory = runDeploy({ postDeployInventoryStatus: "Partial" });
ok("post-deploy Partial secret status fails the release", partialPostDeployInventory.status !== 0);
ok(
  "post-deploy non-Deployed secret inventory cannot report pending acceptance",
  !partialPostDeployInventory.output.includes("DEPLOYED_PENDING_ACCEPTANCE"),
);

const lateSecretDrift = runDeploy({ lateSecretDrift: true });
ok("late secret drift after component activation fails the release", lateSecretDrift.status !== 0);
ok(
  "late secret drift cannot produce a pending deployment receipt",
  !lateSecretDrift.output.includes("DEPLOYED_PENDING_ACCEPTANCE") && lateSecretDrift.receipt === null,
);

const invalidJwt = runDeploy({ invalidJwt: true });
ok("inconsistent Supabase JWT material fails before deployment", invalidJwt.status !== 0);
ok("inconsistent JWT material never reports a pending deployment", !invalidJwt.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));

const weakDbPassword = runDeploy({ weakDbPassword: true });
ok("weak target database credentials fail before deployment", weakDbPassword.status !== 0);
ok("weak database credentials never reach Fly", weakDbPassword.flyCommands.length === 0);

const duplicateDbPassword = runDeploy({ duplicateDbPassword: true });
ok("reused target database credentials fail before deployment", duplicateDbPassword.status !== 0);
ok("reused database credentials never reach Fly", duplicateDbPassword.flyCommands.length === 0);

const unsafeOwnerPassword = runDeploy({ unsafeOwnerPassword: true });
ok("SQL-unsafe first-boot owner credentials fail before deployment", unsafeOwnerPassword.status !== 0);
ok("unsafe owner credentials never reach Fly", unsafeOwnerPassword.flyCommands.length === 0);

const invalidAppImage = runDeploy({ appImageRef: "registry.fly.io/aria-mantu-app:latest" });
ok("non-digest app image promotion is rejected before deployment", invalidAppImage.status !== 0);
ok("invalid app image never reports a pending deployment", !invalidAppImage.output.includes("DEPLOYED_PENDING_ACCEPTANCE"));

for (const [component, scenario] of [
  ["database", { dbImageRef: "registry.fly.io/aria-mantu-db:latest" }],
  ["bootstrap", { bootstrapImageRef: "registry.fly.io/aria-mantu-bootstrap:latest" }],
  ["Kong", { kongImageRef: "registry.fly.io/aria-mantu-kong:latest" }],
] as const) {
  const invalid = runDeploy(scenario);
  ok(`non-digest ${component} image promotion is rejected before deployment`, invalid.status !== 0);
  ok(`invalid ${component} image never reaches Fly`, invalid.flyCommands.length === 0);
}

const ipListFailure = runDeploy({ failFlyMatch: "ips list --app aria-mantu-kong" });
ok("required IP inventory failure propagates", ipListFailure.status !== 0);

const ownerReconciliationFailure = runDeploy({ failFlyMatch: "ARIA_BOOTSTRAP_PHASE=owner" });
ok("required owner reconciliation failure propagates", ownerReconciliationFailure.status !== 0);

const migrationFailure = runDeploy({ failFlyMatch: "ARIA_BOOTSTRAP_PHASE=migrations" });
ok("required migration runner failure propagates", migrationFailure.status !== 0);

const completeLedgerRecovery = runDeploy({ recoveryMigrationState: "complete-ledger" });
ok("complete-ledger recovery succeeds without legacy adoption", completeLedgerRecovery.status === 0);
ok(
  "complete-ledger recovery never invokes legacy baselining",
  !completeLedgerRecovery.flyCommands.includes("ARIA_BOOTSTRAP_PHASE=legacy-baseline"),
);

const preLedgerRecovery = runDeploy({ recoveryMigrationState: "verified-pre-ledger" });
ok("verified pre-ledger recovery succeeds with approved adoption", preLedgerRecovery.status === 0);
ok(
  "verified pre-ledger recovery invokes exactly one digest-approved baseline",
  (preLedgerRecovery.flyCommands.match(/ARIA_BOOTSTRAP_PHASE=legacy-baseline/g) ?? []).length === 1 &&
    preLedgerRecovery.flyCommands.includes(`ARIA_LEGACY_BASELINE_APPROVAL_SHA256=${"f".repeat(64)}`),
);

const success = runDeploy();
if (success.status !== 0) console.error("Successful deploy scenario failed:\n", success.output);
ok("HTTP 200 dependencies and successful Fly commands pass", success.status === 0);
ok(
  "technical deployment remains pending until the workflow's authenticated acceptance",
  success.output.includes(`DEPLOYED_PENDING_ACCEPTANCE sha=${releaseSha}`) &&
    !success.output.includes("RELEASE_ACCEPTED"),
);
ok("success cleanup removes temporary probe output", success.temporaryFiles.length === 0);
ok("success receipt records the exact release SHA", success.receipt?.releaseSha === releaseSha);
ok(
  "success receipts bind the approved recovery proof",
  success.receipt?.recovery?.migrationState === "verified-empty" &&
    success.receipt?.recovery?.preflightSha256 === "f".repeat(64) &&
    success.predeployReceipt?.recovery?.receiptSha256 === success.recoveryReceiptSha256,
);
ok(
  "recovery preflights target the exact receipt-bound machines",
  success.flyCommands.includes(`DB_HOST=fedcba98765432.vm.aria-mantu-db-recovery-${releaseSha.slice(0, 12)}.internal`) &&
    success.flyCommands.includes("DB_HOST=0123456789abcd.vm.aria-mantu-db.internal"),
);
ok("predeploy receipt captures rollback state before mutation", success.predeployReceipt?.releaseSha === releaseSha && success.predeployReceipt?.previousImages?.database === `sha256:${"0".repeat(64)}`);
ok("success receipt records the approved bootstrap digest", success.receipt?.images?.bootstrap === `sha256:${"0".repeat(64)}`);
ok("success receipt records the exact promoted app digest", success.receipt?.images?.app === `sha256:${"0".repeat(64)}`);
ok(
  "success receipt records previous running digests for rollback",
  success.receipt?.previousImages?.database === `sha256:${"0".repeat(64)}` &&
    success.receipt?.previousImages?.app === `sha256:${"0".repeat(64)}`,
);
const importCommandLines = success.flyCommands
  .split("\n")
  .filter((line) => line.startsWith("secrets import "));
ok(
  "Fly secret values travel over stdin rather than process arguments",
  importCommandLines.length >= 6 && importCommandLines.every((line) => !line.includes("=")),
);
ok(
  "valid app cryptographic material uses canonical 32-byte base64 and 64-character lowercase hex",
  Buffer.from(contractDataEncryptionKey, "base64").length === 32 &&
    Buffer.from(contractDataEncryptionKey, "base64").toString("base64") === contractDataEncryptionKey &&
    /^[0-9a-f]{64}$/.test(contractCronSecret) &&
    success.flyCommands.includes(`stdin:DATA_ENCRYPTION_KEY=${contractDataEncryptionKey}`) &&
    success.flyCommands.includes(`stdin:CRON_SECRET=${contractCronSecret}`),
);
ok(
  "temporary database and bootstrap credentials are removed and verified absent",
  success.flyCommands.includes("secrets unset --app aria-mantu-db POSTGRES_PASSWORD") &&
    success.flyCommands.includes("secrets unset --stage --app aria-mantu-bootstrap SUPABASE_ADMIN_CURRENT_PASSWORD") &&
    success.flyCommands.includes("secrets unset --stage --app aria-mantu-bootstrap POSTGRES_TARGET_PASSWORD") &&
    (success.flyCommands.match(/secrets list --app aria-mantu-bootstrap --json/g) ?? []).length >= 2,
);
ok(
  "app deployment consumes the exact promoted image",
  success.flyCommands.includes(
    `deploy --config fly.app.toml --image registry.fly.io/aria-mantu-app:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
  ),
);
ok(
  "database and Kong deployments consume exact promoted images",
  success.flyCommands.includes(
    `deploy --config fly.db.toml --image registry.fly.io/aria-mantu-db:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
  ) &&
    success.flyCommands.includes(
      `deploy --config fly.kong.toml --image registry.fly.io/aria-mantu-kong:sha-${releaseSha}@sha256:${"0".repeat(64)}`,
    ),
);
ok(
  "owner and migration phases run the exact promoted bootstrap image",
  (success.flyCommands.match(new RegExp(`machine run registry\\.fly\\.io/aria-mantu-bootstrap:sha-${releaseSha}@sha256:${"0".repeat(64)}`, "g")) ?? []).length === 4,
);
const ownerRun = success.flyCommands.indexOf("ARIA_BOOTSTRAP_PHASE=owner");
const recoveryRuns = [...success.flyCommands.matchAll(/ARIA_BOOTSTRAP_PHASE=recovery-preflight/g)].map(
  ({ index }) => index ?? -1,
);
const authDeploy = success.flyCommands.indexOf("deploy --config fly.auth.toml");
const restDeploy = success.flyCommands.indexOf("deploy --config fly.rest.toml");
const migrationRun = success.flyCommands.indexOf("ARIA_BOOTSTRAP_PHASE=migrations");
const dbStage = success.flyCommands.indexOf("secrets import --app aria-mantu-db --stage");
const dbDeploy = success.flyCommands.indexOf("deploy --config fly.db.toml");
const bootstrapStages = [...success.flyCommands.matchAll(/secrets import --app aria-mantu-bootstrap --stage/g)].map(
  ({ index }) => index ?? -1,
);
const authStage = success.flyCommands.indexOf("secrets import --app aria-mantu-auth --stage");
const restStage = success.flyCommands.indexOf("secrets import --app aria-mantu-rest --stage");
const kongStage = success.flyCommands.indexOf("secrets import --app aria-mantu-kong --stage");
const kongDeploy = success.flyCommands.indexOf("deploy --config fly.kong.toml");
const appStage = success.flyCommands.indexOf("secrets import --app aria-mantu-app --stage");
const appDeploy = success.flyCommands.indexOf("deploy --config fly.app.toml");
ok(
  "each component stages secrets just in time before its own activation",
  bootstrapStages.length === 4 &&
    recoveryRuns.length === 2 &&
    bootstrapStages[0] < recoveryRuns[0] &&
    recoveryRuns[0] < dbStage &&
    dbStage >= 0 &&
    dbStage < dbDeploy &&
    dbDeploy < bootstrapStages[1] &&
    bootstrapStages[1] < recoveryRuns[1] &&
    recoveryRuns[1] < bootstrapStages[2] &&
    bootstrapStages[2] < ownerRun &&
    ownerRun < authStage &&
    authStage < authDeploy &&
    authDeploy < restStage &&
    restStage < restDeploy &&
    restDeploy < bootstrapStages[3] &&
    bootstrapStages[3] < migrationRun &&
    migrationRun < kongStage &&
    kongStage < kongDeploy &&
    kongDeploy < appStage &&
    appStage < appDeploy,
);
ok(
  "credential reconciliation is isolated before runtime activation",
  recoveryRuns.length === 2 && recoveryRuns[1] < ownerRun && ownerRun < authDeploy && ownerRun < restDeploy,
);
ok(
  "Auth and REST target credentials activate before application migrations",
  authDeploy < migrationRun && restDeploy < migrationRun,
);
ok(
  "runtime database passwords are percent-encoded inside connection URIs",
  success.flyCommands.includes(`${encodeURIComponent(contractAuthPassword)}@aria-mantu-db.internal`) &&
    success.flyCommands.includes(`${encodeURIComponent(contractRestPassword)}@aria-mantu-db.internal`),
);
ok(
  "bootstrap receives current and target credentials without password-bearing URLs",
  success.flyCommands.includes(`SUPABASE_ADMIN_CURRENT_PASSWORD=${contractOwnerCurrentPassword}`) &&
    success.flyCommands.includes(`SUPABASE_ADMIN_TARGET_PASSWORD=${contractOwnerTargetPassword}`) &&
    success.flyCommands.includes(`POSTGRES_TARGET_PASSWORD=${contractPgPassword}`) &&
    !success.flyCommands.includes("SUPABASE_ADMIN_DB_URL=") &&
    !success.flyCommands.includes("ADMIN_DB_URL=") &&
    !success.flyCommands.includes("POSTGRES_CURRENT_PASSWORD="),
);
ok(
  "Auth and REST receive different least-privilege database credentials",
  success.flyCommands.includes(
    `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${encodeURIComponent(contractAuthPassword)}@aria-mantu-db.internal`,
  ) &&
    success.flyCommands.includes(
      `PGRST_DB_URI=postgres://authenticator:${encodeURIComponent(contractRestPassword)}@aria-mantu-db.internal`,
    ),
);
ok(
  "database first boot uses the owner password and stages distinct role targets",
  success.flyCommands.includes(`POSTGRES_PASSWORD=${contractOwnerTargetPassword}`) &&
    success.flyCommands.includes(`POSTGRES_TARGET_PASSWORD=${contractPgPassword}`) &&
    success.flyCommands.includes(`SUPABASE_AUTH_ADMIN_TARGET_PASSWORD=${contractAuthPassword}`) &&
    success.flyCommands.includes(`AUTHENTICATOR_TARGET_PASSWORD=${contractRestPassword}`) &&
    success.flyCommands.includes(
      `ARIA_DB_LAYOUT_MIGRATION_APPROVAL=aria-db-root-to-child-v1:${releaseSha}:`,
    ) &&
    !success.flyCommands.includes("INTERNAL_TARGET_PASSWORD"),
);
ok(
  "successful acceptance performs no machine mutation",
  !/(?:^|\n)machine (?:update|start)\b/.test(success.flyCommands),
);

ok("production first-admin provisioning is executable source", firstAdminSource.length > 0);
ok(
  "first-admin provisioning validates tenant authority before creating a user",
  /ARIA_ALLOWED_EMAIL_DOMAIN/.test(firstAdminSource) &&
    /ADMIN_EMAIL/.test(firstAdminSource) &&
    /email domain/i.test(firstAdminSource),
);
ok(
  "first-admin provisioning proves the complete auth and application-role path",
  /auth\/v1\/admin\/users/.test(firstAdminSource) &&
    /auth\/v1\/token\?grant_type=password/.test(firstAdminSource) &&
    /rest\/v1\/rpc\/ensure_workspace/.test(firstAdminSource) &&
    /rest\/v1\/rpc\/current_profile_role/.test(firstAdminSource) &&
    /ROLE[^\n]*admin/.test(firstAdminSource),
);
ok(
  "first-admin provisioning proves the exact workspace and allowed-domain binding",
  /WORKSPACE_ID/.test(firstAdminSource) &&
    /rest\/v1\/workspaces\?id=eq\.\$WORKSPACE_ID&select=id,allowed_domain/.test(firstAdminSource) &&
    /allowed_domain/.test(firstAdminSource) &&
    /ARIA_ALLOWED_EMAIL_DOMAIN/.test(firstAdminSource),
);
ok(
  "first-admin provisioning binds a confirmed signed-in email identity to its exact profile",
  /LOGIN_RESPONSE/.test(firstAdminSource) &&
    /email_confirmed_at/.test(firstAdminSource) &&
    /last_sign_in_at/.test(firstAdminSource) &&
    /providers\.has\("email"\)/.test(firstAdminSource) &&
    /rest\/v1\/profiles\?id=eq\.\$USER_ID&select=id,workspace_id,role/.test(firstAdminSource),
);
ok(
  "first-admin provisioning keeps credentials in owner-only temporary files",
  /umask 077/.test(firstAdminSource) &&
    /mktemp -d/.test(firstAdminSource) &&
    /trap ['"]/.test(firstAdminSource) &&
    /--config/.test(firstAdminSource) &&
    !/set -x/.test(firstAdminSource),
);
ok(
  "administrator passwords never enter child-process arguments",
  !/jq[^\n]*--arg\s+(?:password|p)\s+"\$ADMIN_PASSWORD"/.test(firstAdminSource) &&
    !/jq[^\n]*--arg\s+(?:password|p)\s+"\$ADMIN_PASSWORD"/.test(deployedE2eSource) &&
    !/--data-binary\s+"\$\([^\n]*ADMIN_PASSWORD/.test(deployedE2eSource),
);
ok(
  "first-admin RPCs use the anon API key and the user access token as separate authorities",
  /write_curl_config\(\)[\s\S]{0,220}local apikey=[\s\S]{0,120}local bearer=/.test(firstAdminSource) &&
    /rest\/v1\/rpc\/ensure_workspace[\s\S]{0,180}"\$ANON_KEY"[\s\S]{0,80}"\$ACCESS_TOKEN"/.test(firstAdminSource) &&
    /rest\/v1\/rpc\/current_profile_role[\s\S]{0,180}"\$ANON_KEY"[\s\S]{0,80}"\$ACCESS_TOKEN"/.test(firstAdminSource),
);
ok(
  "first-admin provisioning has valid Bash syntax",
  firstAdminSource.length > 0 && spawnSync("bash", ["-n", firstAdminPath]).status === 0,
);
ok(
  "deployed no-send acceptance queries both durable outbound stores",
  /rest\/v1\/outreach_ledger/.test(deployedE2eSource) &&
    /rest\/v1\/messages_outbound/.test(deployedE2eSource),
);
ok(
  "deployed no-send acceptance fails unless both durable stores remain empty",
  /NO_SEND_LEDGER_COUNT/.test(deployedE2eSource) &&
    /NO_SEND_OUTBOX_COUNT/.test(deployedE2eSource) &&
    /-eq 0/.test(deployedE2eSource),
);
ok(
  "deployed acceptance does not print the administrator email",
  !/info\s+"Admin:\s*\$ADMIN_EMAIL/.test(deployedE2eSource),
);
ok(
  "deployed acceptance stops unless the authenticated profile is admin",
  /ROLE[^\n]*admin[\s\S]{0,300}die\s+"Authenticated profile is not an admin/.test(deployedE2eSource),
);

console.log(`RESULT deploy-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
