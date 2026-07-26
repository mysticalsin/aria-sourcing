#!/usr/bin/env bash
set -Eeuo pipefail

# RED-first contract for candidate-outreach eligibility authority in migration
# 0068. This E1.1 slice applies the exact accepted history through 0067,
# verifies that foundation, and stops at the first missing 0068 authority.
# It performs no provider calls, reads no provider credentials, and creates no
# production schema beyond the already accepted migrations.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

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
  supabase/migrations/0067_candidate_list_set_preview_authority.sql \
  | awk '{print $1}')"
actual_0067_rollback_sha256="$(shasum -a 256 \
  supabase/rollbacks/0067_candidate_list_set_preview_authority.sql \
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

migration="supabase/migrations/0068_candidate_outreach_eligibility_authority.sql"
rollback="supabase/rollbacks/0068_candidate_outreach_eligibility_authority.sql"
authority_state="$(psql_stdin -Atq <<'SQL'
select concat(
  (to_regclass(
    'public.candidate_outreach_eligibility_attestations'
  ) is not null)::text,
  '|',
  (to_regprocedure(
    'public.attest_candidate_outreach_eligibility(uuid,text,text,text,text,text,timestamptz,text,bigint,uuid)'
  ) is not null)::text,
  '|',
  (to_regprocedure(
    'public.evaluate_candidate_list_outreach_eligibility(uuid,bigint,text,text,text,integer)'
  ) is not null)::text
);
SQL
)"

if [[ ! -f "$migration" ]]; then
  if [[ "$authority_state" != "false|false|false" ]]; then
    echo "candidate-outreach-eligibility-db: 0068 migration is absent but authority state is ${authority_state}" >&2
    exit 1
  fi
  echo "candidate-outreach-eligibility-db RED: eligibility attestation and revision-bound evaluation authority are absent after exact 0067" >&2
  exit 1
fi

if [[ ! -f "$rollback" ]]; then
  echo "candidate-outreach-eligibility-db: found exact 0068 migration but exact rollback is absent" >&2
  exit 1
fi
if [[ "$authority_state" != "false|false|false" ]]; then
  echo "candidate-outreach-eligibility-db: 0068 authority exists before its migration is applied (${authority_state})" >&2
  exit 1
fi

echo "candidate-outreach-eligibility-db: E1.1 contains only the RED boundary; add future-green assertions before applying 0068" >&2
exit 1
