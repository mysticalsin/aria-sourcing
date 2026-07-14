#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-agent-authority-rollback-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -q -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin < "$migration" >/dev/null
done

assert_schema_state() {
  local expected="$1"
  psql_stdin -v expected_state="$expected" <<'SQL'
set aria.expected_state = :'expected_state';
do $$
declare
  expected text := current_setting('aria.expected_state');
  actual text;
begin
  select concat_ws(':',
    to_regprocedure('public.claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text)') is not null,
    to_regprocedure('public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)') is not null,
    to_regprocedure('public.complete_agent_framework_run(uuid,uuid,text,text,integer,text,jsonb)') is not null,
    to_regprocedure('public.complete_agent_framework_run_v0029(uuid,uuid,text,text,integer,text)') is not null,
    to_regprocedure('public.complete_agent_framework_run(uuid,uuid,text,text,integer,text)') is not null,
    to_regprocedure('public.authorize_agent_framework_memory_egress(uuid,uuid)') is not null,
    to_regprocedure('public.release_agent_framework_memory_egress(uuid,uuid,uuid)') is not null,
    to_regprocedure('public.mutate_agent_memory(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamptz)') is not null,
    to_regclass('public.agent_framework_run_memory_context') is not null,
    to_regclass('public.agent_framework_memory_egress_leases') is not null,
    has_function_privilege(
      'service_role',
      'public.claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text)',
      'EXECUTE'
    ),
    case when to_regprocedure('public.authorize_agent_framework_memory_egress(uuid,uuid)') is null
      then false
      else has_function_privilege(
        'service_role',
        'public.authorize_agent_framework_memory_egress(uuid,uuid)',
        'EXECUTE'
      )
    end,
    (select count(*)=4 from pg_constraint
      where conname in (
        'agent_specs_workspace_seat_fkey',
        'messages_outbound_workspace_seat_fkey',
        'whatsapp_senders_workspace_seat_fkey',
        'email_connections_workspace_seat_fkey'
      )),
    to_regclass('public.candidate_erasure_requests') is not null,
    to_regprocedure('public.refresh_candidate_erasure_legal_hold_state(uuid)') is not null
  ) into actual;

  if actual is distinct from expected then
    raise exception '0032 rollback state %, expected %', actual, expected;
  end if;
end;
$$;
SQL
}

assert_schema_state 't:t:t:t:f:t:t:t:t:t:t:t:t:t:t'

psql_stdin < supabase/rollbacks/0032_agent_operational_authority.sql >/dev/null
assert_schema_state 't:f:f:f:t:f:f:f:t:t:t:f:t:t:t'

# Execute the restored 0029 fallback through its service-role contract. A null
# request must reach the function body and return its typed validation result.
psql_stdin <<'SQL'
select set_config('request.jwt.claim.role', 'service_role', false);
set role service_role;
do $$
declare
  result jsonb;
begin
  result := public.claim_agent_framework_run(
    null, null, null, null, null, null, null, null, null
  );
  if result->>'status' is distinct from 'invalid_request' then
    raise exception 'restored 0029 fallback returned %, expected invalid_request', result;
  end if;
end;
$$;
reset role;
SQL

# The restored completion RPC must also reach the original typed validation
# path, proving rollback did not leave the seven-argument wrapper exposed.
psql_stdin <<'SQL'
select set_config('request.jwt.claim.role', 'service_role', false);
set role service_role;
do $$
declare
  result jsonb;
begin
  result := public.complete_agent_framework_run(
    null, null, null, null, null, null
  );
  if result->>'status' is distinct from 'invalid_request' then
    raise exception 'restored 0029 completion returned %, expected invalid_request', result;
  end if;
end;
$$;
reset role;
SQL

# The protected rollback must be idempotent for a retried operator command.
psql_stdin < supabase/rollbacks/0032_agent_operational_authority.sql >/dev/null
assert_schema_state 't:f:f:f:t:f:f:f:t:t:t:f:t:t:t'

# Forward recovery restores the exact application contract without destroying
# retained memory receipts, lease evidence, or workspace-seat constraints.
psql_stdin < supabase/migrations/0032_agent_operational_authority.sql >/dev/null
assert_schema_state 't:t:t:t:f:t:t:t:t:t:t:t:t:t:t'
psql_stdin < supabase/migrations/0032_agent_operational_authority.sql >/dev/null
assert_schema_state 't:t:t:t:f:t:t:t:t:t:t:t:t:t:t'

echo "RESULT agent-operational-authority-rollback-db: passed"
