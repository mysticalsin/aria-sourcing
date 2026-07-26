#!/usr/bin/env bash
set -Eeuo pipefail

# Two-stage RED-first contract for the 0068 online-index foundation and 0069
# candidate-outreach eligibility authority. Normal manifest execution stays
# green at a verified clean missing stage. Intentional RED evidence requires
# an explicit --prove-red R1 or --prove-red R2 invocation.

proof_mode=""
if (( $# == 0 )); then
  :
elif (( $# == 2 )) \
  && [[ "$1" == "--prove-red" ]] \
  && [[ "$2" == "R1" || "$2" == "R2" ]]; then
  proof_mode="$2"
else
  echo "usage: $0 [--prove-red R1|R2]" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

expected_0067_migration="supabase/migrations/0067_candidate_list_set_preview_authority.sql"
expected_0067_rollback="supabase/rollbacks/0067_candidate_list_set_preview_authority.sql"
shopt -s nullglob
forward_0067_sources=(supabase/migrations/0067*.sql)
reverse_0067_sources=(supabase/rollbacks/0067*.sql)
shopt -u nullglob
if (( ${#forward_0067_sources[@]} != 1 \
      || ${#reverse_0067_sources[@]} != 1 )) \
  || [[ "${forward_0067_sources[0]:-}" != "$expected_0067_migration" ]] \
  || [[ "${reverse_0067_sources[0]:-}" != "$expected_0067_rollback" ]]; then
  echo "candidate-outreach-eligibility-db: exact 0067 source cardinality or filename is invalid" >&2
  exit 1
fi

project="aria-candidate-outreach-eligibility-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
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
    --env PGPASSWORD="${ARIA_DB_TEST_PASSWORD:-$bootstrap_password}" \
    --env "PGAPPNAME=${PGAPPNAME:-candidate-outreach-eligibility}" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" \
    -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

expected_0067_sha256="ae101d72145094b21e44694c3c00b37b3b0824c9ab1bb9780f65d9608ff1d4dd"
expected_0067_rollback_sha256="ef77b9aae9cb5252d3e09adc9ffa4937ba2ef40d8387388c1ad5f3d1bf2ccdc7"
actual_0067_sha256="$(shasum -a 256 \
  "$expected_0067_migration" \
  | awk '{print $1}')"
actual_0067_rollback_sha256="$(shasum -a 256 \
  "$expected_0067_rollback" \
  | awk '{print $1}')"

if [[ "$actual_0067_sha256" != "$expected_0067_sha256" ]]; then
  echo "candidate-outreach-eligibility-db: 0067 migration SHA-256 drifted (${actual_0067_sha256})" >&2
  exit 1
fi
if [[ "$actual_0067_rollback_sha256" != "$expected_0067_rollback_sha256" ]]; then
  echo "candidate-outreach-eligibility-db: 0067 rollback SHA-256 drifted (${actual_0067_rollback_sha256})" >&2
  exit 1
fi

last_migration=""
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  sequence="${base%%_*}"
  if (( 10#$sequence > 67 )); then
    break
  fi
  psql_stdin --single-transaction -q < "$migration"
  last_migration="$base"
done

if [[ "$last_migration" != "0067_candidate_list_set_preview_authority.sql" ]]; then
  echo "candidate-outreach-eligibility-db: migration bootstrap stopped at ${last_migration:-none}, not exact 0067" >&2
  exit 1
fi

psql_stdin --single-transaction -q < tests/db/gotrue-lifecycle-fixture.sql

foundation_present="$(psql_stdin -Atq <<'SQL'
select (
  to_regclass('public.candidate_lists') is not null
  and to_regclass('public.candidate_list_members') is not null
  and to_regclass('public.candidate_contact_attestations') is not null
  and to_regprocedure(
    'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
  ) is not null
  and to_regprocedure(
    'public.advance_candidate_list_membership_revisions()'
  ) is not null
  and to_regprocedure(
    'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'
  ) is not null
  and to_regprocedure(
    'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
  ) is not null
  and to_regprocedure(
    'public.candidate_legal_hold_lock_key(uuid,text)'
  ) is not null
  and exists (
    select 1
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
     where attribute.attrelid = 'public.candidate_lists'::regclass
       and attribute.attname = 'membership_revision'
       and attribute.atttypid = 'pg_catalog.int8'::regtype
       and attribute.attnotnull
       and not attribute.attisdropped
       and pg_catalog.pg_get_expr(
         default_row.adbin, default_row.adrelid
       ) in ('0', '0::bigint')
       and pg_catalog.col_description(
         attribute.attrelid, attribute.attnum
       ) = 'aria:candidate-list-set-preview-authority:0067'
  )
)::text;
SQL
)"

if [[ "$foundation_present" != "true" ]]; then
  echo "candidate-outreach-eligibility-db: exact 0067 candidate-list foundation is missing" >&2
  exit 1
fi

shopt -s nullglob
forward_0068=(supabase/migrations/0068*.sql)
reverse_0068=(supabase/rollbacks/0068*.sql)
later_sources=()
for source in \
  supabase/migrations/[0-9][0-9][0-9][0-9]*.sql \
  supabase/rollbacks/[0-9][0-9][0-9][0-9]*.sql; do
  source_base="$(basename "$source")"
  source_sequence="${source_base:0:4}"
  if (( 10#$source_sequence > 68 )); then
    later_sources+=("$source")
  fi
done
shopt -u nullglob

if (( ${#later_sources[@]} != 0 )); then
  echo "candidate-outreach-eligibility-db: source sequence after 0068 exists before the online foundation" >&2
  exit 1
fi

ledger_exists="$(psql_stdin -Atq <<'SQL'
select (to_regclass('public.aria_schema_migrations') is not null)::text;
SQL
)"
ledger_r1_conflict="false"
if [[ "$ledger_exists" == "true" ]]; then
  ledger_r1_conflict="$(psql_stdin -Atq <<'SQL'
select exists (
  select 1
    from public.aria_schema_migrations
   where case
           when filename ~ '^[0-9]{4}_[a-z0-9]+(_[a-z0-9]+)*[.]sql$'
             then pg_catalog.substring(filename from 1 for 4)::integer >= 68
           else true
         end
)::text;
SQL
)"
fi

index_state="$(psql_stdin -Atq <<'SQL'
select concat_ws('|',
  (to_regclass(
    'public.candidate_list_members_workspace_member_key'
  ) is not null)::text,
  (to_regclass(
    'public.suppression_list_email_domain_normalized_lookup_idx'
  ) is not null)::text,
  (to_regclass(
    'public.suppression_list_linkedin_normalized_lookup_idx'
  ) is not null)::text,
  (to_regclass(
    'public.outreach_ledger_candidate_status_lookup_idx'
  ) is not null)::text,
  (to_regclass(
    'public.outreach_ledger_candidate_unknown_status_lookup_idx'
  ) is not null)::text
);
SQL
)"

if (( ${#forward_0068[@]} == 0 && ${#reverse_0068[@]} == 0 )); then
  if [[ "$ledger_r1_conflict" != "false" \
    || "$index_state" != "false|false|false|false|false" ]]; then
    echo "candidate-outreach-eligibility-db: 0068 source is absent but ledger/index state is ${ledger_r1_conflict}|${index_state}" >&2
    exit 1
  fi

  if [[ "$proof_mode" == "R1" ]]; then
    echo "candidate-outreach-eligibility-db RED: online index foundation is absent after exact 0067" >&2
    exit 1
  fi
  if [[ "$proof_mode" == "R2" ]]; then
    echo "candidate-outreach-eligibility-db: cannot prove R2 before exact 0068" >&2
    exit 1
  fi

  echo "candidate-outreach-eligibility-db SKIP: verified clean R1 after exact 0067"
  exit 0
fi

expected_migration="supabase/migrations/0068_candidate_outreach_eligibility_online_indexes.sql"
expected_rollback="supabase/rollbacks/0068_candidate_outreach_eligibility_online_indexes.sql"
if (( ${#forward_0068[@]} != 1 || ${#reverse_0068[@]} != 1 )) \
  || [[ "${forward_0068[0]:-}" != "$expected_migration" ]] \
  || [[ "${reverse_0068[0]:-}" != "$expected_rollback" ]]; then
  echo "candidate-outreach-eligibility-db: inconsistent 0068 source filenames" >&2
  exit 1
fi

migration_marker="-- aria:migration-mode=nontransactional-concurrent-index-v1"
rollback_marker="-- aria:rollback-mode=nontransactional-concurrent-index-v1"
migration_marker_bytes=$(( ${#migration_marker} + 1 ))
rollback_marker_bytes=$(( ${#rollback_marker} + 1 ))
expected_migration_marker_sha256="$(
  printf '%s\n' "$migration_marker" | shasum -a 256 | awk '{print $1}'
)"
expected_rollback_marker_sha256="$(
  printf '%s\n' "$rollback_marker" | shasum -a 256 | awk '{print $1}'
)"
actual_migration_marker_sha256="$(
  dd if="$expected_migration" bs=1 count="$migration_marker_bytes" 2>/dev/null \
    | shasum -a 256 | awk '{print $1}'
)"
actual_rollback_marker_sha256="$(
  dd if="$expected_rollback" bs=1 count="$rollback_marker_bytes" 2>/dev/null \
    | shasum -a 256 | awk '{print $1}'
)"
if [[ "$actual_migration_marker_sha256" != "$expected_migration_marker_sha256" ]]; then
  echo "candidate-outreach-eligibility-db: exact 0068 migration marker is missing" >&2
  exit 1
fi
if [[ "$actual_rollback_marker_sha256" != "$expected_rollback_marker_sha256" ]]; then
  echo "candidate-outreach-eligibility-db: exact 0068 rollback marker is missing" >&2
  exit 1
fi
if [[ "$ledger_r1_conflict" != "false" \
  || "$index_state" != "false|false|false|false|false" ]]; then
  echo "candidate-outreach-eligibility-db: 0068 authority exists before its online phase (${ledger_r1_conflict}|${index_state})" >&2
  exit 1
fi

echo "candidate-outreach-eligibility-db: exact 0068 source exists; add its online runner, catalog, recovery, and receipt proof before R2" >&2
exit 1
