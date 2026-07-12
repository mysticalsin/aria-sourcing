#!/usr/bin/env bash
set -Eeuo pipefail

migration="supabase/migrations/0025_agent_memory_authority.sql"
if [ ! -f "$migration" ]; then
  echo "RED: missing $migration" >&2
  exit 1
fi

project="aria-agent-memory-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for file in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  [ "$file" = "$migration" ] && continue
  psql_stdin < "$file"
done

# Seed legacy seat-keyed memory before the authority migration. Two specs share
# the same seat deliberately, proving that no safe automatic owner/spec mapping
# exists.
psql_stdin <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b@example.test','',now(),'{}','{}',now(),now()),
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@example.test','',now(),'{}','{}',now(),now()),
  ('a4000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','viewer@example.test','',now(),'{}','{}',now(),now()),
  ('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','foreign@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name, allowed_domain) values
  ('11111111-1111-4111-8111-111111111111','Memory Workspace','example.test'),
  ('22222222-2222-4222-8222-222222222222','Foreign Workspace','foreign.example.test');

insert into public.profiles (id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','owner-a@example.test','Owner A','11111111-1111-4111-8111-111111111111','member'),
  ('a2000000-0000-4000-8000-000000000002','owner-b@example.test','Owner B','11111111-1111-4111-8111-111111111111','member'),
  ('a3000000-0000-4000-8000-000000000003','admin@example.test','Admin','11111111-1111-4111-8111-111111111111','admin'),
  ('a4000000-0000-4000-8000-000000000004','viewer@example.test','Viewer','11111111-1111-4111-8111-111111111111','viewer'),
  ('b1000000-0000-4000-8000-000000000001','foreign@example.test','Foreign','22222222-2222-4222-8222-222222222222','member');

insert into public.agent_seats (id,workspace_id,name,operator_email)
values ('51000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Shared sender','sender@example.test');

insert into public.agent_specs (id,workspace_id,owner_id,name,role_brief,seat_id,status) values
  ('61000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','Agent A','{"title":"Agent A role"}','51000000-0000-4000-8000-000000000001','active'),
  ('62000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a2000000-0000-4000-8000-000000000002','Agent B','{"title":"Agent B role"}','51000000-0000-4000-8000-000000000001','active');

insert into public.workspace_state (workspace_id,state) values (
  '11111111-1111-4111-8111-111111111111',
  '{"version":17,"memory":[{"id":"legacy-memory","seatId":"51000000-0000-4000-8000-000000000001","kind":"instruction","content":"legacy shared secret instruction"}]}'
);
SQL

psql_stdin < "$migration"
psql_stdin < tests/db/agent-memory-authority.sql

echo "RESULT agent-memory-db: authority=pass isolation=pass quarantine=pass receipts=content-free"
