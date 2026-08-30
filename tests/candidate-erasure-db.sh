#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidate-erasure-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

race_dir=""
writer_pid=""
eraser_pid=""
authority_pid=""
inverse_writer_pid=""

cleanup() {
  if [[ -n "$writer_pid" ]]; then kill "$writer_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$eraser_pid" ]]; then kill "$eraser_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$authority_pid" ]]; then kill "$authority_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$inverse_writer_pid" ]]; then kill "$inverse_writer_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$race_dir" ]]; then
    rm -f \
      "$race_dir/writer.sql" \
      "$race_dir/writer.log" \
      "$race_dir/eraser.log" \
      "$race_dir/authority.sql" \
      "$race_dir/authority.log" \
      "$race_dir/inverse-writer.log"
    rmdir "$race_dir" >/dev/null 2>&1 || true
  fi
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
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin -q < "$migration"
done

psql_stdin -q < tests/db/candidate-erasure-authority.sql

# Ledger retries must not duplicate guards, receipts, or public routines.
psql_stdin -q < supabase/migrations/0033_candidate_erasure_authority.sql

# Two real PostgreSQL sessions reproduce the stale-writer race without sleeps:
# session 1 passes the reimport trigger and stays idle in its transaction;
# session 2 requests erasure and must wait for session 1's identity lock. Once
# session 1 commits, erasure must observe and scrub that newly committed row.
psql_stdin -q <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a3000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'race-admin@example.test', '', now(),
  '{}', '{}', now(), now()
);
insert into public.workspaces(id, name, allowed_domain) values (
  '33333333-3333-4333-8333-333333333333',
  'Erasure concurrency',
  'race.example.test'
);
insert into public.profiles(id, email, full_name, workspace_id, role) values (
  'a3000000-0000-4000-8000-000000000003',
  'race-admin@example.test',
  'Race Admin',
  '33333333-3333-4333-8333-333333333333',
  'admin'
);
insert into public.workspace_state(workspace_id, state) values (
  '33333333-3333-4333-8333-333333333333',
  '{
    "candidates":[
      {
        "id":"88888888-8888-4888-8888-888888888888",
        "campaignId":"race-campaign",
        "name":"Race Candidate",
        "email":"race-candidate@example.test",
        "phone":"+14155550999",
        "linkedinUrl":"",
        "githubUrl":"",
        "sourceUrl":"",
        "sourceExternalId":"",
        "sourceAuthorityId":"",
        "sourcePlatform":"Manual",
        "createdAt":"2026-07-14T00:00:00Z",
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      },
      {
        "id":"99999999-9999-4999-8999-999999999999",
        "campaignId":"inverse-race-campaign",
        "name":"Inverse Race Candidate",
        "email":"inverse-candidate@example.test",
        "phone":"+14155550888",
        "linkedinUrl":"",
        "githubUrl":"",
        "sourceUrl":"",
        "sourceExternalId":"",
        "sourceAuthorityId":"",
        "sourcePlatform":"Manual",
        "createdAt":"2026-07-14T00:00:00Z",
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      }
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'
);
SQL

race_dir="$(mktemp -d "${TMPDIR:-/tmp}/aria-erasure-race.XXXXXX")"
mkfifo "$race_dir/writer.sql"

docker run --rm -i \
  --network "$network" \
  --env PGPASSWORD="$bootstrap_password" \
  --env PGAPPNAME="aria-erasure-stale-writer" \
  --entrypoint psql \
  "$client_image" \
  -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres \
  < "$race_dir/writer.sql" > "$race_dir/writer.log" 2>&1 &
writer_pid=$!

exec 9>"$race_dir/writer.sql"
printf '%s\n' \
  'begin;' \
  "insert into public.messages_inbound(id,workspace_id,candidate_id,channel,from_address,body,provider_id) values ('89000000-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','88888888-8888-4888-8888-888888888888','Email','race-candidate@example.test','PII committed by stale writer',null);" \
  >&9

deadline=$((SECONDS + 30))
while [[ "$(psql_stdin -Atqc "select coalesce((select state from pg_stat_activity where application_name='aria-erasure-stale-writer'),'missing')")" != "idle in transaction" ]]; do
  if ! kill -0 "$writer_pid" >/dev/null 2>&1; then
    cat "$race_dir/writer.log" >&2
    echo "stale writer exited before holding its transaction" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    cat "$race_dir/writer.log" >&2
    echo "timed out waiting for stale writer transaction" >&2
    exit 1
  fi
done

psql_stdin -q > "$race_dir/eraser.log" 2>&1 <<'SQL' &
set application_name = 'aria-candidate-eraser';
set role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-000000000003","role":"service_role"}',
  false
);
select set_config(
  'request.jwt.claim.sub',
  'a3000000-0000-4000-8000-000000000003',
  false
);
select set_config('request.jwt.claim.role', 'service_role', false);
select public.request_candidate_erasure(
  '33333333-3333-4333-8333-333333333333',
  'a3000000-0000-4000-8000-000000000003',
  'race-campaign',
  '88888888-8888-4888-8888-888888888888',
  '89000000-0000-4000-8000-000000000002'
);
SQL
eraser_pid=$!

erasure_waited_for_writer=false
deadline=$((SECONDS + 30))
while kill -0 "$eraser_pid" >/dev/null 2>&1; do
  wait_event="$(psql_stdin -Atqc "select coalesce(wait_event_type,'') || ':' || coalesce(wait_event,'') from pg_stat_activity where application_name='aria-candidate-eraser'")"
  if [[ "$wait_event" == "Lock:advisory" ]]; then
    erasure_waited_for_writer=true
    break
  fi
  if (( SECONDS >= deadline )); then
    cat "$race_dir/eraser.log" >&2
    echo "timed out waiting for candidate erasure lock outcome" >&2
    exit 1
  fi
done

printf '%s\n' 'commit;' '\q' >&9
exec 9>&-
wait "$writer_pid"
writer_pid=""
wait "$eraser_pid"
eraser_pid=""

if [[ "$erasure_waited_for_writer" != "true" ]]; then
  cat "$race_dir/eraser.log" >&2
  echo "candidate erasure committed while the stale writer transaction remained open" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
do $assert_race_closed$
begin
  if exists (
    select 1
      from public.messages_inbound message
     where message.id = '89000000-0000-4000-8000-000000000001'
       and (
         message.candidate_id is not null
         or message.from_address <> ''
         or message.body <> 'Candidate data erased'
       )
  ) then
    raise exception 'stale writer committed candidate PII after erasure';
  end if;
  if not public.candidate_erasure_tombstone_exists(
    '33333333-3333-4333-8333-333333333333',
    'email',
    'race-candidate@example.test'
  ) then
    raise exception 'candidate erasure race test did not create the expected tombstone';
  end if;
end;
$assert_race_closed$;
SQL

# Inverse lock order: authority owns every normalized identity lock before a
# writer statement begins. The writer must block, then reject after erasure
# commits instead of continuing against the statement's pre-wait snapshot.
mkfifo "$race_dir/authority.sql"
docker run --rm -i \
  --network "$network" \
  --env PGPASSWORD="$bootstrap_password" \
  --env PGAPPNAME="aria-erasure-authority-holder" \
  --entrypoint psql \
  "$client_image" \
  -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres \
  < "$race_dir/authority.sql" > "$race_dir/authority.log" 2>&1 &
authority_pid=$!

exec 8>"$race_dir/authority.sql"
printf '%s\n' \
  'begin;' \
  "select pg_advisory_xact_lock(lock_key) from (select distinct public.candidate_erasure_identity_lock_key('33333333-3333-4333-8333-333333333333', identity.kind, identity.value) as lock_key from (values ('candidate_id','99999999-9999-4999-8999-999999999999'),('email','inverse-candidate@example.test'),('phone','+14155550888')) identity(kind,value)) locks where lock_key is not null order by lock_key;" \
  >&8

deadline=$((SECONDS + 30))
while [[ "$(psql_stdin -Atqc "select coalesce((select state from pg_stat_activity where application_name='aria-erasure-authority-holder'),'missing')")" != "idle in transaction" ]]; do
  if ! kill -0 "$authority_pid" >/dev/null 2>&1; then
    cat "$race_dir/authority.log" >&2
    echo "erasure authority exited before holding identity locks" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    cat "$race_dir/authority.log" >&2
    echo "timed out waiting for erasure authority identity locks" >&2
    exit 1
  fi
done

psql_stdin > "$race_dir/inverse-writer.log" 2>&1 <<'SQL' &
set application_name = 'aria-erasure-blocked-writer';
\set VERBOSITY verbose
insert into public.messages_inbound(
  id, workspace_id, candidate_id, channel, from_address, body, provider_id
) values (
  '89000000-0000-4000-8000-000000000003',
  '33333333-3333-4333-8333-333333333333',
  '99999999-9999-4999-8999-999999999999',
  'Email',
  'inverse-candidate@example.test',
  'PII from writer blocked behind erasure',
  null
);
SQL
inverse_writer_pid=$!

deadline=$((SECONDS + 30))
while [[ "$(psql_stdin -Atqc "select coalesce(wait_event_type,'') || ':' || coalesce(wait_event,'') from pg_stat_activity where application_name='aria-erasure-blocked-writer'")" != "Lock:advisory" ]]; do
  if ! kill -0 "$inverse_writer_pid" >/dev/null 2>&1; then
    cat "$race_dir/inverse-writer.log" >&2
    echo "inverse writer exited before waiting on erasure authority" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    cat "$race_dir/inverse-writer.log" >&2
    echo "timed out waiting for inverse writer advisory lock" >&2
    exit 1
  fi
done

printf '%s\n' \
  'set role service_role;' \
  "select set_config('request.jwt.claims','{\"sub\":\"a3000000-0000-4000-8000-000000000003\",\"role\":\"service_role\"}',false);" \
  "select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000003',false);" \
  "select set_config('request.jwt.claim.role','service_role',false);" \
  "select public.request_candidate_erasure('33333333-3333-4333-8333-333333333333','a3000000-0000-4000-8000-000000000003','inverse-race-campaign','99999999-9999-4999-8999-999999999999','89000000-0000-4000-8000-000000000004');" \
  'commit;' \
  '\q' \
  >&8
exec 8>&-

wait "$authority_pid"
authority_pid=""
if wait "$inverse_writer_pid"; then
  inverse_writer_pid=""
  cat "$race_dir/inverse-writer.log" >&2
  echo "writer blocked behind erasure unexpectedly committed candidate PII" >&2
  exit 1
fi
inverse_writer_pid=""

if ! grep -Eq '23514: candidate erasure tombstone blocks' "$race_dir/inverse-writer.log"; then
  cat "$race_dir/inverse-writer.log" >&2
  echo "inverse writer failed without the expected candidate erasure SQLSTATE" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
do $assert_inverse_race_closed$
begin
  if exists (
    select 1
      from public.messages_inbound message
     where message.id = '89000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'writer blocked behind erasure persisted a candidate row';
  end if;
  if not public.candidate_erasure_tombstone_exists(
    '33333333-3333-4333-8333-333333333333',
    'candidate_id',
    '99999999-9999-4999-8999-999999999999'
  ) then
    raise exception 'inverse candidate erasure race did not commit its tombstone';
  end if;
end;
$assert_inverse_race_closed$;
SQL

echo "RESULT candidate-erasure-db: tenant=bound legal-hold=active-expired-release idempotency=replayed local-scrub=transactional suppression=hmac-tombstone reimport=blocked concurrency=both-lock-orders provider=manual-evidence retryable=no-false-success receipts=content-free idempotence=pass"
