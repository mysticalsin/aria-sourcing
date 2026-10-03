#!/usr/bin/env bash
# Provision and verify the first real-tenant ARIA administrator through GoTrue.
#
# Required environment, injected from an owner-controlled secret manager:
#   KONG_URL                     public Supabase/Kong origin
#   SUPABASE_SERVICE_ROLE_KEY    service-role JWT used only for user creation
#   ANON_KEY                     anon JWT used for password sign-in and RPCs
#   ADMIN_EMAIL                  first administrator, on the approved tenant domain
#   ADMIN_PASSWORD               unique 24+ character password
#   ARIA_ALLOWED_EMAIL_DOMAIN    canonical lowercase tenant domain
#
# The script never promotes an existing workspace member. Migration 0018 grants
# admin only when ensure_workspace() creates a brand-new domain workspace.
set -euo pipefail
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

node scripts/validate-email-domain.mjs "$ARIA_ALLOWED_EMAIL_DOMAIN"

KONG_URL="$(node -e '
  const raw = process.argv[1];
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) process.exit(1);
  process.stdout.write(url.origin);
' "$KONG_URL")" || fail "KONG_URL must be one credential-free HTTPS origin."

case "$ADMIN_EMAIL" in
  *@*) ;;
  *) fail "ADMIN_EMAIL must be a complete email address." ;;
esac
case "$ADMIN_EMAIL" in
  *@*@*) fail "ADMIN_EMAIL must contain exactly one at-sign." ;;
esac
case "$ADMIN_EMAIL" in
  *$'\n'*|*$'\r'*) fail "ADMIN_EMAIL must not contain line breaks." ;;
esac
ADMIN_EMAIL_CANONICAL="$(printf '%s' "$ADMIN_EMAIL" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
[ "$ADMIN_EMAIL" = "$ADMIN_EMAIL_CANONICAL" ] || \
  fail "ADMIN_EMAIL must be canonical lowercase before any identity mutation."
ADMIN_EMAIL_DOMAIN="${ADMIN_EMAIL##*@}"
ADMIN_EMAIL_DOMAIN="$(printf '%s' "$ADMIN_EMAIL_DOMAIN" | tr '[:upper:]' '[:lower:]')"
[ -n "${ADMIN_EMAIL%@*}" ] || fail "ADMIN_EMAIL must contain a local part."
[ "$ADMIN_EMAIL_DOMAIN" = "$ARIA_ALLOWED_EMAIL_DOMAIN" ] || \
  fail "ADMIN_EMAIL email domain does not match ARIA_ALLOWED_EMAIL_DOMAIN."
[ "${#ADMIN_PASSWORD}" -ge 24 ] || fail "ADMIN_PASSWORD must contain at least 24 characters."
[ "${#ADMIN_PASSWORD}" -le 256 ] || fail "ADMIN_PASSWORD must contain at most 256 characters."
case "$ADMIN_PASSWORD" in
  *$'\n'*|*$'\r'*) fail "ADMIN_PASSWORD must not contain line breaks." ;;
esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/aria-first-admin.XXXXXX")"
CREATED_USER_ID=""
CREATED_USER_MARKER=""
CREATED_USER_EMAIL=""
CREATE_MAY_HAVE_COMMITTED=0
BOOTSTRAP_BOUND=0
MUTATION_OUTCOME_AMBIGUOUS=0

cleanup_created_user() {
  local page row_count recovered_id search_complete
  local list_response="$WORK/cleanup-user-list.json"
  local list_config="$WORK/cleanup-user-list.curl"
  local read_response="$WORK/cleanup-user-read.json"
  local read_config="$WORK/cleanup-user-read.curl"
  local binding_response="$WORK/cleanup-binding-read.json"
  local binding_config="$WORK/cleanup-binding-read.curl"
  local delete_body="$WORK/cleanup-user-delete.json"
  local delete_config="$WORK/cleanup-user-delete.curl"
  local read_code binding_code binding_count delete_code absence_code

  [ "$CREATE_MAY_HAVE_COMMITTED" -eq 1 ] || return 0
  if [ "$MUTATION_OUTCOME_AMBIGUOUS" -eq 1 ]; then
    printf 'FAIL-CLOSED: a remote identity/workspace mutation may still be in flight; the marked auth user was preserved for owner reconciliation.\n' >&2
    return 0
  fi
  # Once ensure_workspace has returned the exact workspace, migration 0018 has
  # atomically created the admin profile. A later verification/network failure
  # must leave that intended identity intact for the next inventory pass rather
  # than delete the user and strand an orphaned allowed-domain workspace.
  [ "$BOOTSTRAP_BOUND" -eq 0 ] || return 0
  if [ -z "$CREATED_USER_ID" ]; then
    recovered_id=""
    search_complete=0
    for page in 1 2 3 4 5 6 7 8 9 10; do
      write_get_curl_config \
        "$list_config" \
        "$KONG_URL/auth/v1/admin/users?page=$page&per_page=1000" \
        "$SUPABASE_SERVICE_ROLE_KEY" \
        "$SUPABASE_SERVICE_ROLE_KEY" \
        "$list_response"
      read_code="$(curl --config "$list_config")" || return 1
      [ "$read_code" = 200 ] || return 1
      row_count="$(jq -er '
        if type == "array" then length
        elif (.users | type) == "array" then .users | length
        else error("invalid auth-user list")
        end
      ' "$list_response")" || return 1
      recovered_id="$(jq -er --arg email "$CREATED_USER_EMAIL" --arg marker "$CREATED_USER_MARKER" '
        (if type == "array" then . else .users end) |
        map(select(.email == $email and .user_metadata.aria_admin_bootstrap_marker == $marker)) |
        if length == 0 then ""
        elif length == 1 and (.[0].id | type == "string" and test("^[0-9a-fA-F-]{36}$")) then .[0].id
        else error("ambiguous marked auth user")
        end
      ' "$list_response")" || return 1
      [ -z "$recovered_id" ] || break
      if [ "$row_count" -lt 1000 ]; then
        search_complete=1
        break
      fi
    done
    if [ -z "$recovered_id" ]; then
      [ "$search_complete" -eq 1 ] && return 0
      return 1
    fi
    CREATED_USER_ID="$recovered_id"
  fi
  write_get_curl_config \
    "$read_config" \
    "$KONG_URL/auth/v1/admin/users/$CREATED_USER_ID" \
    "$SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_SERVICE_ROLE_KEY" \
    "$read_response"
  read_code="$(curl --config "$read_config")" || return 1
  [ "$read_code" = 200 ] || return 1
  jq -e --arg id "$CREATED_USER_ID" --arg email "$CREATED_USER_EMAIL" --arg marker "$CREATED_USER_MARKER" '
    .id == $id and .email == $email and
    .user_metadata.aria_admin_bootstrap_marker == $marker
  ' "$read_response" >/dev/null || return 1

  # The RPC transaction can commit even when its HTTP response is lost. Before
  # deleting the marked auth user, prove that no exact tenant-admin binding was
  # committed. Any ambiguous or unavailable database response fails closed.
  write_get_curl_config \
    "$binding_config" \
    "$KONG_URL/rest/v1/profiles?id=eq.$CREATED_USER_ID&select=id,role,workspace_id,workspaces(id,allowed_domain)&limit=2" \
    "$SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_SERVICE_ROLE_KEY" \
    "$binding_response"
  binding_code="$(curl --config "$binding_config")" || return 1
  [ "$binding_code" = 200 ] || return 1
  binding_count="$(jq -er \
    --arg id "$CREATED_USER_ID" \
    --arg domain "$ARIA_ALLOWED_EMAIL_DOMAIN" '
      if type != "array" or length > 1 then error("ambiguous admin binding")
      elif length == 0 then 0
      elif (
        .[0].id == $id and .[0].role == "admin" and
        (.[0].workspace_id | type) == "string" and
        .[0].workspaces.id == .[0].workspace_id and
        .[0].workspaces.allowed_domain == $domain
      ) then 1
      else error("mismatched admin binding")
      end
    ' "$binding_response")" || return 1
  [ "$binding_count" -eq 0 ] || return 0

  printf '{"should_soft_delete":false}\n' > "$delete_body"
  write_delete_curl_config \
    "$delete_config" \
    "$KONG_URL/auth/v1/admin/users/$CREATED_USER_ID" \
    "$SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_SERVICE_ROLE_KEY" \
    "$read_response"
  delete_code="$(curl --config "$delete_config" --data-binary "@$delete_body")" || return 1
  [ "$delete_code" = 200 ] || [ "$delete_code" = 204 ] || return 1

  absence_code="$(curl --config "$read_config")" || return 1
  [ "$absence_code" = 404 ] || return 1
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT HUP INT TERM
  set +e
  if [ "$original_status" -ne 0 ]; then
    cleanup_created_user
    cleanup_status=$?
    [ "$cleanup_status" -eq 0 ] || \
      printf 'ERROR: newly created administrator cleanup could not be verified; no success claim is valid.\n' >&2
  fi
  rm -rf "$WORK"
  unset SUPABASE_SERVICE_ROLE_KEY ANON_KEY ADMIN_PASSWORD ACCESS_TOKEN CREATED_USER_MARKER
  if [ "$original_status" -ne 0 ]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

write_curl_config() {
  local path="$1"
  local url="$2"
  local apikey="$3"
  local bearer="$4"
  local output="$5"
  {
    printf 'silent\nshow-error\nno-fail-with-body\n'
    printf 'connect-timeout = 10\nmax-time = 30\n'
    printf 'request = "POST"\n'
    printf 'url = "%s"\n' "$url"
    printf 'header = "apikey: %s"\n' "$apikey"
    printf 'header = "Authorization: Bearer %s"\n' "$bearer"
    printf 'header = "Content-Type: application/json"\n'
    printf 'output = "%s"\n' "$output"
    printf 'write-out = "%%{http_code}"\n'
  } > "$path"
}

write_get_curl_config() {
  local path="$1"
  local url="$2"
  local apikey="$3"
  local bearer="$4"
  local output="$5"
  {
    printf 'silent\nshow-error\nno-fail-with-body\n'
    printf 'connect-timeout = 10\nmax-time = 30\n'
    printf 'request = "GET"\n'
    printf 'url = "%s"\n' "$url"
    printf 'header = "apikey: %s"\n' "$apikey"
    printf 'header = "Authorization: Bearer %s"\n' "$bearer"
    printf 'output = "%s"\n' "$output"
    printf 'write-out = "%%{http_code}"\n'
  } > "$path"
}

write_delete_curl_config() {
  local path="$1"
  local url="$2"
  local apikey="$3"
  local bearer="$4"
  local output="$5"
  {
    printf 'silent\nshow-error\nno-fail-with-body\n'
    printf 'connect-timeout = 10\nmax-time = 30\n'
    printf 'request = "DELETE"\n'
    printf 'url = "%s"\n' "$url"
    printf 'header = "apikey: %s"\n' "$apikey"
    printf 'header = "Authorization: Bearer %s"\n' "$bearer"
    printf 'header = "Content-Type: application/json"\n'
    printf 'output = "%s"\n' "$output"
    printf 'write-out = "%%{http_code}"\n'
  } > "$path"
}

# The automatic path is deliberately limited to a truly new tenant workspace.
# An existing domain with no active administrator requires a separate reviewed
# owner-recovery procedure; creating a member first would leave partial state.
PREFLIGHT_RESPONSE="$WORK/workspace-preflight-response.json"
PREFLIGHT_CONFIG="$WORK/workspace-preflight.curl"
write_get_curl_config \
  "$PREFLIGHT_CONFIG" \
  "$KONG_URL/rest/v1/workspaces?allowed_domain=eq.$ARIA_ALLOWED_EMAIL_DOMAIN&select=id,allowed_domain&limit=2" \
  "$SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_SERVICE_ROLE_KEY" \
  "$PREFLIGHT_RESPONSE"
PREFLIGHT_CODE="$(curl --config "$PREFLIGHT_CONFIG")" || \
  fail "First administrator workspace preflight request failed."
[ "$PREFLIGHT_CODE" = 200 ] || \
  fail "First administrator workspace preflight failed with HTTP $PREFLIGHT_CODE."
node -e '
  const fs = require("node:fs");
  const domain = process.argv[2];
  const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(rows) || rows.length > 1) process.exit(1);
  if (rows.length === 1) {
    const row = rows[0];
    if (typeof row?.id !== "string" || row.allowed_domain !== domain) process.exit(1);
    process.exit(2);
  }
' "$PREFLIGHT_RESPONSE" "$ARIA_ALLOWED_EMAIL_DOMAIN" || {
  preflight_status=$?
  if [ "$preflight_status" -eq 2 ]; then
    fail "An allowed-domain workspace already exists without a verified active administrator. No user was created; use the reviewed owner-recovery procedure."
  fi
  fail "First administrator workspace preflight returned ambiguous or mismatched authority."
}

CREATE_BODY="$WORK/create-user.json"
CREATE_RESPONSE="$WORK/create-user-response.json"
CREATE_CONFIG="$WORK/create-user.curl"
CREATED_USER_MARKER="aria-admin-bootstrap:$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
CREATED_USER_EMAIL="$ADMIN_EMAIL"
printf '%s\n%s\n%s\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$CREATED_USER_MARKER" | \
  jq -Rn 'input as $email | input as $password | input as $marker |
    {email:$email,password:$password,email_confirm:true,user_metadata:{aria_admin_bootstrap_marker:$marker}}' \
  > "$CREATE_BODY"
write_curl_config \
  "$CREATE_CONFIG" \
  "$KONG_URL/auth/v1/admin/users" \
  "$SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_SERVICE_ROLE_KEY" \
  "$CREATE_RESPONSE"
CREATE_MAY_HAVE_COMMITTED=1
MUTATION_OUTCOME_AMBIGUOUS=1
if CREATE_CODE="$(curl --config "$CREATE_CONFIG" --data-binary "@$CREATE_BODY")"; then
  MUTATION_OUTCOME_AMBIGUOUS=0
else
  fail "GoTrue administrator creation transport failed; remote outcome is ambiguous."
fi
case "$CREATE_CODE" in
  200|201)
    CREATED_USER_ID="$(jq -er --arg email "$ADMIN_EMAIL" --arg marker "$CREATED_USER_MARKER" '
      select(.email == $email and .user_metadata.aria_admin_bootstrap_marker == $marker) |
      .id | select(type == "string" and test("^[0-9a-fA-F-]{36}$"))
    ' "$CREATE_RESPONSE")" || fail "GoTrue administrator creation returned an unmarked or invalid user identity."
    printf 'First administrator auth user created.\n'
    ;;
  422) printf 'Auth user may already exist; continuing with credential and role verification.\n' ;;
  *) fail "GoTrue administrator creation failed with HTTP $CREATE_CODE." ;;
esac

LOGIN_BODY="$WORK/login.json"
LOGIN_RESPONSE="$WORK/login-response.json"
LOGIN_CONFIG="$WORK/login.curl"
printf '%s\n%s\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" | \
  jq -Rn 'input as $email | input as $password | {email:$email,password:$password}' \
  > "$LOGIN_BODY"
write_curl_config \
  "$LOGIN_CONFIG" \
  "$KONG_URL/auth/v1/token?grant_type=password" \
  "$ANON_KEY" \
  "$ANON_KEY" \
  "$LOGIN_RESPONSE"
LOGIN_CODE="$(curl --config "$LOGIN_CONFIG" --data-binary "@$LOGIN_BODY")" || \
  fail "First administrator sign-in request failed."
[ "$LOGIN_CODE" = 200 ] || fail "First administrator sign-in failed with HTTP $LOGIN_CODE."
ACCESS_TOKEN="$(jq -er '.access_token | select(type == "string" and length > 0)' "$LOGIN_RESPONSE")" || \
  fail "First administrator sign-in returned no access token."
USER_ID="$(node -e '
  const fs = require("node:fs");
  const expectedEmail = process.argv[2].toLowerCase();
  const domain = process.argv[3];
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const user = payload?.user;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") process.exit(1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) process.exit(1);
  const email = user.email.toLowerCase();
  const [local, emailDomain, ...extra] = email.split("@");
  const providers = new Set([
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    user.app_metadata?.provider,
    ...(Array.isArray(user.identities) ? user.identities.map((identity) => identity?.provider) : []),
  ].filter((value) => typeof value === "string"));
  const confirmedAt = Date.parse(user.email_confirmed_at ?? user.confirmed_at ?? "");
  const lastSignInAt = Date.parse(user.last_sign_in_at ?? "");
  if (
    email !== expectedEmail || !local || extra.length !== 0 || emailDomain !== domain ||
    local.startsWith("aria.acceptance+") || !providers.has("email") ||
    !Number.isFinite(confirmedAt) || !Number.isFinite(lastSignInAt)
  ) process.exit(1);
  process.stdout.write(user.id);
' "$LOGIN_RESPONSE" "$ADMIN_EMAIL" "$ARIA_ALLOWED_EMAIL_DOMAIN")" || \
  fail "First administrator sign-in did not prove an active confirmed email identity."
[ -z "$CREATED_USER_ID" ] || [ "$USER_ID" = "$CREATED_USER_ID" ] || \
  fail "Fresh administrator creation signed in as a different auth identity."

RPC_BODY="$WORK/rpc.json"
printf '{}\n' > "$RPC_BODY"
ENSURE_RESPONSE="$WORK/ensure-workspace-response.json"
ENSURE_CONFIG="$WORK/ensure-workspace.curl"
write_curl_config \
  "$ENSURE_CONFIG" \
  "$KONG_URL/rest/v1/rpc/ensure_workspace" \
  "$ANON_KEY" \
  "$ACCESS_TOKEN" \
  "$ENSURE_RESPONSE"
MUTATION_OUTCOME_AMBIGUOUS=1
if ENSURE_CODE="$(curl --config "$ENSURE_CONFIG" --data-binary "@$RPC_BODY")"; then
  :
else
  fail "ensure_workspace transport failed; remote outcome is ambiguous."
fi
if [ "$ENSURE_CODE" != 200 ]; then
  fail "ensure_workspace returned HTTP $ENSURE_CODE; remote outcome is ambiguous."
fi
WORKSPACE_ID="$(jq -er 'select(type == "string") | select(test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"; "i"))' "$ENSURE_RESPONSE")" || \
  fail "ensure_workspace returned an invalid workspace id."
BOOTSTRAP_BOUND=1
MUTATION_OUTCOME_AMBIGUOUS=0

WORKSPACE_RESPONSE="$WORK/workspace-response.json"
WORKSPACE_CONFIG="$WORK/workspace.curl"
write_get_curl_config \
  "$WORKSPACE_CONFIG" \
  "$KONG_URL/rest/v1/workspaces?id=eq.$WORKSPACE_ID&select=id,allowed_domain" \
  "$ANON_KEY" \
  "$ACCESS_TOKEN" \
  "$WORKSPACE_RESPONSE"
WORKSPACE_CODE="$(curl --config "$WORKSPACE_CONFIG")" || \
  fail "First administrator workspace verification request failed."
[ "$WORKSPACE_CODE" = 200 ] || \
  fail "First administrator workspace verification failed with HTTP $WORKSPACE_CODE."
jq -e --arg id "$WORKSPACE_ID" --arg domain "$ARIA_ALLOWED_EMAIL_DOMAIN" \
  'type == "array" and length == 1 and .[0].id == $id and .[0].allowed_domain == $domain' \
  "$WORKSPACE_RESPONSE" >/dev/null || \
  fail "First administrator is not bound to the exact allowed-domain workspace."

PROFILE_RESPONSE="$WORK/profile-response.json"
PROFILE_CONFIG="$WORK/profile.curl"
write_get_curl_config \
  "$PROFILE_CONFIG" \
  "$KONG_URL/rest/v1/profiles?id=eq.$USER_ID&select=id,workspace_id,role" \
  "$ANON_KEY" \
  "$ACCESS_TOKEN" \
  "$PROFILE_RESPONSE"
PROFILE_CODE="$(curl --config "$PROFILE_CONFIG")" || \
  fail "First administrator profile verification request failed."
[ "$PROFILE_CODE" = 200 ] || \
  fail "First administrator profile verification failed with HTTP $PROFILE_CODE."
jq -e --arg id "$USER_ID" --arg workspace "$WORKSPACE_ID" \
  'type == "array" and length == 1 and .[0].id == $id and .[0].workspace_id == $workspace and .[0].role == "admin"' \
  "$PROFILE_RESPONSE" >/dev/null || \
  fail "First administrator auth identity, profile, workspace, and role are not bound."

ROLE_RESPONSE="$WORK/current-profile-role-response.json"
ROLE_CONFIG="$WORK/current-profile-role.curl"
write_curl_config \
  "$ROLE_CONFIG" \
  "$KONG_URL/rest/v1/rpc/current_profile_role" \
  "$ANON_KEY" \
  "$ACCESS_TOKEN" \
  "$ROLE_RESPONSE"
ROLE_CODE="$(curl --config "$ROLE_CONFIG" --data-binary "@$RPC_BODY")" || \
  fail "current_profile_role request failed."
[ "$ROLE_CODE" = 200 ] || fail "current_profile_role failed with HTTP $ROLE_CODE."
ROLE="$(jq -er 'select(type == "string")' "$ROLE_RESPONSE")" || \
  fail "current_profile_role returned an invalid response."
[ "$ROLE" = admin ] || \
  fail "First administrator verification returned role '$ROLE'. Stop and review workspace ownership; do not auto-promote."

printf 'FIRST_ADMIN_VERIFIED role=admin domain=%s\n' "$ARIA_ALLOWED_EMAIL_DOMAIN"
