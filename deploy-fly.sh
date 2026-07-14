#!/bin/bash
# deploy-fly.sh — finish the Aria Mantu Fly deploy end-to-end. Idempotent + fast-timeout
# hardened against Fly's flaky API. Apps + volume already exist; this stages secrets,
# deploys the Supabase stack + exact prebuilt app image, applies migrations, and
# runs technical readiness checks. Authenticated application acceptance is a
# separate protected-workflow gate. This script mutates production and accepts
# credentials only from the protected exact-SHA release workflow.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
export FLY_NO_METRICS=1 DO_NOT_TRACK=1

die(){ echo "ERROR: $*" >&2; exit 1; }
command -v flyctl >/dev/null 2>&1 || die "flyctl is required"
fly(){ command flyctl "$@"; }
ARIA_RELEASE_SHA="${ARIA_RELEASE_SHA:-}"
ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL="${ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL:-}"
[[ "$ARIA_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "ARIA_RELEASE_SHA must be an exact lowercase 40-character Git SHA"
[ "${GITHUB_ACTIONS:-}" = true ] || die "production mutation is restricted to GitHub Actions"
[ "${GITHUB_REF_PROTECTED:-}" = true ] || die "production mutation requires a protected Git ref"
[[ "${GITHUB_WORKFLOW_REF:-}" == */.github/workflows/deploy-aria-mantu.yml@refs/heads/deploy/fly-github-actions ]] \
  || die "production mutation requires the canonical protected workflow ref"
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || die "GITHUB_RUN_ID is invalid"
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || die "GITHUB_RUN_ATTEMPT is invalid"
EXPECTED_RELEASE_CONTEXT="aria-protected-release-v1:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${ARIA_RELEASE_SHA}"
[ "${ARIA_PROTECTED_RELEASE_CONTEXT:-}" = "$EXPECTED_RELEASE_CONTEXT" ] \
  || die "protected release context does not match this workflow run and release SHA"
[ -n "${FLY_API_TOKEN:-}" ] || die "FLY_API_TOKEN must be injected by the protected workflow"

# The protected workflow materializes provider state with a separate read-only
# credential. Revalidate the same expiring, release-bound receipt here before
# loading deploy secrets or issuing any Fly mutation.
RECOVERY_RECEIPT_PATH="${ARIA_VOLUME_RECOVERY_RECEIPT_PATH:-}"
RECOVERY_RESTORE_REQUEST_PATH="${ARIA_VOLUME_RESTORE_CREATE_REQUEST_PATH:-}"
RECOVERY_RESTORE_RESPONSE_PATH="${ARIA_VOLUME_RESTORE_CREATE_RESPONSE_PATH:-}"
RECOVERY_VOLUMES_PATH="${ARIA_VOLUME_RECOVERY_VOLUMES_PATH:-}"
RECOVERY_SNAPSHOTS_PATH="${ARIA_VOLUME_RECOVERY_SNAPSHOTS_PATH:-}"
RECOVERY_RESTORE_VOLUMES_PATH="${ARIA_VOLUME_RECOVERY_RESTORE_VOLUMES_PATH:-}"
RECOVERY_SOURCE_MACHINES_PATH="${ARIA_VOLUME_RECOVERY_SOURCE_MACHINES_PATH:-}"
RECOVERY_RESTORE_MACHINES_PATH="${ARIA_VOLUME_RECOVERY_RESTORE_MACHINES_PATH:-}"
RECOVERY_SOURCE_IPS_PATH="${ARIA_VOLUME_RECOVERY_SOURCE_IPS_PATH:-}"
RECOVERY_RESTORE_IPS_PATH="${ARIA_VOLUME_RECOVERY_RESTORE_IPS_PATH:-}"
for variable in \
  RECOVERY_RECEIPT_PATH \
  RECOVERY_RESTORE_REQUEST_PATH \
  RECOVERY_RESTORE_RESPONSE_PATH \
  RECOVERY_VOLUMES_PATH \
  RECOVERY_SNAPSHOTS_PATH \
  RECOVERY_RESTORE_VOLUMES_PATH \
  RECOVERY_SOURCE_MACHINES_PATH \
  RECOVERY_RESTORE_MACHINES_PATH \
  RECOVERY_SOURCE_IPS_PATH \
  RECOVERY_RESTORE_IPS_PATH
do
  [ -n "${!variable}" ] || die "protected recovery evidence path is unset: $variable"
done
node scripts/validate-volume-recovery-receipt.mjs \
  "$RECOVERY_RECEIPT_PATH" \
  "$RECOVERY_VOLUMES_PATH" \
  "$RECOVERY_SNAPSHOTS_PATH" \
  "$RECOVERY_RESTORE_VOLUMES_PATH" \
  "$RECOVERY_SOURCE_IPS_PATH" \
  "$RECOVERY_RESTORE_IPS_PATH" \
  "$RECOVERY_RESTORE_REQUEST_PATH" \
  "$RECOVERY_RESTORE_RESPONSE_PATH" \
  "$RECOVERY_SOURCE_MACHINES_PATH" \
  "$RECOVERY_RESTORE_MACHINES_PATH" \
  "$ARIA_RELEASE_SHA"
IFS=$'\t' read -r \
  RECOVERY_MIGRATION_STATE \
  RECOVERY_SCHEMA_SHA256 \
  RECOVERY_ROW_FINGERPRINT_SHA256 \
  RECOVERY_MIGRATION_MANIFEST_SHA256 \
  RECOVERY_PREFLIGHT_SHA256 \
  RECOVERY_LEGACY_BASELINE_APPROVAL_SHA256 \
  RECOVERY_RESTORE_APP \
  RECOVERY_RESTORE_MACHINE_ID \
  RECOVERY_SOURCE_VOLUME_ID \
  RECOVERY_SOURCE_MACHINE_ID \
  RECOVERY_SNAPSHOT_ID \
  RECOVERY_RESTORE_VOLUME_ID < <(node -e '
    const fs = require("node:fs");
    const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write([
      receipt.restoreDrill.migrationState,
      receipt.restoreDrill.schemaFingerprintSha256,
      receipt.restoreDrill.rowFingerprintSha256,
      receipt.restoreDrill.migrationManifestSha256,
      receipt.restoreDrill.recoveryPreflightSha256,
      receipt.restoreDrill.legacyBaselineApprovalSha256 ?? "none",
      receipt.restoreDrill.targetApp,
      receipt.restoreDrill.targetMachineId,
      receipt.production.volumeId,
      receipt.production.machineId,
      receipt.recoveryPoint.snapshotId,
      receipt.restoreDrill.targetVolumeId,
    ].join("\t") + "\n");
  ' "$RECOVERY_RECEIPT_PATH")
RECOVERY_RECEIPT_SHA256="$(node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$RECOVERY_RECEIPT_PATH")"
[ "$RECOVERY_RECEIPT_SHA256" = "${ARIA_RECOVERY_RECEIPT_SHA256:-}" ] \
  || die "recovery receipt digest does not match the protected dispatch input"
ARIA_DB_LAYOUT_MIGRATION_APPROVAL="aria-db-root-to-child-v1:$ARIA_RELEASE_SHA:$RECOVERY_RECEIPT_SHA256"
export \
  RECOVERY_MIGRATION_STATE \
  RECOVERY_SCHEMA_SHA256 \
  RECOVERY_ROW_FINGERPRINT_SHA256 \
  RECOVERY_MIGRATION_MANIFEST_SHA256 \
  RECOVERY_PREFLIGHT_SHA256 \
  RECOVERY_LEGACY_BASELINE_APPROVAL_SHA256 \
  RECOVERY_RESTORE_APP \
  RECOVERY_RESTORE_MACHINE_ID \
  RECOVERY_SOURCE_VOLUME_ID \
  RECOVERY_SOURCE_MACHINE_ID \
  RECOVERY_SNAPSHOT_ID \
  RECOVERY_RESTORE_VOLUME_ID \
  RECOVERY_RECEIPT_SHA256 \
  ARIA_DB_LAYOUT_MIGRATION_APPROVAL
RECOVERY_RESTORE_HOST="${RECOVERY_RESTORE_MACHINE_ID}.vm.${RECOVERY_RESTORE_APP}.internal"
RECOVERY_SOURCE_HOST="${RECOVERY_SOURCE_MACHINE_ID}.vm.aria-mantu-db.internal"
export RECOVERY_RESTORE_HOST RECOVERY_SOURCE_HOST

required_secrets=(FLY_PG_PASSWORD FLY_SUPABASE_ADMIN_TARGET_PASSWORD FLY_AUTH_DB_PASSWORD FLY_REST_DB_PASSWORD FLY_JWT_SECRET FLY_SUPABASE_ANON_KEY FLY_SUPABASE_SERVICE_KEY FLY_DATA_ENCRYPTION_KEY FLY_CRON_SECRET FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET FLY_DEERFLOW_ADAPTER_TOKEN FLY_FLOWISE_ADAPTER_TOKEN)
for key in "${required_secrets[@]}"; do [ -n "${!key:-}" ] || die "required deployment secret is unset: $key"; done
FLY_SUPABASE_ADMIN_CURRENT_PASSWORD="${FLY_SUPABASE_ADMIN_CURRENT_PASSWORD:-$FLY_SUPABASE_ADMIN_TARGET_PASSWORD}"
FLY_DATA_ENCRYPTION_PREVIOUS_KEYS="${FLY_DATA_ENCRYPTION_PREVIOUS_KEYS:-}"
export FLY_PG_PASSWORD FLY_SUPABASE_ADMIN_TARGET_PASSWORD FLY_AUTH_DB_PASSWORD FLY_REST_DB_PASSWORD FLY_JWT_SECRET FLY_DATA_ENCRYPTION_KEY FLY_DATA_ENCRYPTION_PREVIOUS_KEYS FLY_CRON_SECRET FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET FLY_DEERFLOW_ADAPTER_TOKEN FLY_FLOWISE_ADAPTER_TOKEN
node <<'NODE'
const targets = [
  ["FLY_PG_PASSWORD", process.env.FLY_PG_PASSWORD],
  ["FLY_SUPABASE_ADMIN_TARGET_PASSWORD", process.env.FLY_SUPABASE_ADMIN_TARGET_PASSWORD],
  ["FLY_AUTH_DB_PASSWORD", process.env.FLY_AUTH_DB_PASSWORD],
  ["FLY_REST_DB_PASSWORD", process.env.FLY_REST_DB_PASSWORD],
];
if (!/^[A-Za-z0-9_-]{43,128}$/.test(process.env.FLY_JWT_SECRET ?? "")) {
  throw new Error("FLY_JWT_SECRET must be 43-128 base64url characters");
}
const encryptionKeyRaw = process.env.FLY_DATA_ENCRYPTION_KEY ?? "";
const encryptionKey = Buffer.from(encryptionKeyRaw, "base64");
if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== encryptionKeyRaw) {
  throw new Error("FLY_DATA_ENCRYPTION_KEY must be canonical base64 encoding of exactly 32 bytes");
}
const previousKeysRaw = process.env.FLY_DATA_ENCRYPTION_PREVIOUS_KEYS ?? "";
if (previousKeysRaw) {
  let previousKeys;
  try { previousKeys = JSON.parse(previousKeysRaw); } catch { throw new Error("FLY_DATA_ENCRYPTION_PREVIOUS_KEYS must be valid JSON"); }
  if (!Array.isArray(previousKeys) || previousKeys.length < 1 || previousKeys.length > 8) {
    throw new Error("FLY_DATA_ENCRYPTION_PREVIOUS_KEYS must be an array of one to eight keys");
  }
  const seen = new Set([encryptionKeyRaw]);
  for (const value of previousKeys) {
    if (typeof value !== "string" || seen.has(value)) {
      throw new Error("FLY_DATA_ENCRYPTION_PREVIOUS_KEYS contains a duplicate or invalid key");
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== value) {
      throw new Error("FLY_DATA_ENCRYPTION_PREVIOUS_KEYS entries must be canonical base64 32-byte keys");
    }
    seen.add(value);
  }
}
if (!/^[0-9a-f]{64}$/.test(process.env.FLY_CRON_SECRET ?? "")) {
  throw new Error("FLY_CRON_SECRET must be 64 lowercase hexadecimal characters");
}
const frameworkAuthorities = [
  ["FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET", process.env.FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET],
  ["FLY_DEERFLOW_ADAPTER_TOKEN", process.env.FLY_DEERFLOW_ADAPTER_TOKEN],
  ["FLY_FLOWISE_ADAPTER_TOKEN", process.env.FLY_FLOWISE_ADAPTER_TOKEN],
];
for (const [name, value] of frameworkAuthorities) {
  if (typeof value !== "string" || value.length < 32 || value.length > 4_096 || /\s/.test(value)) {
    throw new Error(`${name} must be 32-4096 non-whitespace characters`);
  }
}
const independentAuthorities = [
  ...frameworkAuthorities.map(([, value]) => value),
  process.env.FLY_JWT_SECRET,
  process.env.FLY_DATA_ENCRYPTION_KEY,
  process.env.FLY_CRON_SECRET,
];
if (new Set(independentAuthorities).size !== independentAuthorities.length) {
  throw new Error("framework and application authorities must be independent");
}
for (const [name, value] of targets) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value ?? "")) {
    throw new Error(`${name} must be 43-128 base64url characters`);
  }
  if (value === process.env.FLY_JWT_SECRET) {
    throw new Error(`${name} must differ from FLY_JWT_SECRET`);
  }
}
for (let left = 0; left < targets.length; left++) {
  for (let right = left + 1; right < targets.length; right++) {
    if (targets[left][1] === targets[right][1]) {
      throw new Error(`${targets[left][0]} and ${targets[right][0]} must be distinct`);
    }
  }
}
NODE
uri_encode(){ printf '%s' "$1" | node -e 'let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(encodeURIComponent(input)));'; }
AUTH_DB_PASSWORD_URI="$(uri_encode "$FLY_AUTH_DB_PASSWORD")"
REST_DB_PASSWORD_URI="$(uri_encode "$FLY_REST_DB_PASSWORD")"
export FLY_JWT_SECRET FLY_SUPABASE_ANON_KEY FLY_SUPABASE_SERVICE_KEY
node -e '
  const crypto = require("node:crypto");
  const secret = process.env.FLY_JWT_SECRET;
  function verify(name, token, role) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error(`${name} is not a JWT`);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (header.alg !== "HS256" || payload.role !== role) throw new Error(`${name} has the wrong algorithm or role`);
    const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error(`${name} does not match FLY_JWT_SECRET`);
  }
  verify("FLY_SUPABASE_ANON_KEY", process.env.FLY_SUPABASE_ANON_KEY, "anon");
  verify("FLY_SUPABASE_SERVICE_KEY", process.env.FLY_SUPABASE_SERVICE_KEY, "service_role");
'

TAVILY_API_KEY="${TAVILY_API_KEY:-}"
GITHUB_SOURCE_TOKEN="${GITHUB_SOURCE_TOKEN:-}"
KIMI_API_KEY="${KIMI_API_KEY:-}"
KIMI_BASE_URL="${KIMI_BASE_URL:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

FRAMEWORK_ENV_NAMES=(
  AGENT_FRAMEWORKS_REQUIRED
  AGENT_FRAMEWORK_EXECUTION_ENABLED
  AGENT_FRAMEWORK_KILL_SWITCH
  AGENT_FRAMEWORK_CONFIGURATION_SHA256
  AGENT_FRAMEWORK_READINESS_WORKSPACE_ID
  FRAMEWORK_ADAPTER_IMAGE_DIGEST
  REDIS_IMAGE_DIGEST
  DEERFLOW_ADAPTER_URL
  DEERFLOW_SOURCE_COMMIT
  DEERFLOW_IMAGE_DIGEST
  DEERFLOW_DATABASE_IMAGE_DIGEST
  DEERFLOW_FRAMEWORK_INSTANCE_ID
  DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST
  DEERFLOW_CLOUD_PROVIDER_ID
  DEERFLOW_MODEL_PROVIDER
  DEERFLOW_MODEL_ID
  DEERFLOW_MODEL_BASE_URL
  DEERFLOW_MODEL_CREDENTIAL_VERSION
  FLOWISE_ADAPTER_URL
  FLOWISE_SOURCE_COMMIT
  FLOWISE_IMAGE_DIGEST
  FLOWISE_WORKER_IMAGE_DIGEST
  FLOWISE_DATABASE_IMAGE_DIGEST
  FLOWISE_FRAMEWORK_INSTANCE_ID
  FLOWISE_WORKSPACE_ID
  FLOWISE_READINESS_WORKFLOW_ID
  FLOWISE_TENANT_ISOLATION
  FLOWISE_QUEUE_NAME
)
for key in "${FRAMEWORK_ENV_NAMES[@]}"; do
  [ -n "${!key:-}" ] || die "required framework deployment identity is unset: $key"
done
[ "$AGENT_FRAMEWORKS_REQUIRED" = true ] || die "production framework readiness must remain required"
[[ "$AGENT_FRAMEWORK_EXECUTION_ENABLED" =~ ^(true|false)$ ]] || die "AGENT_FRAMEWORK_EXECUTION_ENABLED must be boolean"
[[ "$AGENT_FRAMEWORK_KILL_SWITCH" =~ ^(true|false)$ ]] || die "AGENT_FRAMEWORK_KILL_SWITCH must be boolean"
DERIVED_FRAMEWORK_CONFIGURATION_SHA256="$(node scripts/agent-framework-configuration.mjs --sha-only)" \
  || die "canonical framework configuration is invalid"
[ "$AGENT_FRAMEWORK_CONFIGURATION_SHA256" = "$DERIVED_FRAMEWORK_CONFIGURATION_SHA256" ] \
  || die "configured framework SHA-256 does not match the canonical manifest"
declare -a FRAMEWORK_DEPLOY_ENV_ARGS=()
for key in "${FRAMEWORK_ENV_NAMES[@]}"; do
  FRAMEWORK_DEPLOY_ENV_ARGS+=(--env "$key=${!key}")
done

read_pinned_runtime_image(){
  local config="$1" expected_repository="$2"
  node -e '
    const fs = require("node:fs");
    const source = fs.readFileSync(process.argv[1], "utf8");
    const expectedRepository = process.argv[2];
    const matches = [...source.matchAll(/^\s*image\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
    if (matches.length !== 1) process.exit(1);
    const escaped = expectedRepository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^${escaped}:[^@\\s]+@sha256:[0-9a-f]{64}$`).test(matches[0])) process.exit(1);
    process.stdout.write(matches[0]);
  ' "$config" "$expected_repository"
}
AUTH_UPSTREAM_IMAGE_REF="$(read_pinned_runtime_image fly.auth.toml supabase/gotrue)" \
  || die "fly.auth.toml must contain one digest-pinned supabase/gotrue image"
REST_UPSTREAM_IMAGE_REF="$(read_pinned_runtime_image fly.rest.toml postgrest/postgrest)" \
  || die "fly.rest.toml must contain one digest-pinned postgrest/postgrest image"
AUTH_EXPECTED_DIGEST="${AUTH_UPSTREAM_IMAGE_REF##*@}"
REST_EXPECTED_DIGEST="${REST_UPSTREAM_IMAGE_REF##*@}"

for component in APP DB BOOTSTRAP KONG; do
  variable="ARIA_${component}_IMAGE_REF"
  value="${!variable:-}"
  case "$component" in
    APP) app_name="aria-mantu-app" ;;
    DB) app_name="aria-mantu-db" ;;
    BOOTSTRAP) app_name="aria-mantu-bootstrap" ;;
    KONG) app_name="aria-mantu-kong" ;;
    *) die "unsupported release image component: $component" ;;
  esac
  [[ "$value" =~ ^registry\.fly\.io/${app_name}:sha-${ARIA_RELEASE_SHA}@sha256:[0-9a-f]{64}$ ]] \
    || die "$variable must be the scanned exact-SHA Fly registry digest"
done
APP_EXPECTED_DIGEST="${ARIA_APP_IMAGE_REF##*@}"
DB_EXPECTED_DIGEST="${ARIA_DB_IMAGE_REF##*@}"
BOOTSTRAP_EXPECTED_DIGEST="${ARIA_BOOTSTRAP_IMAGE_REF##*@}"
KONG_EXPECTED_DIGEST="${ARIA_KONG_IMAGE_REF##*@}"
ACTUAL_SHA="$(git rev-parse HEAD)"
[ "$ACTUAL_SHA" = "$ARIA_RELEASE_SHA" ] || die "checked-out SHA does not match ARIA_RELEASE_SHA"
[ -z "$(git status --porcelain --untracked-files=all)" ] || die "working tree must be clean before production deploy"

IFS=$'\t' read -r EXPECTED_MIGRATION_FILE EXPECTED_MIGRATION_SHA EXPECTED_MIGRATION_COUNT EXPECTED_LEDGER_SHA < <(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const dir = process.argv[1];
  const files = fs.readdirSync(dir).filter((name) => /^0[0-9]{3}_.+\.sql$/.test(name)).sort();
  if (files.length === 0) process.exit(2);
  const entries = files.map((filename) => ({
    filename,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, filename))).digest("hex"),
  }));
  const latest = entries.at(-1);
  const ledgerSha = crypto.createHash("sha256").update(entries.map((entry) => `${entry.filename}:${entry.sha256}\n`).join("")).digest("hex");
  process.stdout.write(`${[latest.filename, latest.sha256, entries.length, ledgerSha].join("\t")}\n`);
' supabase/migrations)
[ -n "$EXPECTED_LEDGER_SHA" ] || die "no numbered migration files found"
RELEASE_TAG="sha-$ARIA_RELEASE_SHA"

SM_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/aria-fly-smoke.XXXXXX")"
ORIGINAL_DOCKER_CONFIG="${DOCKER_CONFIG:-${HOME}/.docker}"
DOCKER_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aria-docker-config.XXXXXX")"
if [ -d "$ORIGINAL_DOCKER_CONFIG/cli-plugins" ]; then
  ln -s "$ORIGINAL_DOCKER_CONFIG/cli-plugins" "$DOCKER_CONFIG_DIR/cli-plugins"
fi
export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"
DB_SECRET_STATE=clean
AUTH_SECRET_STATE=clean
REST_SECRET_STATE=clean
KONG_SECRET_STATE=clean
BOOTSTRAP_SECRET_STATE=clean
APP_SECRET_STATE=clean
declare -a DB_STAGED_SECRET_NAMES=()
declare -a AUTH_STAGED_SECRET_NAMES=()
declare -a REST_STAGED_SECRET_NAMES=()
declare -a KONG_STAGED_SECRET_NAMES=()
declare -a BOOTSTRAP_STAGED_SECRET_NAMES=()
declare -a APP_STAGED_SECRET_NAMES=()
cleanup(){
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    cleanup_unactivated_staged_secrets_best_effort
  fi
  rm -f -- "$SM_OUTPUT"
  rm -rf -- "$DOCKER_CONFIG_DIR"
  return "$rc"
}
trap cleanup EXIT

log(){ echo; echo "=== [$(date +%H:%M:%S)] $* ==="; }
fast(){
  local t="$1" p w rc
  shift
  # Background jobs in a non-interactive shell otherwise inherit /dev/null.
  # Preserve the caller's stdin explicitly for commands such as `secrets import`.
  exec 9<&0
  "$@" <&9 & p=$!
  exec 9<&-
  ( sleep "$t"; kill -KILL "$p" 2>/dev/null ) & w=$!
  if wait "$p" 2>/dev/null; then rc=0; else rc=$?; fi
  kill -KILL "$w" 2>/dev/null || :
  wait "$w" 2>/dev/null || :
  return "$rc"
}
# small idempotent calls: cap each attempt, cycle fast, show progress
rs(){
  local n="$1" cap="$2" d="$3" i=1 rc=1
  shift 3
  while [ "$i" -le "$n" ]; do
    echo "   -> $d (try $i/$n)"
    if fast "$cap" "$@"; then
      echo "   OK $d"
      return 0
    else
      rc=$?
    fi
    i=$((i+1))
    [ "$i" -gt "$n" ] || sleep 3
  done
  echo "   [GAVEUP] $d"
  return "$rc"
}
# Fly's `secrets import` reads values from stdin, keeping credentials out of
# process argv and retry diagnostics. Re-create stdin on every bounded retry.
stage_secrets(){
  local app="$1" d="$2" i=1 rc=1 entry key value
  shift 2
  local -a entries=("$@")
  local -a names=()
  for entry in "${entries[@]}"; do
    key="${entry%%=*}"
    value="${entry#*=}"
    [ "$key" != "$entry" ] || die "invalid secret import entry for $app"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid secret name for $app: $key"
    case "$value" in *$'\n'*|*$'\r'*) die "secret value contains a forbidden line break: $key" ;; esac
    names+=("$key")
  done
  remember_component_secret_names "$app" "${names[@]}"
  set_component_secret_state "$app" staging
  while [ "$i" -le 5 ]; do
    echo "   -> $d (try $i/5)"
    if printf '%s\n' "${entries[@]}" | fast 45 fly secrets import --app "$app" --stage; then
      set_component_secret_state "$app" staged
      echo "   OK $d"
      return 0
    else
      rc=$?
    fi
    i=$((i+1))
    [ "$i" -gt 5 ] || sleep 3
  done
  echo "   [GAVEUP] $d"
  return "$rc"
}
secret_names_absent(){
  local app="$1" inventory
  shift
  inventory="$(fly secrets list --app "$app" --json)"
  node -e '
    const forbidden = new Set(process.argv.slice(1));
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let rows;
      try { rows = JSON.parse(raw); } catch { process.exit(2); }
      if (!Array.isArray(rows)) process.exit(3);
      if (forbidden.size === 0 && rows.length > 0) {
        const names = rows.map((row) => String(row.Name ?? row.name ?? "")).filter(Boolean);
        process.stderr.write(`unexpected secrets remain on ${process.env.ARIA_SECRET_APP ?? "Fly app"}: ${names.join(", ")}\n`);
        process.exit(1);
      }
      const present = rows
        .map((row) => String(row.Name ?? row.name ?? ""))
        .filter((name) => forbidden.has(name));
      if (present.length > 0) {
        process.stderr.write(`temporary secrets remain on ${process.env.ARIA_SECRET_APP ?? "Fly app"}: ${present.join(", ")}\n`);
        process.exit(1);
      }
    });
  ' "$@" <<< "$inventory"
}
validate_secret_inventory(){
  local app="$1" mode="$2" inventory
  shift 2
  inventory="$(fly secrets list --app "$app" --json)" || return
  node -e '
    const app = process.argv[1];
    const mode = process.argv[2];
    const allowed = new Set(process.argv.slice(3));
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let rows;
      try { rows = JSON.parse(raw); } catch { process.exit(2); }
      if (!Array.isArray(rows)) process.exit(3);
      const names = new Set();
      for (const row of rows) {
        const name = row?.name;
        if (
          typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name) ||
          names.has(name) || !allowed.has(name) ||
          typeof row?.digest !== "string" || !/^[0-9a-f]{32,128}$/.test(row.digest) ||
          row?.status !== "Deployed"
        ) {
          process.stderr.write(`unmanaged, ambiguous, or non-deployed secret inventory on ${app}\n`);
          process.exit(1);
        }
        names.add(name);
      }
      if (mode === "exact") {
        if (names.size !== allowed.size || [...allowed].some((name) => !names.has(name))) {
          process.stderr.write(`deployed secret set does not match the release contract on ${app}\n`);
          process.exit(1);
        }
      } else if (mode !== "allow") {
        process.exit(4);
      }
    });
  ' "$app" "$mode" "$@" <<< "$inventory"
}

secret_name_present(){
  local app="$1" expected_name="$2" inventory
  inventory="$(fly secrets list --app "$app" --json)" || return 2
  node -e '
    const expected = process.argv[1];
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let rows;
      try { rows = JSON.parse(raw); } catch { process.exit(2); }
      if (!Array.isArray(rows)) process.exit(2);
      const matches = rows.filter((row) => row?.name === expected);
      if (matches.length > 1) process.exit(2);
      process.exit(matches.length === 1 ? 0 : 1);
    });
  ' "$expected_name" <<< "$inventory"
}

stage_optional_secret_removals(){
  local app="$1" inventory names name
  local -a present=()
  shift
  [ "$#" -gt 0 ] || return 0
  inventory="$(fly secrets list --app "$app" --json)" || return
  names="$(node -e '
    const candidates = new Set(process.argv.slice(1));
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let rows;
      try { rows = JSON.parse(raw); } catch { process.exit(2); }
      if (!Array.isArray(rows)) process.exit(3);
      const present = rows
        .map((row) => row?.name)
        .filter((name) => typeof name === "string" && candidates.has(name));
      process.stdout.write([...new Set(present)].sort().join("\n"));
    });
  ' "$@" <<< "$inventory")" || return
  while IFS= read -r name; do
    [ -n "$name" ] && present+=("$name")
  done <<< "$names"
  [ "${#present[@]}" -gt 0 ] || return 0
  remember_component_secret_names "$app" "${present[@]}"
  set_component_secret_state "$app" staging
  if rd "stage retired optional app secrets" \
    fly secrets unset --stage --app "$app" "${present[@]}"; then
    set_component_secret_state "$app" staged
    return 0
  fi
  return 1
}

DB_INIT_SECRET_NAMES=(
  POSTGRES_PASSWORD
  SUPABASE_ADMIN_TARGET_PASSWORD
  POSTGRES_TARGET_PASSWORD
  SUPABASE_AUTH_ADMIN_TARGET_PASSWORD
  AUTHENTICATOR_TARGET_PASSWORD
  JWT_SECRET
  ARIA_DB_LAYOUT_MIGRATION_APPROVAL
)
BOOTSTRAP_OWNER_SECRET_NAMES=(
  SUPABASE_ADMIN_CURRENT_PASSWORD
  SUPABASE_ADMIN_TARGET_PASSWORD
  SUPABASE_AUTH_ADMIN_TARGET_PASSWORD
  AUTHENTICATOR_TARGET_PASSWORD
  JWT_SECRET
)
BOOTSTRAP_ALLOWED_SECRET_NAMES=("${BOOTSTRAP_OWNER_SECRET_NAMES[@]}" POSTGRES_TARGET_PASSWORD)
AUTH_SECRET_NAMES=(GOTRUE_JWT_SECRET GOTRUE_DB_DATABASE_URL)
REST_SECRET_NAMES=(PGRST_JWT_SECRET PGRST_APP_SETTINGS_JWT_SECRET PGRST_DB_URI)
KONG_SECRET_NAMES=(SUPABASE_ANON_KEY SUPABASE_SERVICE_KEY)
APP_REQUIRED_SECRET_NAMES=(SUPABASE_SERVICE_ROLE_KEY DATA_ENCRYPTION_KEY CRON_SECRET AGENT_FRAMEWORK_CAPABILITY_SECRET DEERFLOW_ADAPTER_TOKEN FLOWISE_ADAPTER_TOKEN)
APP_OPTIONAL_SECRET_NAMES=(DATA_ENCRYPTION_PREVIOUS_KEYS TAVILY_API_KEY KIMI_API_KEY KIMI_BASE_URL ANTHROPIC_API_KEY GITHUB_TOKEN)
APP_ALLOWED_SECRET_NAMES=("${APP_REQUIRED_SECRET_NAMES[@]}" "${APP_OPTIONAL_SECRET_NAMES[@]}")
set_component_secret_state(){
  local app="$1" state="$2"
  case "$app" in
    aria-mantu-db) DB_SECRET_STATE="$state" ;;
    aria-mantu-auth) AUTH_SECRET_STATE="$state" ;;
    aria-mantu-rest) REST_SECRET_STATE="$state" ;;
    aria-mantu-kong) KONG_SECRET_STATE="$state" ;;
    aria-mantu-bootstrap) BOOTSTRAP_SECRET_STATE="$state" ;;
    aria-mantu-app) APP_SECRET_STATE="$state" ;;
    *) die "unsupported Fly secret state app: $app" ;;
  esac
}
component_secret_state(){
  case "$1" in
    aria-mantu-db) printf '%s\n' "$DB_SECRET_STATE" ;;
    aria-mantu-auth) printf '%s\n' "$AUTH_SECRET_STATE" ;;
    aria-mantu-rest) printf '%s\n' "$REST_SECRET_STATE" ;;
    aria-mantu-kong) printf '%s\n' "$KONG_SECRET_STATE" ;;
    aria-mantu-bootstrap) printf '%s\n' "$BOOTSTRAP_SECRET_STATE" ;;
    aria-mantu-app) printf '%s\n' "$APP_SECRET_STATE" ;;
    *) die "unsupported Fly secret state app: $1" ;;
  esac
}
remember_component_secret_names(){
  local app="$1"
  shift
  case "$app" in
    aria-mantu-db) DB_STAGED_SECRET_NAMES=("$@") ;;
    aria-mantu-auth) AUTH_STAGED_SECRET_NAMES=("$@") ;;
    aria-mantu-rest) REST_STAGED_SECRET_NAMES=("$@") ;;
    aria-mantu-kong) KONG_STAGED_SECRET_NAMES=("$@") ;;
    aria-mantu-bootstrap) BOOTSTRAP_STAGED_SECRET_NAMES=("$@") ;;
    aria-mantu-app) APP_STAGED_SECRET_NAMES=("$@") ;;
    *) die "unsupported Fly secret state app: $app" ;;
  esac
}
mark_component_secrets_retired(){
  local app="$1"
  remember_component_secret_names "$app"
  set_component_secret_state "$app" retired
}
cleanup_unactivated_staged_secrets_best_effort(){
  local app state
  for app in aria-mantu-app aria-mantu-bootstrap aria-mantu-kong aria-mantu-rest aria-mantu-auth aria-mantu-db; do
    state="$(component_secret_state "$app")"
    case "$state" in
      staging|staged)
        echo "FAIL-CLOSED: $app may contain staged secret changes; automatic rollback is forbidden; inspect Fly before any retry" >&2
        ;;
      activating)
        echo "FAIL-CLOSED: $app activation result is ambiguous; automatic secret rollback is forbidden" >&2
        ;;
      activated)
        echo "FAIL-CLOSED: $app secrets are active; automatic secret rollback is forbidden" >&2
        ;;
      clean|retired) ;;
      *) echo "FAIL-CLOSED: unknown secret lifecycle state for $app: $state" >&2 ;;
    esac
  done
}
# Deploys are intentionally single-shot. Killing flyctl and retrying can race a
# remote operation that continued after the local process disappeared.
rd(){
  local d="$1" rc
  shift
  echo "   -> deploy $d"
  if "$@"; then
    echo "   OK deploy $d"
    return 0
  else
    rc=$?
  fi
  echo "   [FAILED] deploy $d rc=$rc"
  return "$rc"
}
activate_component_secrets(){
  local app="$1" description="$2" rc
  shift 2
  set_component_secret_state "$app" activating
  if rd "$description" "$@"; then
    set_component_secret_state "$app" activated
    return 0
  else
    rc=$?
  fi
  echo "FAIL-CLOSED: activation of $app may have completed remotely; inspect live state before retry" >&2
  return "$rc"
}
ensure_fly_ip(){
  local app="$1" family="$2" ips rc
  if ips="$(fly ips list --app "$app" --json)"; then :; else rc=$?; return "$rc"; fi
  if node -e '
    const family = process.argv[1];
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const ips = JSON.parse(raw);
        const found = ips.some((ip) => {
          const type = String(ip.Type ?? ip.type ?? "");
          return family === "v4" ? type === "v4" || type === "shared_v4" : type === "v6";
        });
        process.exit(found ? 0 : 1);
      } catch {
        process.exit(2);
      }
    });
  ' "$family" <<< "$ips"; then
    echo "   $app already has $family"
    return 0
  else
    rc=$?
    [ "$rc" = 1 ] || return "$rc"
  fi
  case "$family" in
    v4) fly ips allocate-v4 --shared --app "$app" ;;
    v6) fly ips allocate-v6 --app "$app" ;;
    *) echo "   invalid IP family: $family" >&2; return 2 ;;
  esac
}
sm(){ curl -sS -m 25 -o "$SM_OUTPUT" -w "%{http_code}" "$@"; }
diagnose_backends(){
  local app output
  log "read-only backend diagnostics"
  for app in aria-mantu-db aria-mantu-auth aria-mantu-rest aria-mantu-kong; do
    echo "----- $app machine state -----"
    if output="$(fast 20 fly machines list --app "$app" 2>&1)"; then
      head -n 8 <<< "$output"
    else
      echo "   diagnostic unavailable"
      head -n 8 <<< "$output"
    fi
  done
}
require_http_200(){
  local attempts="$1" delay="$2" description="$3" i=1 code
  shift 3
  while [ "$i" -le "$attempts" ]; do
    if code="$(sm "$@")"; then :; else code="000"; fi
    echo "  $description -> $code (try $i/$attempts)"
    [ "$code" != "200" ] || return 0
    i=$((i+1))
    [ "$i" -gt "$attempts" ] || sleep "$delay"
  done
  echo "ERROR: $description never returned HTTP 200 (last=$code)" >&2
  diagnose_backends
  return 1
}
app_image_digest(){
  local app="$1" expected_tag="${2:-}" images
  images="$(fly image show --app "$app" --json)"
  node -e '
    const expectedTag = process.argv[1];
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let rows;
      try { rows = JSON.parse(raw); } catch { process.exit(2); }
      if (!Array.isArray(rows) || rows.length === 0) process.exit(3);
      const digests = new Set(rows.map((row) => row.Digest));
      if (digests.size !== 1) process.exit(4);
      const digest = [...digests][0];
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) process.exit(5);
      if (expectedTag && rows.some((row) => row.Tag !== expectedTag)) process.exit(6);
      process.stdout.write(digest);
    });
  ' "$expected_tag" <<< "$images"
}

verify_apollo_cleanup_release(){
  local expected_digest="$1" release_sha="$2" not_before="$3" machines process_receipt machine_ids cleanup_machine heartbeat_machine cleanup_logs heartbeat_logs attempt=1
  machines="$(fly machines list --app aria-mantu-app --json)" || return
  process_receipt="$(node scripts/verify-apollo-cleanup-release.mjs machines "$expected_digest" <<< "$machines")" || return
  machine_ids="$(node -e '
    const receipt = JSON.parse(process.argv[1]);
    if (typeof receipt.cleanupMachineId !== "string" || typeof receipt.frameworkHeartbeatMachineId !== "string") process.exit(1);
    process.stdout.write(`${receipt.cleanupMachineId}\t${receipt.frameworkHeartbeatMachineId}`);
  ' "$process_receipt")" || return
  IFS=$'\t' read -r cleanup_machine heartbeat_machine <<< "$machine_ids"
  while [ "$attempt" -le 6 ]; do
    if cleanup_logs="$(fast 30 fly logs --app aria-mantu-app --machine "$cleanup_machine" --no-tail --json 2>&1)" &&
      node scripts/verify-apollo-cleanup-release.mjs logs "$release_sha" "$not_before" <<< "$cleanup_logs" &&
      heartbeat_logs="$(fast 30 fly logs --app aria-mantu-app --machine "$heartbeat_machine" --no-tail --json 2>&1)" &&
      node scripts/verify-apollo-cleanup-release.mjs heartbeat-logs "$release_sha" "$not_before" <<< "$heartbeat_logs"
    then
      echo "   OK app process topology and healthy cleanup/agent-framework heartbeat events"
      return 0
    fi
    attempt=$((attempt+1))
    [ "$attempt" -gt 6 ] || sleep 10
  done
  echo "ERROR: application background processes did not emit healthy bounded release receipts" >&2
  return 1
}

previous_image_digest(){
  local app="$1" digest
  if digest="$(app_image_digest "$app" 2>/dev/null)"; then
    printf '%s\n' "$digest"
  else
    printf 'unavailable\n'
  fi
}

PREVIOUS_DB_IMAGE_DIGEST="$(previous_image_digest aria-mantu-db)"
PREVIOUS_AUTH_IMAGE_DIGEST="$(previous_image_digest aria-mantu-auth)"
PREVIOUS_REST_IMAGE_DIGEST="$(previous_image_digest aria-mantu-rest)"
PREVIOUS_KONG_IMAGE_DIGEST="$(previous_image_digest aria-mantu-kong)"
PREVIOUS_APP_IMAGE_DIGEST="$(previous_image_digest aria-mantu-app)"

FIRST_DEPLOY_MODE=existing-release
FIRST_DEPLOY_APPROVAL="${ARIA_FIRST_DEPLOY_APPROVAL:-}"
EXPECTED_FIRST_DEPLOY_APPROVAL="aria-first-deploy-v1:$ARIA_RELEASE_SHA:$RECOVERY_RECEIPT_SHA256"
missing_previous_images=0
for previous_digest in \
  "$PREVIOUS_DB_IMAGE_DIGEST" \
  "$PREVIOUS_AUTH_IMAGE_DIGEST" \
  "$PREVIOUS_REST_IMAGE_DIGEST" \
  "$PREVIOUS_KONG_IMAGE_DIGEST" \
  "$PREVIOUS_APP_IMAGE_DIGEST"
do
  [ "$previous_digest" != unavailable ] || missing_previous_images=$((missing_previous_images + 1))
done
if [ "$missing_previous_images" -gt 0 ]; then
  [ "$FIRST_DEPLOY_APPROVAL" = "$EXPECTED_FIRST_DEPLOY_APPROVAL" ] \
    || die "prior image inventory is incomplete and no exact first-deploy approval is installed"
  FIRST_DEPLOY_MODE=owner-approved-first-deploy
elif [ -n "$FIRST_DEPLOY_APPROVAL" ]; then
  die "first-deploy approval must be absent when every prior image digest is available"
fi
unset ARIA_FIRST_DEPLOY_APPROVAL FIRST_DEPLOY_APPROVAL EXPECTED_FIRST_DEPLOY_APPROVAL previous_digest missing_previous_images

PREDEPLOY_RECEIPT_PATH="${ARIA_PREDEPLOY_RECEIPT_PATH:-${TMPDIR:-/tmp}/aria-predeploy-receipt.json}"
export PREDEPLOY_RECEIPT_PATH ARIA_RELEASE_SHA ARIA_APP_IMAGE_REF ARIA_DB_IMAGE_REF ARIA_BOOTSTRAP_IMAGE_REF ARIA_KONG_IMAGE_REF PREVIOUS_DB_IMAGE_DIGEST PREVIOUS_AUTH_IMAGE_DIGEST PREVIOUS_REST_IMAGE_DIGEST PREVIOUS_KONG_IMAGE_DIGEST PREVIOUS_APP_IMAGE_DIGEST FIRST_DEPLOY_MODE
node <<'NODE'
const fs = require("node:fs");
const receipt = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  releaseSha: process.env.ARIA_RELEASE_SHA,
  deploymentMode: process.env.FIRST_DEPLOY_MODE,
  previousImages: {
    database: process.env.PREVIOUS_DB_IMAGE_DIGEST,
    auth: process.env.PREVIOUS_AUTH_IMAGE_DIGEST,
    rest: process.env.PREVIOUS_REST_IMAGE_DIGEST,
    kong: process.env.PREVIOUS_KONG_IMAGE_DIGEST,
    app: process.env.PREVIOUS_APP_IMAGE_DIGEST,
  },
  approvedImages: {
    database: process.env.ARIA_DB_IMAGE_REF,
    bootstrap: process.env.ARIA_BOOTSTRAP_IMAGE_REF,
    kong: process.env.ARIA_KONG_IMAGE_REF,
    app: process.env.ARIA_APP_IMAGE_REF,
  },
  recovery: {
    receiptSha256: process.env.RECOVERY_RECEIPT_SHA256,
    migrationState: process.env.RECOVERY_MIGRATION_STATE,
    preflightSha256: process.env.RECOVERY_PREFLIGHT_SHA256,
  },
};
fs.writeFileSync(process.env.PREDEPLOY_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
NODE

declare -a A=(SUPABASE_SERVICE_ROLE_KEY="$FLY_SUPABASE_SERVICE_KEY" DATA_ENCRYPTION_KEY="$FLY_DATA_ENCRYPTION_KEY" CRON_SECRET="$FLY_CRON_SECRET" AGENT_FRAMEWORK_CAPABILITY_SECRET="$FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET" DEERFLOW_ADAPTER_TOKEN="$FLY_DEERFLOW_ADAPTER_TOKEN" FLOWISE_ADAPTER_TOKEN="$FLY_FLOWISE_ADAPTER_TOKEN")
declare -a APP_DESIRED_SECRET_NAMES=("${APP_REQUIRED_SECRET_NAMES[@]}")
declare -a APP_RETIRED_OPTIONAL_SECRET_NAMES=()
if [ -n "$FLY_DATA_ENCRYPTION_PREVIOUS_KEYS" ]; then
  A+=("DATA_ENCRYPTION_PREVIOUS_KEYS=$FLY_DATA_ENCRYPTION_PREVIOUS_KEYS")
  APP_DESIRED_SECRET_NAMES+=(DATA_ENCRYPTION_PREVIOUS_KEYS)
else
  APP_RETIRED_OPTIONAL_SECRET_NAMES+=(DATA_ENCRYPTION_PREVIOUS_KEYS)
fi
for k in TAVILY_API_KEY KIMI_API_KEY KIMI_BASE_URL ANTHROPIC_API_KEY; do
  v="${!k:-}"
  if [ -n "$v" ]; then
    A+=("$k=$v")
    APP_DESIRED_SECRET_NAMES+=("$k")
    echo "  + $k"
  else
    APP_RETIRED_OPTIONAL_SECRET_NAMES+=("$k")
  fi
done
if [ -n "$GITHUB_SOURCE_TOKEN" ]; then
  A+=("GITHUB_TOKEN=$GITHUB_SOURCE_TOKEN")
  APP_DESIRED_SECRET_NAMES+=(GITHUB_TOKEN)
  echo "  + GITHUB_TOKEN"
else
  APP_RETIRED_OPTIONAL_SECRET_NAMES+=(GITHUB_TOKEN)
fi

validate_secret_inventory aria-mantu-db allow "${DB_INIT_SECRET_NAMES[@]}" \
  || die "database secret inventory is not a clean managed baseline"
validate_secret_inventory aria-mantu-bootstrap allow "${BOOTSTRAP_ALLOWED_SECRET_NAMES[@]}" \
  || die "bootstrap secret inventory is not a clean managed baseline"
validate_secret_inventory aria-mantu-auth allow "${AUTH_SECRET_NAMES[@]}" \
  || die "Auth secret inventory is not a clean managed baseline"
validate_secret_inventory aria-mantu-rest allow "${REST_SECRET_NAMES[@]}" \
  || die "REST secret inventory is not a clean managed baseline"
validate_secret_inventory aria-mantu-kong allow "${KONG_SECRET_NAMES[@]}" \
  || die "Kong secret inventory is not a clean managed baseline"
validate_secret_inventory aria-mantu-app allow "${APP_ALLOWED_SECRET_NAMES[@]}" \
  || die "application secret inventory is not a clean managed baseline"
APP_PREVIOUS_KEY_RING_DEPLOYED=0
if secret_name_present aria-mantu-app DATA_ENCRYPTION_PREVIOUS_KEYS; then
  APP_PREVIOUS_KEY_RING_DEPLOYED=1
else
  secret_presence_status=$?
  [ "$secret_presence_status" -eq 1 ] \
    || die "application previous-key ring presence could not be proven"
fi
EXPECTED_RING_RETIREMENT_APPROVAL="aria-data-key-ring-retirement-v1:$ARIA_RELEASE_SHA:$RECOVERY_RECEIPT_SHA256"
if [ -z "$FLY_DATA_ENCRYPTION_PREVIOUS_KEYS" ] && [ "$APP_PREVIOUS_KEY_RING_DEPLOYED" -eq 1 ]; then
  [ "$ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL" = "$EXPECTED_RING_RETIREMENT_APPROVAL" ] \
    || die "removing the deployed previous encryption-key ring requires exact release-bound owner approval"
else
  [ -z "$ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL" ] \
    || die "stale previous encryption-key ring retirement approval is forbidden"
fi

extract_bootstrap_digest(){
  local label="$1"
  node -e '
    const label = process.argv[1];
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [...input.matchAll(new RegExp(`(?:^|\\n)${escaped}=([0-9a-f]{64})(?=\\r?\\n|$)`, "g"))];
      if (matches.length !== 1) process.exit(1);
      process.stdout.write(matches[0][1]);
    });
  ' "$label"
}

run_receipt_bound_recovery_preflight(){
  local host="$1" description="$2" output actual_preflight actual_baseline
  echo "   -> $description"
  output="$(fly machine run "$ARIA_BOOTSTRAP_IMAGE_REF" --app aria-mantu-bootstrap --region cdg --rm \
    --env ARIA_BOOTSTRAP_PHASE=recovery-preflight \
    --env DB_HOST="$host" \
    --env ARIA_RECOVERY_MIGRATION_STATE="$RECOVERY_MIGRATION_STATE" \
    --env ARIA_LEGACY_APPROVED_SCHEMA_SHA256="$RECOVERY_SCHEMA_SHA256" \
    --env ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256="$RECOVERY_ROW_FINGERPRINT_SHA256" \
    --env ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256="$RECOVERY_MIGRATION_MANIFEST_SHA256")"
  actual_preflight="$(printf '%s\n' "$output" | extract_bootstrap_digest ARIA_RECOVERY_PREFLIGHT_SHA256)" \
    || die "$description did not emit one recovery preflight digest"
  [ "$actual_preflight" = "$RECOVERY_PREFLIGHT_SHA256" ] \
    || die "$description does not match the owner-approved recovery preflight"
  if [ "$RECOVERY_MIGRATION_STATE" = verified-pre-ledger ]; then
    actual_baseline="$(printf '%s\n' "$output" | extract_bootstrap_digest ARIA_LEGACY_BASELINE_APPROVAL_SHA256)" \
      || die "$description did not emit one legacy baseline digest"
    [ "$actual_baseline" = "$RECOVERY_LEGACY_BASELINE_APPROVAL_SHA256" ] \
      || die "$description does not match the owner-approved legacy baseline"
  elif printf '%s\n' "$output" | grep -q 'ARIA_LEGACY_BASELINE_APPROVAL_SHA256='; then
    die "complete-ledger recovery unexpectedly authorized legacy baselining"
  fi
  echo "   OK $description"
}

retire_bootstrap_current_owner_secret(){
  rd "bootstrap current-owner secret retirement" \
    fly secrets unset --stage --app aria-mantu-bootstrap SUPABASE_ADMIN_CURRENT_PASSWORD
  ARIA_SECRET_APP=aria-mantu-bootstrap rs 5 45 "bootstrap current-owner secret absent" \
    secret_names_absent aria-mantu-bootstrap SUPABASE_ADMIN_CURRENT_PASSWORD
  mark_component_secrets_retired aria-mantu-bootstrap
}

log "1/12  prove the disposable snapshot restore before production mutation"
stage_secrets aria-mantu-bootstrap "recovery preflight credential" \
  "SUPABASE_ADMIN_CURRENT_PASSWORD=$FLY_SUPABASE_ADMIN_CURRENT_PASSWORD"
run_receipt_bound_recovery_preflight \
  "$RECOVERY_RESTORE_HOST" "disposable restore recovery preflight"
retire_bootstrap_current_owner_secret

log "2/12  stage and deploy the scanned Postgres image"
stage_secrets aria-mantu-db "db secrets" \
  "POSTGRES_PASSWORD=$FLY_SUPABASE_ADMIN_TARGET_PASSWORD" \
  "SUPABASE_ADMIN_TARGET_PASSWORD=$FLY_SUPABASE_ADMIN_TARGET_PASSWORD" \
  "POSTGRES_TARGET_PASSWORD=$FLY_PG_PASSWORD" \
  "SUPABASE_AUTH_ADMIN_TARGET_PASSWORD=$FLY_AUTH_DB_PASSWORD" \
  "AUTHENTICATOR_TARGET_PASSWORD=$FLY_REST_DB_PASSWORD" \
  "JWT_SECRET=$FLY_JWT_SECRET" \
  "ARIA_DB_LAYOUT_MIGRATION_APPROVAL=$ARIA_DB_LAYOUT_MIGRATION_APPROVAL"
activate_component_secrets aria-mantu-db "db" \
  fly deploy --config fly.db.toml --image "$ARIA_DB_IMAGE_REF" --wait-timeout 10m
validate_secret_inventory aria-mantu-db exact "${DB_INIT_SECRET_NAMES[@]}" \
  || die "database activation did not deploy the exact managed secret set"

log "3/12  re-prove production state and adopt an approved pre-ledger schema"
stage_secrets aria-mantu-bootstrap "production recovery credential" \
  "SUPABASE_ADMIN_CURRENT_PASSWORD=$FLY_SUPABASE_ADMIN_CURRENT_PASSWORD"
run_receipt_bound_recovery_preflight \
  "$RECOVERY_SOURCE_HOST" "production recovery preflight"
if [ "$RECOVERY_MIGRATION_STATE" = verified-pre-ledger ]; then
  fly machine run "$ARIA_BOOTSTRAP_IMAGE_REF" --app aria-mantu-bootstrap --region cdg --rm \
    --env ARIA_BOOTSTRAP_PHASE=legacy-baseline \
    --env DB_HOST=aria-mantu-db.internal \
    --env ARIA_LEGACY_APPROVED_SCHEMA_SHA256="$RECOVERY_SCHEMA_SHA256" \
    --env ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256="$RECOVERY_ROW_FINGERPRINT_SHA256" \
    --env ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256="$RECOVERY_MIGRATION_MANIFEST_SHA256" \
    --env ARIA_LEGACY_BASELINE_APPROVAL_SHA256="$RECOVERY_LEGACY_BASELINE_APPROVAL_SHA256"
fi
retire_bootstrap_current_owner_secret

log "4/12  stage owner credentials and reconcile database authority"
stage_secrets aria-mantu-bootstrap "bootstrap secrets" \
  "SUPABASE_ADMIN_CURRENT_PASSWORD=$FLY_SUPABASE_ADMIN_CURRENT_PASSWORD" \
  "SUPABASE_ADMIN_TARGET_PASSWORD=$FLY_SUPABASE_ADMIN_TARGET_PASSWORD" \
  "POSTGRES_TARGET_PASSWORD=$FLY_PG_PASSWORD" \
  "SUPABASE_AUTH_ADMIN_TARGET_PASSWORD=$FLY_AUTH_DB_PASSWORD" \
  "AUTHENTICATOR_TARGET_PASSWORD=$FLY_REST_DB_PASSWORD" \
  "JWT_SECRET=$FLY_JWT_SECRET"
fly machine run "$ARIA_BOOTSTRAP_IMAGE_REF" --app aria-mantu-bootstrap --region cdg --rm \
  --env ARIA_BOOTSTRAP_PHASE=owner --env DB_HOST=aria-mantu-db.internal --env JWT_EXP=3600

log "5/12  retire first-init and owner-phase credentials"
rd "database init-secret retirement" fly secrets unset --app aria-mantu-db "${DB_INIT_SECRET_NAMES[@]}"
rd "bootstrap owner-secret retirement" fly secrets unset --stage --app aria-mantu-bootstrap \
  "${BOOTSTRAP_OWNER_SECRET_NAMES[@]}" POSTGRES_TARGET_PASSWORD
ARIA_SECRET_APP=aria-mantu-db rs 5 45 "database secret inventory empty" secret_names_absent aria-mantu-db
mark_component_secrets_retired aria-mantu-db
ARIA_SECRET_APP=aria-mantu-bootstrap rs 5 45 "bootstrap secret inventory empty" secret_names_absent aria-mantu-bootstrap
mark_component_secrets_retired aria-mantu-bootstrap

log "6/12  stage and deploy GoTrue + PostgREST with target credentials"
stage_secrets aria-mantu-auth "auth secrets" \
  "GOTRUE_JWT_SECRET=$FLY_JWT_SECRET" \
  "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:$AUTH_DB_PASSWORD_URI@aria-mantu-db.internal:5432/postgres"
activate_component_secrets aria-mantu-auth "auth" \
  fly deploy --config fly.auth.toml --remote-only --wait-timeout 10m
validate_secret_inventory aria-mantu-auth exact "${AUTH_SECRET_NAMES[@]}" \
  || die "Auth activation did not deploy the exact managed secret set"
stage_secrets aria-mantu-rest "rest secrets" \
  "PGRST_JWT_SECRET=$FLY_JWT_SECRET" \
  "PGRST_APP_SETTINGS_JWT_SECRET=$FLY_JWT_SECRET" \
  "PGRST_DB_URI=postgres://authenticator:$REST_DB_PASSWORD_URI@aria-mantu-db.internal:5432/postgres"
activate_component_secrets aria-mantu-rest "rest" \
  fly deploy --config fly.rest.toml --remote-only --wait-timeout 10m
validate_secret_inventory aria-mantu-rest exact "${REST_SECRET_NAMES[@]}" \
  || die "REST activation did not deploy the exact managed secret set"

log "7/12  stage the migrator credential and apply the serialized ledger"
stage_secrets aria-mantu-bootstrap "bootstrap migrator secret" \
  "POSTGRES_TARGET_PASSWORD=$FLY_PG_PASSWORD"
fly machine run "$ARIA_BOOTSTRAP_IMAGE_REF" --app aria-mantu-bootstrap --region cdg --rm \
  --env ARIA_BOOTSTRAP_PHASE=migrations --env DB_HOST=aria-mantu-db.internal

log "8/12  retire the migrator credential"
rd "bootstrap migrator-secret retirement" fly secrets unset --stage --app aria-mantu-bootstrap POSTGRES_TARGET_PASSWORD
ARIA_SECRET_APP=aria-mantu-bootstrap rs 5 45 "bootstrap secret inventory empty" secret_names_absent aria-mantu-bootstrap
mark_component_secrets_retired aria-mantu-bootstrap

log "9/12  stage and deploy the scanned Kong image + public IPs"
stage_secrets aria-mantu-kong "kong secrets" \
  "SUPABASE_ANON_KEY=$FLY_SUPABASE_ANON_KEY" \
  "SUPABASE_SERVICE_KEY=$FLY_SUPABASE_SERVICE_KEY"
activate_component_secrets aria-mantu-kong "kong" \
  fly deploy --config fly.kong.toml --image "$ARIA_KONG_IMAGE_REF" --wait-timeout 10m
validate_secret_inventory aria-mantu-kong exact "${KONG_SECRET_NAMES[@]}" \
  || die "Kong activation did not deploy the exact managed secret set"
rs 3 50 "kong v4" ensure_fly_ip aria-mantu-kong v4
rs 3 50 "kong v6" ensure_fly_ip aria-mantu-kong v6

log "10/12  data-plane smoke (JWT chain proof)"
require_http_200 8 10 "Kong /healthz" https://aria-mantu-kong.fly.dev/healthz
require_http_200 8 10 "REST /rest/v1/" -H "apikey: $FLY_SUPABASE_ANON_KEY" -H "Authorization: Bearer $FLY_SUPABASE_ANON_KEY" https://aria-mantu-kong.fly.dev/rest/v1/
require_http_200 6 10 "Auth /auth/v1/health" -H "apikey: $FLY_SUPABASE_ANON_KEY" https://aria-mantu-kong.fly.dev/auth/v1/health

log "11/12  stage and deploy the app"
validate_secret_inventory aria-mantu-app allow "${APP_ALLOWED_SECRET_NAMES[@]}" \
  || die "application secret inventory changed after the release preflight"
stage_secrets aria-mantu-app "app secrets" "${A[@]}"
stage_optional_secret_removals aria-mantu-app "${APP_RETIRED_OPTIONAL_SECRET_NAMES[@]}"
APOLLO_CLEANUP_NOT_BEFORE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
activate_component_secrets aria-mantu-app "app" \
  fly deploy --config fly.app.toml --image "$ARIA_APP_IMAGE_REF" --wait-timeout 10m --env ARIA_RELEASE_SHA="$ARIA_RELEASE_SHA" --env ARIA_EXPECTED_MIGRATION="$EXPECTED_MIGRATION_FILE" --env ARIA_EXPECTED_MIGRATION_SHA="$EXPECTED_MIGRATION_SHA" --env ARIA_EXPECTED_MIGRATION_COUNT="$EXPECTED_MIGRATION_COUNT" --env ARIA_EXPECTED_LEDGER_SHA="$EXPECTED_LEDGER_SHA" "${FRAMEWORK_DEPLOY_ENV_ARGS[@]}"
validate_secret_inventory aria-mantu-app exact "${APP_DESIRED_SECRET_NAMES[@]}" \
  || die "application activation did not deploy the exact managed secret set"
rs 3 50 "app v4" ensure_fly_ip aria-mantu-app v4
rs 3 50 "app v6" ensure_fly_ip aria-mantu-app v6

require_http_200 10 12 "app /api/health" https://aria-mantu-app.fly.dev/api/health
require_http_200 10 12 "app /api/ready" https://aria-mantu-app.fly.dev/api/ready

log "12/12  bind running images and migration identity into the pending deployment receipt"

DB_IMAGE_DIGEST="$(app_image_digest aria-mantu-db "$RELEASE_TAG")"
AUTH_IMAGE_DIGEST="$(app_image_digest aria-mantu-auth)"
REST_IMAGE_DIGEST="$(app_image_digest aria-mantu-rest)"
KONG_IMAGE_DIGEST="$(app_image_digest aria-mantu-kong "$RELEASE_TAG")"
APP_IMAGE_DIGEST="$(app_image_digest aria-mantu-app)"
[ "$APP_IMAGE_DIGEST" = "$APP_EXPECTED_DIGEST" ] || die "running app image digest does not match the scanned promoted image"
[ "$DB_IMAGE_DIGEST" = "$DB_EXPECTED_DIGEST" ] || die "running database image digest does not match the scanned promoted image"
[ "$KONG_IMAGE_DIGEST" = "$KONG_EXPECTED_DIGEST" ] || die "running Kong image digest does not match the scanned promoted image"
[ "$AUTH_IMAGE_DIGEST" = "$AUTH_EXPECTED_DIGEST" ] || die "running Auth image digest does not match fly.auth.toml"
[ "$REST_IMAGE_DIGEST" = "$REST_EXPECTED_DIGEST" ] || die "running REST image digest does not match fly.rest.toml"
verify_apollo_cleanup_release "$APP_IMAGE_DIGEST" "$ARIA_RELEASE_SHA" "$APOLLO_CLEANUP_NOT_BEFORE" \
  || die "application background process release acceptance failed"

# Re-read the complete secret topology immediately before materializing release
# evidence. This catches late manual or concurrent drift, including dangerous
# staged credentials that would otherwise activate on a future Machine update.
validate_secret_inventory aria-mantu-db exact \
  || die "final database secret inventory is not empty and fully deployed"
validate_secret_inventory aria-mantu-bootstrap exact \
  || die "final bootstrap secret inventory is not empty and fully deployed"
validate_secret_inventory aria-mantu-auth exact "${AUTH_SECRET_NAMES[@]}" \
  || die "final Auth secret inventory drifted after activation"
validate_secret_inventory aria-mantu-rest exact "${REST_SECRET_NAMES[@]}" \
  || die "final REST secret inventory drifted after activation"
validate_secret_inventory aria-mantu-kong exact "${KONG_SECRET_NAMES[@]}" \
  || die "final Kong secret inventory drifted after activation"
validate_secret_inventory aria-mantu-app exact "${APP_DESIRED_SECRET_NAMES[@]}" \
  || die "final application secret inventory drifted after activation"

RECEIPT_PATH="${ARIA_DEPLOYMENT_RECEIPT_PATH:-${TMPDIR:-/tmp}/aria-deployment-receipt.json}"
export RECEIPT_PATH DB_IMAGE_DIGEST AUTH_IMAGE_DIGEST REST_IMAGE_DIGEST KONG_IMAGE_DIGEST APP_IMAGE_DIGEST BOOTSTRAP_EXPECTED_DIGEST PREVIOUS_DB_IMAGE_DIGEST PREVIOUS_AUTH_IMAGE_DIGEST PREVIOUS_REST_IMAGE_DIGEST PREVIOUS_KONG_IMAGE_DIGEST PREVIOUS_APP_IMAGE_DIGEST EXPECTED_MIGRATION_FILE EXPECTED_MIGRATION_SHA EXPECTED_MIGRATION_COUNT EXPECTED_LEDGER_SHA ARIA_RELEASE_SHA FIRST_DEPLOY_MODE
node -e '
  const fs = require("node:fs");
  const receipt = {
    schemaVersion: 2,
    deployedAt: new Date().toISOString(),
    status: "pending-application-acceptance",
    releaseSha: process.env.ARIA_RELEASE_SHA,
    deploymentMode: process.env.FIRST_DEPLOY_MODE,
    migration: {
      filename: process.env.EXPECTED_MIGRATION_FILE,
      sha256: process.env.EXPECTED_MIGRATION_SHA,
      count: Number(process.env.EXPECTED_MIGRATION_COUNT),
      ledgerSha256: process.env.EXPECTED_LEDGER_SHA,
    },
    readiness: "passed",
    recovery: {
      receiptSha256: process.env.RECOVERY_RECEIPT_SHA256,
      migrationState: process.env.RECOVERY_MIGRATION_STATE,
      preflightSha256: process.env.RECOVERY_PREFLIGHT_SHA256,
    },
    previousImages: {
      database: process.env.PREVIOUS_DB_IMAGE_DIGEST,
      auth: process.env.PREVIOUS_AUTH_IMAGE_DIGEST,
      rest: process.env.PREVIOUS_REST_IMAGE_DIGEST,
      kong: process.env.PREVIOUS_KONG_IMAGE_DIGEST,
      app: process.env.PREVIOUS_APP_IMAGE_DIGEST,
    },
    images: {
      database: process.env.DB_IMAGE_DIGEST,
      auth: process.env.AUTH_IMAGE_DIGEST,
      rest: process.env.REST_IMAGE_DIGEST,
      kong: process.env.KONG_IMAGE_DIGEST,
      bootstrap: process.env.BOOTSTRAP_EXPECTED_DIGEST,
      app: process.env.APP_IMAGE_DIGEST,
    },
  };
  fs.writeFileSync(process.env.RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
'
echo "DEPLOYED_PENDING_ACCEPTANCE sha=$ARIA_RELEASE_SHA migration=$EXPECTED_MIGRATION_FILE readiness=passed receipt=$RECEIPT_PATH"
