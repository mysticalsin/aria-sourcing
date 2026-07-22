#!/usr/bin/env bash
# Production-safe authenticated acceptance for ARIA's persistence and no-send paths.
#
# Required environment (inject from an owner-controlled secret manager):
#   APP_URL                       credential-free ARIA app HTTPS origin
#   KONG_URL                      credential-free Supabase/Kong HTTPS origin
#   ANON_KEY                      public anon JWT used for the test user's session
#   SUPABASE_SERVICE_ROLE_KEY     service JWT used only for ephemeral setup/cleanup
#   ARIA_ALLOWED_EMAIL_DOMAIN     canonical lowercase domain for the plus-address user
#   ARIA_RELEASE_SHA              exact checked 40-character release commit
#
# The harness creates a uniquely marked tenant and synthetic user, persists only
# synthetic dry-run state, exercises confirmLive=false and manual-only LinkedIn,
# proves that neither delivery table changed, and deletes everything it created.
# Stdout is reserved for one non-secret JSON receipt, emitted only after cleanup
# and absence verification have succeeded. Progress and errors go to stderr.
set -Eeuo pipefail
umask 077

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

for command_name in curl jq node openssl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done

for variable_name in APP_URL KONG_URL ANON_KEY SUPABASE_SERVICE_ROLE_KEY ARIA_ALLOWED_EMAIL_DOMAIN ARIA_RELEASE_SHA; do
  [ -n "${!variable_name:-}" ] || fail "$variable_name is required."
done
[[ "$ARIA_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "ARIA_RELEASE_SHA must be an exact lowercase release SHA."
[ "$ANON_KEY" != "$SUPABASE_SERVICE_ROLE_KEY" ] || fail "Anon and service-role keys must be different."
ACCEPTANCE_ANON_KEY="$ANON_KEY"
ACCEPTANCE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
unset ANON_KEY SUPABASE_SERVICE_ROLE_KEY

node scripts/validate-email-domain.mjs "$ARIA_ALLOWED_EMAIL_DOMAIN" >/dev/null || \
  fail "ARIA_ALLOWED_EMAIL_DOMAIN is not a canonical lowercase DNS domain."

normalize_origin() {
  node -e '
    const raw = process.argv[1];
    const testMode = process.argv[2] === "1";
    const url = new URL(raw);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    const transportOk = url.protocol === "https:" || (testMode && loopback && url.protocol === "http:");
    if (
      !transportOk || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) process.exit(1);
    process.stdout.write(url.origin);
  ' "$1" "${ARIA_ACCEPTANCE_TEST_MODE:-0}"
}

APP_URL="$(normalize_origin "$APP_URL" 2>/dev/null)" || fail "APP_URL must be a credential-free HTTPS origin."
KONG_URL="$(normalize_origin "$KONG_URL" 2>/dev/null)" || fail "KONG_URL must be a credential-free HTTPS origin."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/aria-acceptance.XXXXXX")"
HTTP_CODE=""
HTTP_BODY=""
HTTP_HEADERS=""
WORKSPACE_ID=""
USER_ID=""
SPEC_ID=""
ACCESS_TOKEN=""
APP_COOKIE_HEADER=""
MAIN_COMPLETE=0
CLEANUP_VERIFIED=0

RUN_TOKEN="$(openssl rand -hex 12)"
MARKER="aria-acceptance:${RUN_TOKEN}"
MARKER_URI="$(jq -rn --arg value "$MARKER" '$value | @uri')"
EMAIL="aria.acceptance+${RUN_TOKEN}@${ARIA_ALLOWED_EMAIL_DOMAIN}"
PASSWORD="$(openssl rand -hex 32)"
CAMPAIGN_ID="campaign-${RUN_TOKEN}"
MESSAGE_ID="draft-${RUN_TOKEN}"
CANDIDATE_ID="candidate-${RUN_TOKEN}"
MARKER_SHA256="$(printf '%s' "$MARKER" | openssl dgst -sha256 -r | awk '{print $1}')"

request() {
  local label="$1"
  local method="$2"
  local url="$3"
  local apikey="${4:-}"
  local bearer="${5:-}"
  local body_file="${6:-}"
  local prefer="${7:-}"
  local cookie="${8:-}"
  local config="$WORK/${label}.curl"
  local output="$WORK/${label}.response.json"
  local headers="$WORK/${label}.response.headers"

  {
    printf 'silent\nshow-error\n'
    printf 'connect-timeout = 10\nmax-time = 45\n'
    printf 'request = "%s"\n' "$method"
    printf 'url = "%s"\n' "$url"
    [ -z "$apikey" ] || printf 'header = "apikey: %s"\n' "$apikey"
    [ -z "$bearer" ] || printf 'header = "Authorization: Bearer %s"\n' "$bearer"
    [ -z "$body_file" ] || printf 'header = "Content-Type: application/json"\n'
    [ -z "$prefer" ] || printf 'header = "Prefer: %s"\n' "$prefer"
    [ -z "$cookie" ] || printf 'header = "Cookie: %s"\n' "$cookie"
    [ -z "$cookie" ] || printf 'header = "Origin: %s"\n' "$APP_URL"
    [ -z "$body_file" ] || printf 'data-binary = "@%s"\n' "$body_file"
    printf 'output = "%s"\n' "$output"
    printf 'dump-header = "%s"\n' "$headers"
    printf 'write-out = "%%{http_code}"\n'
  } > "$config"

  HTTP_CODE="$(curl --config "$config")" || return 1
  HTTP_BODY="$output"
  HTTP_HEADERS="$headers"
}

response_header() {
  local header_name="$1"
  awk -F ':' -v expected="$header_name" '
    tolower($1) == tolower(expected) {
      sub(/^[^:]*:[[:space:]]*/, "")
      sub(/\r$/, "")
      value = tolower($0)
    }
    END { print value }
  ' "$HTTP_HEADERS"
}

require_no_store() {
  local label="$1"
  [ "$(response_header Cache-Control)" = "no-store" ] || \
    fail "$label did not return the exact Cache-Control: no-store boundary."
}

service_request() {
  request "$1" "$2" "$3" "$ACCEPTANCE_SERVICE_ROLE_KEY" "$ACCEPTANCE_SERVICE_ROLE_KEY" \
    "${4:-}" "${5:-}" ""
}

authenticated_request() {
  request "$1" "$2" "$3" "$ACCEPTANCE_ANON_KEY" "$ACCESS_TOKEN" "${4:-}" "${5:-}" ""
}

app_request() {
  request "$1" "$2" "$3" "" "" "${4:-}" "" "$APP_COOKIE_HEADER"
}

cleanup_exact() {
  local cleanup_failed=0
  local page recovered_id row_count
  local workspace_query
  local state_query

  log "Cleaning the marked ephemeral acceptance tenant."

  if [ -z "$WORKSPACE_ID" ]; then
    if ! service_request cleanup-workspace-recovery GET \
      "$KONG_URL/rest/v1/workspaces?name=eq.$MARKER_URI&allowed_domain=is.null&select=id,name,allowed_domain"; then
      log "CLEANUP ERROR: could not recover the marked workspace identity."
      cleanup_failed=1
    elif [ "$HTTP_CODE" != 200 ]; then
      log "CLEANUP ERROR: marked workspace recovery returned HTTP $HTTP_CODE."
      cleanup_failed=1
    else
      recovered_id="$(jq -er --arg marker "$MARKER" '
        if type != "array" then error("invalid workspace list")
        elif length == 0 then ""
        elif length == 1 and .[0].name == $marker and .[0].allowed_domain == null and
             (. [0].id | type == "string" and test("^[0-9a-fA-F-]{36}$")) then .[0].id
        else error("ambiguous or mismatched marked workspace")
        end
      ' "$HTTP_BODY" 2>/dev/null)" || {
        log "CLEANUP ERROR: marked workspace recovery was ambiguous or mismatched."
        cleanup_failed=1
        recovered_id=""
      }
      [ -z "$recovered_id" ] || WORKSPACE_ID="$recovered_id"
    fi
  fi

  if [ -z "$USER_ID" ]; then
    recovered_id=""
    for page in 1 2 3 4 5 6 7 8 9 10; do
      if ! service_request cleanup-user-recovery GET \
        "$KONG_URL/auth/v1/admin/users?page=$page&per_page=1000"; then
        log "CLEANUP ERROR: could not recover the marked auth-user identity."
        cleanup_failed=1
        break
      elif [ "$HTTP_CODE" != 200 ]; then
        log "CLEANUP ERROR: marked auth-user recovery returned HTTP $HTTP_CODE."
        cleanup_failed=1
        break
      fi
      row_count="$(jq -er '
        if type == "array" then length
        elif (.users | type) == "array" then .users | length
        else error("invalid auth-user list")
        end
      ' "$HTTP_BODY" 2>/dev/null)" || {
        log "CLEANUP ERROR: marked auth-user recovery returned an invalid list."
        cleanup_failed=1
        break
      }
      recovered_id="$(jq -er --arg email "$EMAIL" --arg marker "$MARKER" '
        (if type == "array" then . else .users end) |
        map(select(.email == $email and .user_metadata.aria_acceptance_marker == $marker)) |
        if length == 0 then ""
        elif length == 1 and (.[0].id | type == "string" and test("^[0-9a-fA-F-]{36}$")) then .[0].id
        else error("ambiguous marked auth user")
        end
      ' "$HTTP_BODY" 2>/dev/null)" || {
        log "CLEANUP ERROR: marked auth-user recovery was ambiguous or malformed."
        cleanup_failed=1
        break
      }
      [ -z "$recovered_id" ] || break
      [ "$row_count" -eq 1000 ] || break
    done
    if [ -z "$recovered_id" ] && [ "${row_count:-0}" -eq 1000 ] && [ "$page" -eq 10 ]; then
      log "CLEANUP ERROR: marked auth-user recovery exceeded its bounded search."
      cleanup_failed=1
    fi
    [ -z "$recovered_id" ] || USER_ID="$recovered_id"
  fi

  if [ -n "$USER_ID" ]; then
    if ! service_request cleanup-user-read GET "$KONG_URL/auth/v1/admin/users/$USER_ID"; then
      log "CLEANUP ERROR: could not read the marked auth user."
      cleanup_failed=1
    elif [ "$HTTP_CODE" = 404 ]; then
      :
    elif [ "$HTTP_CODE" = 200 ] && jq -e \
      --arg id "$USER_ID" --arg email "$EMAIL" --arg marker "$MARKER" \
      '.id == $id and .email == $email and .user_metadata.aria_acceptance_marker == $marker' \
      "$HTTP_BODY" >/dev/null; then
      printf '{"should_soft_delete":false}\n' > "$WORK/delete-user.json"
      if ! service_request cleanup-user-delete DELETE \
        "$KONG_URL/auth/v1/admin/users/$USER_ID" "$WORK/delete-user.json"; then
        log "CLEANUP ERROR: marked auth-user deletion request failed."
        cleanup_failed=1
      elif [ "$HTTP_CODE" != 200 ] && [ "$HTTP_CODE" != 204 ]; then
        log "CLEANUP ERROR: marked auth-user deletion returned HTTP $HTTP_CODE."
        cleanup_failed=1
      fi
    else
      log "CLEANUP ERROR: auth-user identity or acceptance marker did not match; refusing deletion."
      cleanup_failed=1
    fi
  fi

  if [ -n "$WORKSPACE_ID" ]; then
    workspace_query="$KONG_URL/rest/v1/workspaces?id=eq.$WORKSPACE_ID&select=id,name,allowed_domain"
    state_query="$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$WORKSPACE_ID&select=workspace_id,state"
    if ! service_request cleanup-workspace-read GET "$workspace_query"; then
      log "CLEANUP ERROR: could not read the marked workspace."
      cleanup_failed=1
    elif [ "$HTTP_CODE" != 200 ]; then
      log "CLEANUP ERROR: workspace marker lookup returned HTTP $HTTP_CODE."
      cleanup_failed=1
    elif [ "$(jq 'length' "$HTTP_BODY")" -eq 0 ]; then
      :
    elif jq -e --arg id "$WORKSPACE_ID" --arg marker "$MARKER" \
      'type == "array" and length == 1 and .[0].id == $id and .[0].name == $marker and .[0].allowed_domain == null' \
      "$HTTP_BODY" >/dev/null; then
      if ! service_request cleanup-state-read GET "$state_query"; then
        log "CLEANUP ERROR: could not verify the workspace-state marker."
        cleanup_failed=1
      elif [ "$HTTP_CODE" != 200 ] || ! jq -e --arg marker "$MARKER" \
        'type == "array" and (length == 0 or (length == 1 and .[0].state.ariaAcceptanceMarker == $marker))' \
        "$HTTP_BODY" >/dev/null; then
        log "CLEANUP ERROR: workspace state was not empty or marked by this acceptance run; refusing deletion."
        cleanup_failed=1
      elif ! service_request cleanup-workspace-delete DELETE \
        "$KONG_URL/rest/v1/workspaces?id=eq.$WORKSPACE_ID&name=eq.$MARKER_URI" "" "return=representation"; then
        log "CLEANUP ERROR: marked workspace deletion request failed."
        cleanup_failed=1
      elif [ "$HTTP_CODE" != 200 ] && [ "$HTTP_CODE" != 204 ]; then
        log "CLEANUP ERROR: marked workspace deletion returned HTTP $HTTP_CODE."
        cleanup_failed=1
      elif [ "$HTTP_CODE" = 200 ] && ! jq -e --arg id "$WORKSPACE_ID" --arg marker "$MARKER" \
        'type == "array" and length == 1 and .[0].id == $id and .[0].name == $marker' \
        "$HTTP_BODY" >/dev/null; then
        log "CLEANUP ERROR: workspace deletion did not return the exact marked row."
        cleanup_failed=1
      fi
    else
      log "CLEANUP ERROR: workspace identity or acceptance marker did not match; refusing deletion."
      cleanup_failed=1
    fi
  fi

  if [ -n "$USER_ID" ]; then
    if ! service_request cleanup-user-absence GET "$KONG_URL/auth/v1/admin/users/$USER_ID"; then
      cleanup_failed=1
    elif [ "$HTTP_CODE" != 404 ]; then
      log "CLEANUP ERROR: marked auth user still exists."
      cleanup_failed=1
    fi
    if ! service_request cleanup-profile-absence GET \
      "$KONG_URL/rest/v1/profiles?id=eq.$USER_ID&select=id"; then
      cleanup_failed=1
    elif [ "$HTTP_CODE" != 200 ] || [ "$(jq 'length' "$HTTP_BODY")" -ne 0 ]; then
      log "CLEANUP ERROR: marked public profile still exists."
      cleanup_failed=1
    fi
  fi

  if [ -n "$WORKSPACE_ID" ]; then
    workspace_query="$KONG_URL/rest/v1/workspaces?id=eq.$WORKSPACE_ID&select=id"
    state_query="$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$WORKSPACE_ID&select=workspace_id"
    if ! service_request cleanup-workspace-absence GET "$workspace_query"; then
      cleanup_failed=1
    elif [ "$HTTP_CODE" != 200 ] || [ "$(jq 'length' "$HTTP_BODY")" -ne 0 ]; then
      log "CLEANUP ERROR: marked workspace still exists."
      cleanup_failed=1
    fi
    if ! service_request cleanup-state-absence GET "$state_query"; then
      cleanup_failed=1
    elif [ "$HTTP_CODE" != 200 ] || [ "$(jq 'length' "$HTTP_BODY")" -ne 0 ]; then
      log "CLEANUP ERROR: marked workspace state still exists."
      cleanup_failed=1
    fi
  fi

  if [ "$cleanup_failed" -eq 0 ]; then
    CLEANUP_VERIFIED=1
    return 0
  fi
  return 1
}

on_exit() {
  local main_status=$?
  local cleanup_status=0
  local completed_at
  trap - EXIT HUP INT TERM
  set +e
  cleanup_exact
  cleanup_status=$?
  rm -rf "$WORK"
  unset ACCEPTANCE_ANON_KEY ACCEPTANCE_SERVICE_ROLE_KEY PASSWORD ACCESS_TOKEN APP_COOKIE_HEADER EMAIL

  if [ "$main_status" -eq 0 ] && [ "$MAIN_COMPLETE" -eq 1 ] && \
     [ "$cleanup_status" -eq 0 ] && [ "$CLEANUP_VERIFIED" -eq 1 ]; then
    completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    jq -n \
      --arg completedAt "$completed_at" \
      --arg runMarkerSha256 "$MARKER_SHA256" \
      --arg releaseSha "$ARIA_RELEASE_SHA" \
      '{
        schemaVersion: 1,
        releaseSha: $releaseSha,
        acceptance: "aria-authenticated-campaign-dry-run",
        status: "passed",
        completedAt: $completedAt,
        runMarkerSha256: $runMarkerSha256,
        checks: {
          ephemeralWorkspaceAllowedDomain: null,
          authenticatedWorkspaceBinding: true,
          appSessionAuthority: true,
          agentMemoryProvenanceBoundary: true,
          agentMemoryFreeTextCreateBlocked: true,
          agentMemoryFreeTextEditBlocked: true,
          agentMemoryReadAvailable: true,
          agentMemoryMetadataEditAvailable: true,
          agentMemoryReviewAvailable: true,
          agentMemoryDeleteAvailable: true,
          authenticatedStateReload: true,
          campaignDryRunMode: true,
          draftStatus: "Needs Approval",
          emailConfirmLiveFalse: "dry-run",
          linkedinPolicy: "manual-required",
          outreachLedgerRows: 0,
          messagesOutboundRows: 0,
          cleanupVerified: true
        },
        safety: {
          syntheticDataOnly: true,
          tenantMutation: "unique-ephemeral-workspace-only",
          liveSendIntentProvided: false,
          requestsWithConfirmLiveTrue: 0,
          providerCallPreventionProof: "exact-sha-ci-normal-tenant-route-counters"
        }
      }'
    exit $?
  fi

  [ "$cleanup_status" -eq 0 ] || log "ERROR: acceptance cleanup could not be fully verified; no receipt emitted."
  [ "$main_status" -ne 0 ] && exit "$main_status"
  exit 1
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

log "Creating a uniquely marked ephemeral workspace."
WORKSPACE_BODY="$WORK/create-workspace.json"
jq -n --arg name "$MARKER" '{name:$name,allowed_domain:null}' > "$WORKSPACE_BODY"
service_request create-workspace POST \
  "$KONG_URL/rest/v1/workspaces?select=id,name,allowed_domain" \
  "$WORKSPACE_BODY" "return=representation" || fail "workspace creation request failed."
[ "$HTTP_CODE" = 201 ] || fail "workspace creation returned HTTP $HTTP_CODE."
WORKSPACE_ID="$(jq -er '
  select(type == "array" and length >= 1) | .[0].id |
  select(type == "string" and test("^[0-9a-fA-F-]{36}$"))
' "$HTTP_BODY")" || fail "workspace creation did not return a usable workspace identity."
jq -e --arg id "$WORKSPACE_ID" --arg marker "$MARKER" '
  type == "array" and length == 1 and .[0].id == $id and
  .[0].name == $marker and .[0].allowed_domain == null
' "$HTTP_BODY" >/dev/null || fail "workspace creation did not return the exact marked null-domain workspace."

log "Creating the synthetic plus-address auth user."
CREATE_USER_BODY="$WORK/create-user.json"
printf '%s' "$PASSWORD" | jq -Rs --arg email "$EMAIL" --arg marker "$MARKER" '
  {email:$email,password:.,email_confirm:true,user_metadata:{aria_acceptance_marker:$marker}}
' > "$CREATE_USER_BODY"
service_request create-user POST "$KONG_URL/auth/v1/admin/users" "$CREATE_USER_BODY" || \
  fail "auth-user creation request failed."
[ "$HTTP_CODE" = 200 ] || [ "$HTTP_CODE" = 201 ] || fail "auth-user creation returned HTTP $HTTP_CODE."
USER_ID="$(jq -er '.id |
  select(type == "string" and test("^[0-9a-fA-F-]{36}$"))
' "$HTTP_BODY")" || fail "auth-user creation did not return a usable user identity."
jq -e --arg id "$USER_ID" --arg email "$EMAIL" --arg marker "$MARKER" '
  .id == $id and .email == $email and .user_metadata.aria_acceptance_marker == $marker
' "$HTTP_BODY" >/dev/null || fail "auth-user creation did not return the exact marked user."

log "Binding the synthetic profile as admin to the exact ephemeral workspace."
PROFILE_BODY="$WORK/create-profile.json"
jq -n \
  --arg id "$USER_ID" --arg email "$EMAIL" --arg workspace "$WORKSPACE_ID" \
  '{id:$id,email:$email,full_name:"ARIA Acceptance",workspace_id:$workspace,role:"admin"}' \
  > "$PROFILE_BODY"
service_request create-profile POST \
  "$KONG_URL/rest/v1/profiles?select=id,workspace_id,role" \
  "$PROFILE_BODY" "return=representation" || fail "profile binding request failed."
[ "$HTTP_CODE" = 201 ] || fail "profile binding returned HTTP $HTTP_CODE."
jq -e --arg id "$USER_ID" --arg workspace "$WORKSPACE_ID" '
  type == "array" and length == 1 and .[0].id == $id and
  .[0].workspace_id == $workspace and .[0].role == "admin"
' "$HTTP_BODY" >/dev/null || fail "profile was not bound as admin to the exact ephemeral workspace."

log "Signing in and proving tenant authority."
LOGIN_BODY="$WORK/login.json"
printf '%s' "$PASSWORD" | jq -Rs --arg email "$EMAIL" '{email:$email,password:.}' > "$LOGIN_BODY"
request sign-in POST "$KONG_URL/auth/v1/token?grant_type=password" \
  "$ACCEPTANCE_ANON_KEY" "$ACCEPTANCE_ANON_KEY" "$LOGIN_BODY" || \
  fail "synthetic-user sign-in request failed."
[ "$HTTP_CODE" = 200 ] || fail "synthetic-user sign-in returned HTTP $HTTP_CODE."
ACCESS_TOKEN="$(jq -er '.access_token | select(type == "string" and length > 0)' "$HTTP_BODY")" || \
  fail "synthetic-user sign-in returned no access token."
SESSION_RESPONSE="$HTTP_BODY"

RPC_BODY="$WORK/rpc.json"
printf '{}\n' > "$RPC_BODY"
authenticated_request current-workspace POST \
  "$KONG_URL/rest/v1/rpc/current_workspace_id" "$RPC_BODY" || fail "current_workspace_id request failed."
[ "$HTTP_CODE" = 200 ] || fail "current_workspace_id returned HTTP $HTTP_CODE."
[ "$(jq -er 'select(type == "string")' "$HTTP_BODY")" = "$WORKSPACE_ID" ] || \
  fail "authenticated current_workspace_id did not match the ephemeral workspace."
authenticated_request current-role POST \
  "$KONG_URL/rest/v1/rpc/current_profile_role" "$RPC_BODY" || fail "current_profile_role request failed."
[ "$HTTP_CODE" = 200 ] || fail "current_profile_role returned HTTP $HTTP_CODE."
[ "$(jq -er 'select(type == "string")' "$HTTP_BODY")" = admin ] || \
  fail "authenticated profile is not admin."

jq -cj '.' "$SESSION_RESPONSE" > "$WORK/session.json"
COOKIE_VALUE="base64-$(openssl base64 -A -in "$WORK/session.json" | tr '+/' '-_' | tr -d '=')"
if [ "${#COOKIE_VALUE}" -le 3180 ]; then
  APP_COOKIE_HEADER="sb-auth-token=$COOKIE_VALUE"
else
  cookie_offset=0
  cookie_index=0
  while [ "$cookie_offset" -lt "${#COOKIE_VALUE}" ]; do
    cookie_part="${COOKIE_VALUE:cookie_offset:3180}"
    if [ -z "$APP_COOKIE_HEADER" ]; then
      APP_COOKIE_HEADER="sb-auth-token.${cookie_index}=${cookie_part}"
    else
      APP_COOKIE_HEADER="$APP_COOKIE_HEADER; sb-auth-token.${cookie_index}=${cookie_part}"
    fi
    cookie_offset=$((cookie_offset + 3180))
    cookie_index=$((cookie_index + 1))
  done
fi
unset COOKIE_VALUE cookie_part

log "Proving that the signed-in cookie is authoritative in the app runtime."
app_request app-session GET "$APP_URL/api/agents/specs" || fail "app-session authority probe failed."
[ "$HTTP_CODE" = 200 ] || fail "app-session authority probe returned HTTP $HTTP_CODE."
jq -e '.ok == true and .specs == []' "$HTTP_BODY" >/dev/null || \
  fail "the app session did not resolve the empty ephemeral workspace."

log "Proving the production agent-memory provenance boundary through the authenticated app API."
AGENT_SPEC_BODY="$WORK/agent-spec.json"
jq -n '{
  name:"ARIA acceptance memory boundary",
  role_brief:{title:"Synthetic acceptance memory boundary"},
  channels:["Email"],
  guardrails:{autopilot:false,canary_remaining:0,topics_allow:[]}
}' > "$AGENT_SPEC_BODY"
app_request create-agent-spec POST "$APP_URL/api/agents/specs" "$AGENT_SPEC_BODY" || \
  fail "agent-spec creation request failed."
[ "$HTTP_CODE" = 200 ] || fail "agent-spec creation returned HTTP $HTTP_CODE."
SPEC_ID="$(jq -er '.id | select(type == "string" and test("^[0-9a-fA-F-]{36}$"))' "$HTTP_BODY")" || \
  fail "agent-spec creation returned no valid identifier."

app_request memory-read GET "$APP_URL/api/agents/memories?specId=$SPEC_ID" || \
  fail "agent-memory read request failed."
[ "$HTTP_CODE" = 200 ] || fail "agent-memory read returned HTTP $HTTP_CODE."
jq -e --arg spec "$SPEC_ID" '
  .ok == true and .memories == [] and
  ([.specs[] | select(.id == $spec)] | length) == 1
' "$HTTP_BODY" >/dev/null || fail "agent-memory read did not resolve the created spec."
require_no_store "agent-memory read"

MEMORY_CREATE_BODY="$WORK/memory-create.json"
jq -n --arg spec "$SPEC_ID" '{
  specId:$spec,kind:"fact",content:"Synthetic free-text memory must be blocked.",
  candidateProvenance:{classification:"none"},pinned:false,expiresAt:null
}' > "$MEMORY_CREATE_BODY"
app_request memory-create-blocked POST "$APP_URL/api/agents/memories" "$MEMORY_CREATE_BODY" || \
  fail "agent-memory create boundary request failed."
[ "$HTTP_CODE" = 403 ] || fail "agent-memory free-text create returned HTTP $HTTP_CODE."
jq -e '.ok == false and .code == "memory_content_writes_disabled"' "$HTTP_BODY" >/dev/null || \
  fail "agent-memory free-text create did not return memory_content_writes_disabled."
require_no_store "agent-memory free-text create"

MISSING_MEMORY_ID="11111111-1111-4111-8111-111111111112"
MEMORY_CONTENT_EDIT_BODY="$WORK/memory-content-edit.json"
jq -n --arg spec "$SPEC_ID" --arg id "$MISSING_MEMORY_ID" '{
  action:"edit",id:$id,specId:$spec,revision:1,kind:"fact",
  content:"Synthetic free-text edit must be blocked.",
  candidateProvenance:{classification:"none"}
}' > "$MEMORY_CONTENT_EDIT_BODY"
app_request memory-content-edit-blocked PATCH "$APP_URL/api/agents/memories" "$MEMORY_CONTENT_EDIT_BODY" || \
  fail "agent-memory content-edit boundary request failed."
[ "$HTTP_CODE" = 403 ] || fail "agent-memory free-text edit returned HTTP $HTTP_CODE."
jq -e '.ok == false and .code == "memory_content_writes_disabled"' "$HTTP_BODY" >/dev/null || \
  fail "agent-memory free-text edit did not return memory_content_writes_disabled."
require_no_store "agent-memory free-text edit"

MEMORY_METADATA_EDIT_BODY="$WORK/memory-metadata-edit.json"
jq -n --arg spec "$SPEC_ID" --arg id "$MISSING_MEMORY_ID" '{
  action:"edit",id:$id,specId:$spec,revision:1,pinned:true
}' > "$MEMORY_METADATA_EDIT_BODY"
app_request memory-metadata-edit PATCH "$APP_URL/api/agents/memories" "$MEMORY_METADATA_EDIT_BODY" || \
  fail "agent-memory metadata-edit availability request failed."
[ "$HTTP_CODE" = 404 ] || fail "agent-memory metadata edit returned HTTP $HTTP_CODE instead of the expected missing-row result."
jq -e '.ok == false and .code == "memory_not_found"' "$HTTP_BODY" >/dev/null || \
  fail "agent-memory metadata edit did not reach memory authority."
require_no_store "agent-memory metadata edit"

MEMORY_REVIEW_BODY="$WORK/memory-review.json"
jq -n --arg spec "$SPEC_ID" --arg id "$MISSING_MEMORY_ID" '{
  action:"approve",id:$id,specId:$spec,revision:1
}' > "$MEMORY_REVIEW_BODY"
app_request memory-review PATCH "$APP_URL/api/agents/memories" "$MEMORY_REVIEW_BODY" || \
  fail "agent-memory review availability request failed."
[ "$HTTP_CODE" = 404 ] || fail "agent-memory review returned HTTP $HTTP_CODE instead of the expected missing-row result."
jq -e '.ok == false and .code == "memory_not_found"' "$HTTP_BODY" >/dev/null || \
  fail "agent-memory review did not reach memory authority."
require_no_store "agent-memory review"

MEMORY_DELETE_BODY="$WORK/memory-delete.json"
jq -n --arg spec "$SPEC_ID" --arg id "$MISSING_MEMORY_ID" '{
  id:$id,specId:$spec,revision:1
}' > "$MEMORY_DELETE_BODY"
app_request memory-delete DELETE "$APP_URL/api/agents/memories" "$MEMORY_DELETE_BODY" || \
  fail "agent-memory delete availability request failed."
[ "$HTTP_CODE" = 404 ] || fail "agent-memory delete returned HTTP $HTTP_CODE instead of the expected missing-row result."
jq -e '.ok == false and .code == "memory_not_found"' "$HTTP_BODY" >/dev/null || \
  fail "agent-memory delete did not reach memory authority."
require_no_store "agent-memory delete"

log "Persisting and reloading the synthetic dry-run campaign through authenticated PostgREST."
STATE_BODY="$WORK/workspace-state.json"
NOW="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
TARGET_DATE="$(date -u -v+30d +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+30 days' +'%Y-%m-%dT%H:%M:%SZ')"
jq -n \
  --arg workspace "$WORKSPACE_ID" --arg marker "$MARKER" --arg campaign "$CAMPAIGN_ID" \
  --arg message "$MESSAGE_ID" --arg candidate "$CANDIDATE_ID" --arg now "$NOW" --arg target "$TARGET_DATE" '
  {
    workspace_id:$workspace,
    state:{
      version:17,
      ariaAcceptanceMarker:$marker,
      campaigns:[{
        id:$campaign,
        title:"ARIA Acceptance Synthetic Campaign",
        department:"Quality Assurance",
        urgency:"Standard",
        status:"Outreach",
        hiringManager:"Acceptance Harness",
        hiringManagerEmail:"acceptance@example.invalid",
        createdAt:$now,
        targetStartDate:$target,
        jobAnalysis:{
          title:"Synthetic Acceptance Role",department:"Quality Assurance",seniority:"Senior",
          employmentType:"Full-time",locationType:"Remote",regions:[],timezone:"UTC",
          salaryMin:null,salaryMax:null,currency:"USD",equity:false,requiredSkills:["Testing"],
          niceToHaveSkills:[],minYearsExperience:null,maxYearsExperience:null,education:"",
          industryExperience:[],companyStageTarget:[],teamSize:"",reportingTo:"",
          urgency:"Standard",validationWarnings:[]
        },
        sourcingStrategy:{
          primaryPlatforms:[],secondaryPlatforms:[],githubQueries:[],linkedinBoolean:"",
          stackOverflowTags:[],geoTargets:[],excludedCompanies:[],targetCompanyStages:[]
        },
        scoringWeights:{skills:34,experience:22,companyStage:12,industry:12,location:10,activity:10},
        metrics:{
          sourced:0,contacted:0,replied:0,interested:0,booked:0,interviewed:0,offer:0,hired:0,
          notInterested:0,replyRate:0,avgMatchScore:0,timeToFirstInterviewHours:null,
          emailsSentToday:0,linkedinSentToday:0
        },
        skillUpdates:[],activities:[],acceptance:{synthetic:true,dryRunMode:true}
      }],
      candidates:[],
      outreach:[{
        id:$message,candidateId:$candidate,campaignId:$campaign,channel:"LinkedIn",
        subject:"Synthetic acceptance draft",body:"Synthetic acceptance draft. No delivery is permitted.",
        tone:"Casual Professional",personalizationEvidence:[],status:"Needs Approval",sequenceStep:1,
        scheduledFor:null,sentAt:null,approvedBy:null,dryRun:true,createdAt:$now
      }],
      replies:[],bookings:[],wins:[],interviewers:[],reports:[],integrations:[],activities:[],
      settings:{
        humanApprovalGate:true,dryRunMode:true,webResearch:false,minScoreToContact:70,
        starRatingThresholds:{topGun:88,a:80,b:65,c:50},slaMinutes:15,
        operatorName:"ARIA Acceptance",systemIdentity:"Aria Sourcing",
        rateLimits:{emailsPerDay:1,linkedinPerDay:1,followUpGapDays:3,suppressionDays:90},
        compliance:{
          candidateRetentionDays:1,jdRetentionDays:1,emailContentRetentionDays:1,
          crmAuditLogs:true,unsubscribeEnforcement:true,ccpaDoNotSell:true,gdprMode:true
        },
        fleet:{
          recontactWindowDays:90,bounceRatePauseThreshold:0.05,complaintRatePauseThreshold:0.001,
          enforceBusinessHours:true,jitter:true,globalDailyCap:0,maxAgents:0
        },
        confidentialityMode:true,defaultLanguage:"en",soundEnabled:false,
        guardrails:{ariaPrompt:"Synthetic acceptance only.",rules:[]},
        notifications:{slack:false,telegram:false,email:false},
        llmProviders:[],savedModels:[],tools:[],mcpServers:[],defaultModels:{},
        hermesLiveMode:false,hermesApiUrl:"",hermesApiKeyId:"",memoryCapacity:0,hermesWebUrl:""
      },
      seats:[],suppression:[],ledger:[],skills:[],apiKeys:[],chats:[],memory:[],schedules:[],
      ingestedMessageIds:[],chatboxSubmissions:[],activeCampaignId:$campaign
    }
  }
' > "$STATE_BODY"
authenticated_request persist-state POST \
  "$KONG_URL/rest/v1/workspace_state?on_conflict=workspace_id&select=workspace_id,state" \
  "$STATE_BODY" "resolution=merge-duplicates,return=representation" || fail "authenticated state persistence failed."
[ "$HTTP_CODE" = 200 ] || [ "$HTTP_CODE" = 201 ] || fail "state persistence returned HTTP $HTTP_CODE."

authenticated_request reload-state GET \
  "$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$WORKSPACE_ID&select=workspace_id,state" || \
  fail "authenticated state reload failed."
[ "$HTTP_CODE" = 200 ] || fail "state reload returned HTTP $HTTP_CODE."
jq -e \
  --arg workspace "$WORKSPACE_ID" --arg marker "$MARKER" --arg campaign "$CAMPAIGN_ID" --arg message "$MESSAGE_ID" '
  type == "array" and length == 1 and .[0].workspace_id == $workspace and
  .[0].state.ariaAcceptanceMarker == $marker and
  .[0].state.settings.dryRunMode == true and .[0].state.settings.humanApprovalGate == true and
  ([.[0].state.campaigns[] | select(.id == $campaign and .acceptance.dryRunMode == true)] | length) == 1 and
  ([.[0].state.outreach[] | select(.id == $message and .status == "Needs Approval" and .dryRun == true)] | length) == 1
' "$HTTP_BODY" >/dev/null || fail "reloaded state did not contain the exact dry-run campaign and approval draft."

log "Exercising the authenticated no-send paths."
EMAIL_SEND_BODY="$WORK/email-dry-run.json"
jq -n --arg message "$MESSAGE_ID" --arg candidate "$CANDIDATE_ID" --arg campaign "$CAMPAIGN_ID" '
  {
    messageId:$message,candidateId:$candidate,candidateEmail:"acceptance-recipient@example.invalid",
    campaignId:$campaign,subject:"Synthetic acceptance draft",
    body:"Synthetic acceptance draft. No delivery is permitted.",channel:"Email",confirmLive:false
  }
' > "$EMAIL_SEND_BODY"
app_request email-dry-run POST "$APP_URL/api/outreach/send" "$EMAIL_SEND_BODY" || \
  fail "email dry-run request failed."
[ "$HTTP_CODE" = 200 ] || fail "email confirmLive=false returned HTTP $HTTP_CODE."
[ "$(jq -er '.status | select(type == "string")' "$HTTP_BODY")" = dry-run ] || \
  fail "email confirmLive=false did not return dry-run."

LINKEDIN_SEND_BODY="$WORK/linkedin-manual.json"
jq '.channel = "LinkedIn"' "$EMAIL_SEND_BODY" > "$LINKEDIN_SEND_BODY"
app_request linkedin-manual POST "$APP_URL/api/outreach/send" "$LINKEDIN_SEND_BODY" || \
  fail "LinkedIn manual-only request failed."
[ "$HTTP_CODE" = 409 ] || fail "LinkedIn manual-only path returned HTTP $HTTP_CODE."
[ "$(jq -er '.status | select(type == "string")' "$HTTP_BODY")" = manual-required ] || \
  fail "LinkedIn did not return manual-required."

log "Proving that no delivery ledger or outbound row was created."
service_request ledger-zero GET \
  "$KONG_URL/rest/v1/outreach_ledger?workspace_id=eq.$WORKSPACE_ID&select=id&limit=1" || \
  fail "outreach-ledger verification failed."
[ "$HTTP_CODE" = 200 ] && [ "$(jq 'length' "$HTTP_BODY")" -eq 0 ] || \
  fail "the ephemeral workspace contains an outreach-ledger row."
service_request outbox-zero GET \
  "$KONG_URL/rest/v1/messages_outbound?workspace_id=eq.$WORKSPACE_ID&select=id&limit=1" || \
  fail "outbound-table verification failed."
[ "$HTTP_CODE" = 200 ] && [ "$(jq 'length' "$HTTP_BODY")" -eq 0 ] || \
  fail "the ephemeral workspace contains an outbound-message row."

MAIN_COMPLETE=1
log "Acceptance checks passed; cleanup and absence verification will now decide receipt issuance."
exit 0
