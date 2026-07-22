#!/usr/bin/env bash
# Recover the single reviewed legacy orphan-owner topology through GoTrue and
# the 0031 service-role-only database authority. This script does not discover
# or promote arbitrary users, profiles, workspaces, or domains.
set -Eeuo pipefail
umask 077

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for command_name in curl jq node; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done

: "${KONG_URL:?set KONG_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"
: "${ANON_KEY:?set ANON_KEY}"
: "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"
: "${ARIA_ALLOWED_EMAIL_DOMAIN:?set ARIA_ALLOWED_EMAIL_DOMAIN}"
: "${ARIA_RECOVERY_WORKSPACE_ID:?set ARIA_RECOVERY_WORKSPACE_ID}"
: "${ARIA_RECOVERY_PROFILE_ID:?set ARIA_RECOVERY_PROFILE_ID}"
: "${ARIA_RECOVERY_EXPECTED_DOMAIN:?set ARIA_RECOVERY_EXPECTED_DOMAIN}"
: "${ARIA_RECOVERY_FULL_NAME:?set ARIA_RECOVERY_FULL_NAME}"
: "${ARIA_RELEASE_SHA:?set ARIA_RELEASE_SHA}"
: "${ARIA_RECOVERY_RECEIPT_SHA256:?set ARIA_RECOVERY_RECEIPT_SHA256}"
: "${ARIA_RECOVERY_REQUEST_ID:?set ARIA_RECOVERY_REQUEST_ID}"
: "${ARIA_RECOVERY_OPERATOR_APPROVAL:?set ARIA_RECOVERY_OPERATOR_APPROVAL}"
: "${ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256:?set ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256}"

validate_header_token() {
  local label="$1" value="$2"
  [ "${#value}" -ge 32 ] && [ "${#value}" -le 4096 ] || \
    fail "$label must be between 32 and 4096 characters."
  [[ "$value" =~ ^[A-Za-z0-9._~-]+$ ]] || \
    fail "$label contains characters that are unsafe in an HTTP header."
}

# These values are interpolated into curl configuration headers. Validate the
# complete grammar before the first config file or network request is created.
validate_header_token SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
validate_header_token ANON_KEY "$ANON_KEY"

KONG_URL="$(node -e '
  const url = new URL(process.argv[1]);
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")
  ) process.exit(1);
  process.stdout.write(url.origin);
' "$KONG_URL")" || fail "KONG_URL must be one credential-free HTTPS origin."

node scripts/validate-email-domain.mjs "$ARIA_ALLOWED_EMAIL_DOMAIN"
[ "$ARIA_ALLOWED_EMAIL_DOMAIN" = "$(printf '%s' "$ARIA_ALLOWED_EMAIL_DOMAIN" | LC_ALL=C tr '[:upper:]' '[:lower:]')" ] || \
  fail "ARIA_ALLOWED_EMAIL_DOMAIN must be canonical lowercase."
[ "$ARIA_RECOVERY_EXPECTED_DOMAIN" = workspace ] || \
  fail "ARIA_RECOVERY_EXPECTED_DOMAIN must be the reviewed placeholder domain."
[ "$ARIA_ALLOWED_EMAIL_DOMAIN" != "$ARIA_RECOVERY_EXPECTED_DOMAIN" ] || \
  fail "The resulting tenant domain must differ from the placeholder domain."

uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
for uuid_value in \
  "$ARIA_RECOVERY_WORKSPACE_ID" \
  "$ARIA_RECOVERY_PROFILE_ID" \
  "$ARIA_RECOVERY_REQUEST_ID"; do
  [[ "$uuid_value" =~ $uuid_pattern ]] || fail "Recovery identifiers must be canonical lowercase UUIDs."
  [ "$uuid_value" != 00000000-0000-0000-0000-000000000000 ] || \
    fail "Recovery identifiers must not be nil UUIDs."
done
[[ "$ARIA_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || \
  fail "ARIA_RELEASE_SHA must be exactly 40 lowercase hexadecimal characters."
[[ "$ARIA_RECOVERY_RECEIPT_SHA256" =~ ^[0-9a-f]{64}$ ]] || \
  fail "ARIA_RECOVERY_RECEIPT_SHA256 must be exactly 64 lowercase hexadecimal characters."
[[ "$ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256" =~ ^[0-9a-f]{64}$ ]] || \
  fail "ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256 must be exactly 64 lowercase hexadecimal characters."

case "$ADMIN_EMAIL" in
  *$'\n'*|*$'\r'*) fail "ADMIN_EMAIL must not contain line breaks." ;;
esac
case "$ADMIN_EMAIL" in
  *[[:space:][:cntrl:]]*) fail "ADMIN_EMAIL must not contain whitespace or control characters." ;;
esac
case "$ADMIN_EMAIL" in
  *@*) ;;
  *) fail "ADMIN_EMAIL must contain exactly one at-sign." ;;
esac
case "$ADMIN_EMAIL" in
  *@*@*) fail "ADMIN_EMAIL must contain exactly one at-sign." ;;
esac
[ "$ADMIN_EMAIL" = "$(printf '%s' "$ADMIN_EMAIL" | LC_ALL=C tr '[:upper:]' '[:lower:]')" ] || \
  fail "ADMIN_EMAIL must be canonical lowercase."
ADMIN_EMAIL_LOCAL="${ADMIN_EMAIL%@*}"
ADMIN_EMAIL_DOMAIN="${ADMIN_EMAIL##*@}"
[ -n "$ADMIN_EMAIL_LOCAL" ] && [ "${#ADMIN_EMAIL_LOCAL}" -le 64 ] || \
  fail "ADMIN_EMAIL local part is invalid."
[ "$ADMIN_EMAIL_DOMAIN" = "$ARIA_ALLOWED_EMAIL_DOMAIN" ] || \
  fail "ADMIN_EMAIL domain does not match ARIA_ALLOWED_EMAIL_DOMAIN."
[ "${#ADMIN_EMAIL}" -le 254 ] || fail "ADMIN_EMAIL is too long."

[ "${#ADMIN_PASSWORD}" -ge 24 ] || fail "ADMIN_PASSWORD must contain at least 24 characters."
[ "$(printf '%s' "$ADMIN_PASSWORD" | LC_ALL=C wc -c | tr -d '[:space:]')" -le 72 ] || \
  fail "ADMIN_PASSWORD must contain at most 72 bytes."
case "$ADMIN_PASSWORD" in
  *$'\n'*|*$'\r'*) fail "ADMIN_PASSWORD must not contain line breaks." ;;
esac

printf '%s' "$ARIA_RECOVERY_FULL_NAME" | node -e '
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { value += chunk; });
  process.stdin.on("end", () => {
    if (value.length < 1 || value.length > 120 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) process.exit(1);
  });
' || fail "ARIA_RECOVERY_FULL_NAME must be trimmed, printable, and at most 120 characters."

EXPECTED_OPERATOR_APPROVAL="aria-owner-recovery-v1:${ARIA_RECOVERY_WORKSPACE_ID}:${ARIA_RECOVERY_PROFILE_ID}:${ARIA_RELEASE_SHA}:${ARIA_RECOVERY_RECEIPT_SHA256}:${ARIA_RECOVERY_REQUEST_ID}"
[ "$ARIA_RECOVERY_OPERATOR_APPROVAL" = "$EXPECTED_OPERATOR_APPROVAL" ] || \
  fail "ARIA_RECOVERY_OPERATOR_APPROVAL does not bind the exact reviewed request."
ACTUAL_OPERATOR_APPROVAL_SHA256="$(printf '%s' "$ARIA_RECOVERY_OPERATOR_APPROVAL" | node -e '
  const { createHash } = require("node:crypto");
  const hash = createHash("sha256");
  process.stdin.on("data", chunk => hash.update(chunk));
  process.stdin.on("end", () => process.stdout.write(hash.digest("hex")));
')"
[ "$ACTUAL_OPERATOR_APPROVAL_SHA256" = "$ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256" ] || \
  fail "ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256 does not match the exact approval string."

WORK="$(mktemp -d /tmp/aria-owner-recovery.XXXXXX)"
CREATE_MAY_HAVE_COMMITTED=0
RPC_STARTED=0
RPC_OUTCOME_AMBIGUOUS=0
BINDING_CONFIRMED=0
WORKSPACE_TOPOLOGY=""
PROFILE_TOPOLOGY=""
AUTH_INVENTORY_MODE=""
CREATED_USER_MARKER="aria-owner-recovery-v1:${ARIA_RECOVERY_REQUEST_ID}:${ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256}"
CREATION_ATTEMPT_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" || \
  fail "Could not create a recovery-attempt identifier."
ACCESS_TOKEN=""
STATE_SHA256_BEFORE=""

write_curl_config() {
  local path="$1" method="$2" url="$3" apikey="$4" bearer="$5" output="$6"
  {
    printf 'silent\nshow-error\nno-fail-with-body\n'
    printf 'connect-timeout = 10\nmax-time = 30\n'
    printf 'request = "%s"\n' "$method"
    printf 'url = "%s"\n' "$url"
    printf 'header = "apikey: %s"\n' "$apikey"
    printf 'header = "Authorization: Bearer %s"\n' "$bearer"
    printf 'header = "Content-Type: application/json"\n'
    printf 'output = "%s"\n' "$output"
    printf 'write-out = "%%{http_code}"\n'
  } > "$path"
}

json_sha256() {
  node -e '
    const fs = require("node:fs");
    const { createHash } = require("node:crypto");
    const canonical = value => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
      return value;
    };
    const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(createHash("sha256").update(JSON.stringify(canonical(parsed))).digest("hex"));
  ' "$1"
}

service_get() {
  local label="$1" url="$2" output="$3"
  local config="$WORK/${label}.curl" code
  write_curl_config "$config" GET "$url" "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$output"
  code="$(curl --config "$config")" || return 1
  [ "$code" = 200 ]
}

cleanup_created_user() {
  local user_response="$WORK/cleanup-user.json"
  local profile_response="$WORK/cleanup-profile.json"
  local workspace_response="$WORK/cleanup-workspace.json"
  local delete_body="$WORK/cleanup-delete.json"
  local config code

  [ "$CREATE_MAY_HAVE_COMMITTED" -eq 1 ] || return 0
  [ "$BINDING_CONFIRMED" -eq 0 ] || return 0

  # A transport-lost RPC may still be running. Never race it with identity
  # deletion; owner reconciliation must inspect the marked user later.
  if [ "$RPC_STARTED" -eq 1 ] && [ "$RPC_OUTCOME_AMBIGUOUS" -eq 1 ]; then
    printf 'FAIL-CLOSED: recovery outcome is ambiguous; the marked GoTrue user was preserved.\n' >&2
    return 0
  fi

  config="$WORK/cleanup-user.curl"
  write_curl_config "$config" GET \
    "$KONG_URL/auth/v1/admin/users/$ARIA_RECOVERY_PROFILE_ID" \
    "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$user_response"
  code="$(curl --config "$config")" || return 1
  [ "$code" = 404 ] && return 0
  [ "$code" = 200 ] || return 1
  jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg email "$ADMIN_EMAIL" \
    --arg marker "$CREATED_USER_MARKER" \
    --arg attempt "$CREATION_ATTEMPT_ID" '
      .id == $id and .email == $email and
      .user_metadata.aria_owner_recovery_marker == $marker and
      .user_metadata.aria_owner_recovery_attempt == $attempt
    ' "$user_response" >/dev/null || return 1

  service_get cleanup-profile \
    "$KONG_URL/rest/v1/profiles?id=eq.$ARIA_RECOVERY_PROFILE_ID&select=id,email,full_name,workspace_id,role&limit=2" \
    "$profile_response" || return 1
  if jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg workspace "$ARIA_RECOVERY_WORKSPACE_ID" \
    --arg email "$ADMIN_EMAIL" '
      type == "array" and length == 1 and
      .[0].id == $id and .[0].workspace_id == $workspace and
      .[0].role == "admin" and .[0].email == $email
    ' "$profile_response" >/dev/null; then
    return 0
  fi
  jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg workspace "$ARIA_RECOVERY_WORKSPACE_ID" '
      type == "array" and length == 1 and
      .[0].id == $id and .[0].workspace_id == $workspace and
      .[0].role == "admin" and (.[0].email == null or .[0].email == "")
    ' "$profile_response" >/dev/null || return 1

  service_get cleanup-workspace \
    "$KONG_URL/rest/v1/workspaces?id=eq.$ARIA_RECOVERY_WORKSPACE_ID&select=id,allowed_domain&limit=2" \
    "$workspace_response" || return 1
  jq -e \
    --arg id "$ARIA_RECOVERY_WORKSPACE_ID" \
    --arg domain "$ARIA_RECOVERY_EXPECTED_DOMAIN" '
      type == "array" and length == 1 and
      .[0].id == $id and .[0].allowed_domain == $domain
    ' "$workspace_response" >/dev/null || return 1

  printf '{"should_soft_delete":false}\n' > "$delete_body"
  config="$WORK/cleanup-delete.curl"
  write_curl_config "$config" DELETE \
    "$KONG_URL/auth/v1/admin/users/$ARIA_RECOVERY_PROFILE_ID" \
    "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$user_response"
  code="$(curl --config "$config" --data-binary "@$delete_body")" || return 1
  [ "$code" = 200 ] || [ "$code" = 204 ] || return 1

  config="$WORK/cleanup-absence.curl"
  write_curl_config "$config" GET \
    "$KONG_URL/auth/v1/admin/users/$ARIA_RECOVERY_PROFILE_ID" \
    "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$user_response"
  code="$(curl --config "$config")" || return 1
  [ "$code" = 404 ]
}

cleanup() {
  local original_status="$?"
  local cleanup_status=0
  trap - EXIT HUP INT TERM
  set +e
  if [ "$original_status" -ne 0 ]; then
    cleanup_created_user
    cleanup_status=$?
    [ "$cleanup_status" -eq 0 ] || \
      printf 'ERROR: marked pre-binding GoTrue user cleanup could not be verified.\n' >&2
  fi
  rm -rf "$WORK"
  unset \
    SUPABASE_SERVICE_ROLE_KEY ANON_KEY ADMIN_PASSWORD ACCESS_TOKEN \
    CREATED_USER_MARKER CREATION_ATTEMPT_ID \
    ACTUAL_OPERATOR_APPROVAL_SHA256 EXPECTED_OPERATOR_APPROVAL
  if [ "$original_status" -ne 0 ]; then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

inventory_workspace() {
  local response="$WORK/inventory-workspace.json" observed_domain
  service_get inventory-workspace \
    "$KONG_URL/rest/v1/workspaces?id=eq.$ARIA_RECOVERY_WORKSPACE_ID&select=id,allowed_domain&limit=2" \
    "$response" || fail "Workspace inventory failed."
  observed_domain="$(jq -er --arg id "$ARIA_RECOVERY_WORKSPACE_ID" '
    select(type == "array" and length == 1 and .[0].id == $id) |
    .[0].allowed_domain | select(type == "string")
  ' "$response")" || fail "Workspace inventory is missing or ambiguous."
  if [ "$observed_domain" = "$ARIA_RECOVERY_EXPECTED_DOMAIN" ]; then
    WORKSPACE_TOPOLOGY=orphan
  elif [ "$observed_domain" = "$ARIA_ALLOWED_EMAIL_DOMAIN" ]; then
    WORKSPACE_TOPOLOGY=recovered
  else
    fail "Workspace inventory does not match the reviewed recovery request."
  fi
}

inventory_profiles() {
  local response="$WORK/inventory-profiles.json"
  service_get inventory-profiles \
    "$KONG_URL/rest/v1/profiles?workspace_id=eq.$ARIA_RECOVERY_WORKSPACE_ID&select=id,email,full_name,workspace_id,role&limit=3" \
    "$response" || fail "Profile inventory failed."
  if jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg workspace "$ARIA_RECOVERY_WORKSPACE_ID" '
      type == "array" and length == 1 and
      .[0].id == $id and .[0].workspace_id == $workspace and
      .[0].role == "admin" and (.[0].email == null or .[0].email == "")
    ' "$response" >/dev/null; then
    PROFILE_TOPOLOGY=orphan
  elif jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg workspace "$ARIA_RECOVERY_WORKSPACE_ID" \
    --arg email "$ADMIN_EMAIL" \
    --arg name "$ARIA_RECOVERY_FULL_NAME" '
      type == "array" and length == 1 and
      .[0].id == $id and .[0].workspace_id == $workspace and
      .[0].role == "admin" and .[0].email == $email and .[0].full_name == $name
    ' "$response" >/dev/null; then
    PROFILE_TOPOLOGY=recovered
  else
    fail "Profile inventory does not match the single reviewed owner identity."
  fi
}

inventory_state() {
  local response="$WORK/inventory-state.json"
  service_get inventory-state \
    "$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$ARIA_RECOVERY_WORKSPACE_ID&select=workspace_id,state&limit=2" \
    "$response" || fail "Workspace-state inventory failed."
  jq -e --arg workspace "$ARIA_RECOVERY_WORKSPACE_ID" '
    type == "array" and length == 1 and .[0].workspace_id == $workspace and (.[0] | has("state"))
  ' "$response" >/dev/null || fail "Workspace-state inventory is missing or ambiguous."
  STATE_SHA256_BEFORE="$(json_sha256 "$response")" || fail "Workspace-state fingerprint failed."
}

inventory_auth_users() {
  local response="$WORK/inventory-auth-users.json"
  service_get inventory-auth-users \
    "$KONG_URL/auth/v1/admin/users?page=1&per_page=1000" \
    "$response" || fail "GoTrue user inventory failed."
  if jq -e '
    (if type == "array" then . elif (.users | type) == "array" then .users else error("invalid users response") end)
    | length == 0
  ' "$response" >/dev/null; then
    AUTH_INVENTORY_MODE=empty
  elif jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg email "$ADMIN_EMAIL" \
    --arg marker "$CREATED_USER_MARKER" '
      (if type == "array" then . elif (.users | type) == "array" then .users else error("invalid users response") end)
      | type == "array" and length == 1 and
        .[0].id == $id and .[0].email == $email and
        .[0].user_metadata.aria_owner_recovery_marker == $marker
    ' "$response" >/dev/null; then
    AUTH_INVENTORY_MODE=exact_marked
  else
    fail "GoTrue inventory is neither empty nor the one exact request-marked owner identity."
  fi
}

inventory_workspace
inventory_profiles
inventory_state
inventory_auth_users

case "$WORKSPACE_TOPOLOGY:$PROFILE_TOPOLOGY:$AUTH_INVENTORY_MODE" in
  orphan:orphan:empty|orphan:orphan:exact_marked|recovered:recovered:exact_marked) ;;
  *) fail "Workspace, profile, and GoTrue inventories do not form a safe recovery or replay topology." ;;
esac

CREATE_BODY="$WORK/create-user.json"
CREATE_RESPONSE="$WORK/create-user-response.json"
CREATE_CONFIG="$WORK/create-user.curl"
if [ "$AUTH_INVENTORY_MODE" = empty ]; then
  printf '%s\n%s\n%s\n%s\n%s\n' \
    "$ARIA_RECOVERY_PROFILE_ID" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" \
    "$CREATED_USER_MARKER" "$CREATION_ATTEMPT_ID" | \
    jq -Rn '
      input as $profile_id | input as $email | input as $password |
      input as $marker | input as $attempt |
      {id:$profile_id,email:$email,password:$password,email_confirm:true,
       user_metadata:{aria_owner_recovery_marker:$marker,
                      aria_owner_recovery_attempt:$attempt}}
    ' > "$CREATE_BODY"
  write_curl_config "$CREATE_CONFIG" POST \
    "$KONG_URL/auth/v1/admin/users" \
    "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$CREATE_RESPONSE"
  CREATE_MAY_HAVE_COMMITTED=1
  if ! CREATE_CODE="$(curl --config "$CREATE_CONFIG" --data-binary "@$CREATE_BODY")"; then
    fail "GoTrue owner creation transport failed; outcome requires marked-user reconciliation."
  fi
  [ "$CREATE_CODE" = 200 ] || [ "$CREATE_CODE" = 201 ] || \
    fail "GoTrue owner creation was rejected before binding."
  jq -e \
    --arg id "$ARIA_RECOVERY_PROFILE_ID" \
    --arg email "$ADMIN_EMAIL" \
    --arg marker "$CREATED_USER_MARKER" \
    --arg attempt "$CREATION_ATTEMPT_ID" '
      .id == $id and .email == $email and
      .user_metadata.aria_owner_recovery_marker == $marker and
      .user_metadata.aria_owner_recovery_attempt == $attempt
    ' "$CREATE_RESPONSE" >/dev/null || fail "GoTrue returned a different or unmarked identity."
fi

IDENTITY_RESPONSE="$WORK/identity-response.json"
service_get identity-read \
  "$KONG_URL/auth/v1/admin/users/$ARIA_RECOVERY_PROFILE_ID" \
  "$IDENTITY_RESPONSE" || fail "Created GoTrue identity could not be re-read."
jq -e \
  --arg id "$ARIA_RECOVERY_PROFILE_ID" \
  --arg email "$ADMIN_EMAIL" \
  --arg marker "$CREATED_USER_MARKER" '
    .id == $id and .email == $email and
    .user_metadata.aria_owner_recovery_marker == $marker and
    (.email_confirmed_at != null or .confirmed_at != null) and
    (.banned_until == null) and (.deleted_at == null) and
    ((.app_metadata.provider == "email") or
      ((.identities // []) | any(.provider == "email")))
  ' "$IDENTITY_RESPONSE" >/dev/null || fail "Created GoTrue identity is not an active confirmed local email user."

# Prove that the exact credentials can establish the reviewed local email
# identity before the database transaction makes the owner binding durable.
LOGIN_BODY="$WORK/login.json"
LOGIN_RESPONSE="$WORK/login-response.json"
LOGIN_CONFIG="$WORK/login.curl"
printf '%s\n%s\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" | \
  jq -Rn 'input as $email | input as $password | {email:$email,password:$password}' \
  > "$LOGIN_BODY"
write_curl_config "$LOGIN_CONFIG" POST \
  "$KONG_URL/auth/v1/token?grant_type=password" \
  "$ANON_KEY" "$ANON_KEY" "$LOGIN_RESPONSE"
LOGIN_CODE="$(curl --config "$LOGIN_CONFIG" --data-binary "@$LOGIN_BODY")" || \
  fail "Owner password login preflight failed before binding."
[ "$LOGIN_CODE" = 200 ] || fail "Owner password login preflight was rejected before binding."
ACCESS_TOKEN="$(jq -er \
  --arg id "$ARIA_RECOVERY_PROFILE_ID" \
  --arg email "$ADMIN_EMAIL" '
    select(.user.id == $id and .user.email == $email) |
    select((.user.email_confirmed_at != null or .user.confirmed_at != null) and .user.last_sign_in_at != null) |
    select(.user.banned_until == null and .user.deleted_at == null) |
    .access_token | select(type == "string" and length > 0)
  ' "$LOGIN_RESPONSE")" || fail "Password login preflight did not prove the exact active owner identity."
validate_header_token ACCESS_TOKEN "$ACCESS_TOKEN"

RPC_BODY="$WORK/recovery-rpc.json"
RPC_RESPONSE="$WORK/recovery-rpc-response.json"
RPC_CONFIG="$WORK/recovery-rpc.curl"
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
  "$ARIA_RECOVERY_WORKSPACE_ID" \
  "$ARIA_RECOVERY_PROFILE_ID" \
  "$ARIA_RECOVERY_EXPECTED_DOMAIN" \
  "$ADMIN_EMAIL" \
  "$ARIA_ALLOWED_EMAIL_DOMAIN" \
  "$ARIA_RECOVERY_FULL_NAME" \
  "$ARIA_RELEASE_SHA" \
  "$ARIA_RECOVERY_RECEIPT_SHA256" \
  "$ARIA_RECOVERY_REQUEST_ID" \
  "$ARIA_RECOVERY_OPERATOR_APPROVAL" \
  "$ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256" | \
  jq -Rn '
    input as $workspace | input as $profile | input as $expected_domain |
    input as $email | input as $domain | input as $full_name |
    input as $release | input as $recovery_sha | input as $request |
    input as $approval | input as $approval_sha |
    {p_workspace_id:$workspace,p_profile_id:$profile,
     p_expected_current_domain:$expected_domain,p_canonical_email:$email,
     p_canonical_domain:$domain,p_full_name:$full_name,p_release_sha:$release,
     p_recovery_receipt_sha256:$recovery_sha,p_request_id:$request,
     p_operator_approval:$approval,p_operator_approval_sha256:$approval_sha}
  ' > "$RPC_BODY"
write_curl_config "$RPC_CONFIG" POST \
  "$KONG_URL/rest/v1/rpc/recover_orphan_workspace_owner" \
  "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" "$RPC_RESPONSE"
RPC_STARTED=1
RPC_OUTCOME_AMBIGUOUS=1
if ! RPC_CODE="$(curl --config "$RPC_CONFIG" --data-binary "@$RPC_BODY")"; then
  fail "Owner recovery RPC transport failed; the marked identity was preserved for reconciliation."
fi
RPC_OUTCOME_AMBIGUOUS=0
[ "$RPC_CODE" = 200 ] || fail "Owner recovery RPC failed before a verified binding."
jq -e --arg request "$ARIA_RECOVERY_REQUEST_ID" '
  (.status == "recovered" or .status == "replay") and .request_id == $request
' "$RPC_RESPONSE" >/dev/null || fail "Owner recovery RPC did not return the exact recovery receipt."

WORKSPACE_RESPONSE="$WORK/verify-workspace.json"
WORKSPACE_CONFIG="$WORK/verify-workspace.curl"
write_curl_config "$WORKSPACE_CONFIG" GET \
  "$KONG_URL/rest/v1/workspaces?id=eq.$ARIA_RECOVERY_WORKSPACE_ID&select=id,allowed_domain&limit=2" \
  "$ANON_KEY" "$ACCESS_TOKEN" "$WORKSPACE_RESPONSE"
WORKSPACE_CODE="$(curl --config "$WORKSPACE_CONFIG")" || fail "Recovered workspace verification failed."
[ "$WORKSPACE_CODE" = 200 ] || fail "Recovered workspace verification was rejected."
jq -e \
  --arg id "$ARIA_RECOVERY_WORKSPACE_ID" \
  --arg domain "$ARIA_ALLOWED_EMAIL_DOMAIN" '
    type == "array" and length == 1 and
    .[0].id == $id and .[0].allowed_domain == $domain
  ' "$WORKSPACE_RESPONSE" >/dev/null || fail "Recovered owner is not bound to the exact tenant domain."

PROFILE_RESPONSE="$WORK/verify-profile.json"
PROFILE_CONFIG="$WORK/verify-profile.curl"
write_curl_config "$PROFILE_CONFIG" GET \
  "$KONG_URL/rest/v1/profiles?id=eq.$ARIA_RECOVERY_PROFILE_ID&select=id,email,full_name,workspace_id,role&limit=2" \
  "$ANON_KEY" "$ACCESS_TOKEN" "$PROFILE_RESPONSE"
PROFILE_CODE="$(curl --config "$PROFILE_CONFIG")" || fail "Recovered profile verification failed."
[ "$PROFILE_CODE" = 200 ] || fail "Recovered profile verification was rejected."
jq -e \
  --arg id "$ARIA_RECOVERY_PROFILE_ID" \
  --arg email "$ADMIN_EMAIL" \
  --arg name "$ARIA_RECOVERY_FULL_NAME" \
  --arg workspace "$ARIA_RECOVERY_WORKSPACE_ID" '
    type == "array" and length == 1 and
    .[0].id == $id and .[0].email == $email and .[0].full_name == $name and
    .[0].workspace_id == $workspace and .[0].role == "admin"
  ' "$PROFILE_RESPONSE" >/dev/null || fail "Recovered auth/profile/workspace/admin binding is not exact."

STATE_RESPONSE="$WORK/verify-state.json"
service_get verify-state \
  "$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$ARIA_RECOVERY_WORKSPACE_ID&select=workspace_id,state&limit=2" \
  "$STATE_RESPONSE" || fail "Recovered workspace-state verification failed."
STATE_SHA256_AFTER="$(json_sha256 "$STATE_RESPONSE")" || fail "Recovered workspace-state fingerprint failed."
[ "$STATE_SHA256_AFTER" = "$STATE_SHA256_BEFORE" ] || \
  fail "Workspace state changed during owner recovery."

BINDING_CONFIRMED=1
printf 'OWNER_RECOVERY_VERIFIED request_id=%s\n' "$ARIA_RECOVERY_REQUEST_ID"
