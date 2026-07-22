#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-gotrue-identity-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
compose_fixture="tests/fixtures/gotrue-active-identity.compose.yml"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
gotrue_image="supabase/gotrue:v2.189.0@sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf"
network="${project}_default"
export DB_HOST_PORT=0

compose() {
  docker compose -p "$project" \
    -f docker-compose.yml \
    -f "$compose_fixture" \
    "$@"
}

cleanup() {
  unset ACCESS_TOKEN JWT_SECRET POSTGRES_PASSWORD AUTH_ADMIN_PASSWORD OWNER_PASSWORD 2>/dev/null || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf '[gotrue-active-identity] ERROR: %s\n' "$*" >&2
  exit 1
}

wait_for_health() {
  local service="$1" container_id health_state="" attempt
  for attempt in $(seq 1 90); do
    container_id="$(compose ps -q "$service")"
    if [ -n "$container_id" ]; then
      health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      [ "$health_state" = healthy ] && return 0
      [ "$health_state" = exited ] && break
    fi
    sleep 2
  done
  compose logs "$service" >&2 || true
  fail "$service did not become healthy (last state: ${health_state:-missing})"
}

wait_for_http() {
  local origin="$1" service="$2" attempt
  for attempt in $(seq 1 90); do
    if HTTP_PROBE_ORIGIN="$origin" node --input-type=module <<'NODE' >/dev/null 2>&1
const response = await fetch(process.env.HTTP_PROBE_ORIGIN, {
  headers: { accept: "application/openapi+json" },
}).catch(() => null);
process.exit(response?.status && response.status < 500 ? 0 : 1);
NODE
    then
      return 0
    fi
    sleep 2
  done
  compose logs "$service" >&2 || true
  fail "$service did not serve HTTP within the readiness window"
}

psql_as() {
  local role="$1" password="$2"
  shift 2
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$password" \
    --env "PGOPTIONS=-c client_min_messages=warning" \
    --entrypoint psql \
    "$client_image" \
    -X -w -v ON_ERROR_STOP=1 -h db -U "$role" -d postgres "$@"
}

psql_postgres() {
  psql_as postgres "$POSTGRES_PASSWORD" "$@"
}

psql_auth_owner() {
  psql_as supabase_auth_admin "$AUTH_ADMIN_PASSWORD" "$@"
}

psql_cluster_owner() {
  psql_as supabase_admin "$OWNER_PASSWORD" "$@"
}

run_http_probe() {
  local mode="$1"
  MODE="$mode" \
  AUTH_ORIGIN="$AUTH_ORIGIN" \
  REST_ORIGIN="$REST_ORIGIN" \
  TEST_EMAIL="$TEST_EMAIL" \
  TEST_PASSWORD="$TEST_PASSWORD" \
  TEST_USER_ID="${TEST_USER_ID:-}" \
  JWT_SECRET="$JWT_SECRET" \
  ACCESS_TOKEN="${ACCESS_TOKEN:-}" \
  node --input-type=module <<'NODE'
import { createHmac } from "node:crypto";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const serviceToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    iss: "aria-gotrue-active-identity-test",
    role: "service_role",
  });
  const signature = createHmac("sha256", required("JWT_SECRET"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

const readBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { response, body: await readBody(response) };
};

const requireSuccess = ({ response, body }, operation) => {
  if (!response.ok) {
    throw new Error(`${operation} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
};

const authOrigin = required("AUTH_ORIGIN");
const restOrigin = required("REST_ORIGIN");
const mode = required("MODE");
const email = required("TEST_EMAIL");
const password = required("TEST_PASSWORD");

if (mode === "provision") {
  const adminHeaders = {
    authorization: `Bearer ${serviceToken()}`,
    "content-type": "application/json",
  };
  const created = requireSuccess(await request(`${authOrigin}/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  }), "GoTrue admin user creation");
  const userId = created?.id ?? created?.user?.id;
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("GoTrue admin user creation omitted a valid UUID");
  }

  const signedIn = requireSuccess(await request(`${authOrigin}/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }), "GoTrue password sign-in");
  const accessToken = signedIn?.access_token;
  if (typeof accessToken !== "string" || accessToken.split(".").length !== 3) {
    throw new Error("GoTrue password sign-in omitted an access token");
  }

  const authenticatedHeaders = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  const workspaceId = requireSuccess(await request(`${restOrigin}/rpc/ensure_workspace`, {
    method: "POST",
    headers: authenticatedHeaders,
    body: "{}",
  }), "PostgREST workspace provisioning");
  if (typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new Error("ensure_workspace omitted a valid workspace UUID");
  }

  const profiles = requireSuccess(await request(
    `${restOrigin}/profiles?id=eq.${encodeURIComponent(userId)}&select=id,workspace_id,role,email`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  ), "PostgREST profile read");
  if (!Array.isArray(profiles) || profiles.length !== 1) {
    throw new Error(`active identity profile visibility was ${JSON.stringify(profiles)}`);
  }
  const profile = profiles[0];
  if (
    profile.id !== userId ||
    profile.workspace_id !== workspaceId ||
    profile.role !== "admin" ||
    profile.email !== email
  ) {
    throw new Error(`provisioned profile did not match the GoTrue identity: ${JSON.stringify(profile)}`);
  }
  process.stdout.write(JSON.stringify({ userId, workspaceId, accessToken }));
} else if (mode === "expect-revoked") {
  const accessToken = required("ACCESS_TOKEN");
  const userId = required("TEST_USER_ID");
  const rpc = await request(`${restOrigin}/rpc/ensure_workspace`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (rpc.response.ok || ![401, 403].includes(rpc.response.status)) {
    throw new Error(`revoked identity provisioning returned HTTP ${rpc.response.status}: ${JSON.stringify(rpc.body)}`);
  }
  const profiles = requireSuccess(await request(
    `${restOrigin}/profiles?id=eq.${encodeURIComponent(userId)}&select=id`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  ), "revoked identity profile read");
  if (!Array.isArray(profiles) || profiles.length !== 0) {
    throw new Error(`revoked identity retained RLS visibility: ${JSON.stringify(profiles)}`);
  }
} else if (mode === "ban" || mode === "soft-delete") {
  const userId = required("TEST_USER_ID");
  const url = mode === "ban"
    ? `${authOrigin}/admin/users/${encodeURIComponent(userId)}`
    : `${authOrigin}/admin/users/${encodeURIComponent(userId)}`;
  const response = await request(url, {
    method: mode === "ban" ? "PUT" : "DELETE",
    headers: {
      authorization: `Bearer ${serviceToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      mode === "ban" ? { ban_duration: "24h" } : { should_soft_delete: true },
    ),
  });
  requireSuccess(response, `GoTrue admin ${mode}`);
} else {
  throw new Error(`unsupported MODE: ${mode}`);
}
NODE
}

command -v docker >/dev/null || fail "docker is required"
command -v jq >/dev/null || fail "jq is required"
command -v node >/dev/null || fail "node is required"
docker info >/dev/null
test -f "$compose_fixture" || fail "$compose_fixture is missing"

config_json="$(compose config --format json)"
resolved_gotrue_image="$(jq -er '.services.auth.image' <<<"$config_json")"
[ "$resolved_gotrue_image" = "$gotrue_image" ] || \
  fail "GoTrue image is not the reviewed digest: $resolved_gotrue_image"
POSTGRES_PASSWORD="$(jq -er '.services["db-init"].environment.POSTGRES_TARGET_PASSWORD' <<<"$config_json")"
AUTH_ADMIN_PASSWORD="$(jq -er '.services["db-init"].environment.SUPABASE_AUTH_ADMIN_TARGET_PASSWORD' <<<"$config_json")"
OWNER_PASSWORD="$(jq -er '.services["db-init"].environment.SUPABASE_ADMIN_TARGET_PASSWORD' <<<"$config_json")"
JWT_SECRET="$(jq -er '.services.auth.environment.GOTRUE_JWT_SECRET' <<<"$config_json")"
export POSTGRES_PASSWORD AUTH_ADMIN_PASSWORD OWNER_PASSWORD JWT_SECRET
unset config_json

compose up -d db db-init auth >/dev/null
wait_for_health auth
db_init_id="$(compose ps -aq db-init)"
[ -n "$db_init_id" ] || fail "db-init container is missing"
[ "$(docker inspect --format '{{.State.ExitCode}}' "$db_init_id")" = 0 ] || {
  compose logs db-init >&2 || true
  fail "db-init failed"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_postgres -q < "$migration" >/dev/null
done

compose up --no-deps -d rest >/dev/null
auth_port="$(compose port auth 9999 | awk -F: 'END {print $NF}')"
rest_port="$(compose port rest 3000 | awk -F: 'END {print $NF}')"
[[ "$auth_port" =~ ^[0-9]+$ ]] || fail "could not resolve the GoTrue host port"
[[ "$rest_port" =~ ^[0-9]+$ ]] || fail "could not resolve the PostgREST host port"
AUTH_ORIGIN="http://127.0.0.1:${auth_port}"
REST_ORIGIN="http://127.0.0.1:${rest_port}"
wait_for_http "$REST_ORIGIN/" rest
TEST_EMAIL="active.identity.${GITHUB_RUN_ID:-local}.$$@bridge.example.test"
TEST_PASSWORD="Aria-Identity-Bridge-Test-Password-42"
export AUTH_ORIGIN REST_ORIGIN TEST_EMAIL TEST_PASSWORD

provisioned="$(run_http_probe provision)"
TEST_USER_ID="$(jq -er '.userId' <<<"$provisioned")"
workspace_id="$(jq -er '.workspaceId' <<<"$provisioned")"
ACCESS_TOKEN="$(jq -er '.accessToken' <<<"$provisioned")"
export TEST_USER_ID ACCESS_TOKEN
unset provisioned

# This reproduces the production boundary: postgres is deliberately not a
# superuser or Auth member, auth.users has real GoTrue RLS with no policies,
# and only the Auth-owned bridge may inspect identity state.
psql_postgres -Atq <<'SQL' | grep -qx t || fail "Auth-owner bridge metadata or ACL contract failed"
with bridge as (
  select function_definition.*
    from pg_proc function_definition
   where function_definition.oid in (
     'auth.aria_current_active_identity()'::regprocedure,
     'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)'::regprocedure
   )
), bridge_acl as (
  select bridge.oid,
         bridge.proowner,
         function_acl.grantee,
         function_acl.privilege_type
    from bridge
    cross join lateral aclexplode(
      coalesce(bridge.proacl, acldefault('f', bridge.proowner))
    ) function_acl
)
select
  (select not rolsuper and not rolbypassrls
     from pg_roles where rolname = 'postgres')
  and (select not pg_has_role('postgres', oid, 'member')
         from pg_roles where rolname = 'supabase_auth_admin')
  and (select relrowsecurity and not relforcerowsecurity
         from pg_class where oid = 'auth.users'::regclass)
  and (select count(*) = 0 from pg_policy where polrelid = 'auth.users'::regclass)
  and (select pg_get_userbyid(proowner) = 'supabase_auth_admin'
              and prosecdef
              and provolatile = 's'
              and proretset
              and prorettype = 'pg_catalog.record'::regtype
              and proconfig = array['search_path=pg_catalog, pg_temp']::text[]
         from bridge
        where oid = 'auth.aria_current_active_identity()'::regprocedure)
  and (select pg_get_userbyid(proowner) = 'supabase_auth_admin'
              and prosecdef
              and provolatile = 'v'
              and not proretset
              and prorettype = 'pg_catalog.text'::regtype
              and proconfig = array['search_path=pg_catalog, pg_temp']::text[]
         from bridge
        where oid = 'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)'::regprocedure)
  and has_schema_privilege('postgres', 'auth', 'USAGE')
  and not has_schema_privilege('postgres', 'auth', 'CREATE')
  and has_function_privilege('postgres', 'auth.aria_current_active_identity()', 'EXECUTE')
  and has_function_privilege('postgres', 'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'auth.aria_current_active_identity()', 'EXECUTE')
  and not has_function_privilege('authenticator', 'auth.aria_current_active_identity()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'auth.aria_current_active_identity()', 'EXECUTE')
  and not has_function_privilege('service_role', 'auth.aria_current_active_identity()', 'EXECUTE')
  and not has_function_privilege('anon', 'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticator', 'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)', 'EXECUTE')
  and not exists (
    select 1
      from bridge_acl
     where privilege_type = 'EXECUTE'
       and grantee not in (
         proowner,
         (select oid from pg_roles where rolname = 'postgres')
       )
  );
SQL

workspace_proof="$(psql_cluster_owner -Atq -v user_id="$TEST_USER_ID" -v workspace_id="$workspace_id" <<'SQL'
select
  exists(select 1 from public.profiles where id = :'user_id'::uuid and workspace_id = :'workspace_id'::uuid and role = 'admin') || '|' ||
  exists(select 1 from public.workspaces where id = :'workspace_id'::uuid and allowed_domain = 'bridge.example.test') || '|' ||
  public.auth_identity_lifecycle_schema_ready();
SQL
)"
[ "$workspace_proof" = 'true|true|true' ] || \
  fail "workspace provisioning was not durably bound to the GoTrue identity ($workspace_proof)"

run_http_probe ban >/dev/null
psql_auth_owner -Atq -v user_id="$TEST_USER_ID" <<'SQL' | grep -qx t || \
  fail "GoTrue did not persist the ban"
select banned_until > now() from auth.users where id = :'user_id'::uuid;
SQL
run_http_probe expect-revoked >/dev/null

# GoTrue exposes confirmation as a generated confirmed_at value. Clear the
# real source field instead, then replay the exact token issued before the ban.
psql_auth_owner -Atq -v user_id="$TEST_USER_ID" <<'SQL' | grep -qx t || fail "unconfirmed identity state was not installed"
update auth.users
   set banned_until = null,
       email_confirmed_at = null,
       phone_confirmed_at = null
 where id = :'user_id'::uuid;
select confirmed_at is null from auth.users where id = :'user_id'::uuid;
SQL
run_http_probe expect-revoked >/dev/null

psql_auth_owner -q -v user_id="$TEST_USER_ID" <<'SQL'
update auth.users set email_confirmed_at = now() where id = :'user_id'::uuid;
SQL
run_http_probe soft-delete >/dev/null
psql_auth_owner -Atq -v user_id="$TEST_USER_ID" <<'SQL' | grep -qx t || \
  fail "GoTrue did not persist the soft delete"
select deleted_at is not null from auth.users where id = :'user_id'::uuid;
SQL
run_http_probe expect-revoked >/dev/null

printf '[gotrue-active-identity] PASS: pinned GoTrue, Auth-owner bridge ACL, workspace provisioning, and stale-token revocation\n'
