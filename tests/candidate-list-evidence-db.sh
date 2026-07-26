#!/usr/bin/env bash
set -Eeuo pipefail

# Phase 1 RED-first evidence bridge for candidate lists.
#
# Until supabase/migrations/0065_*.sql exists and defines the governed manual
# provenance RPC
# public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid),
# this test intentionally fails with a message naming both -- that is the
# required first failure for this slice. Set operations, full eligibility,
# shared quota, CSV export, API, UI, and bulk performance remain out of scope.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidate-list-evidence-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

# ---------------------------------------------------------------------------
# Apply every migration only through 0064. The glob never matches a 0065 file
# until one is added, so today this applies the complete 0001-0064 history and
# then must observe the governed manual provenance RPC missing -- the
# required RED signal for this evidence-bridge slice.
# ---------------------------------------------------------------------------
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if [[ "$base" > "0064_zzzzzzzz.sql" ]]; then
    break
  fi
  psql_stdin -q < "$migration"
done

psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

foundation_present="$(psql_stdin -Atq -c "select (
  to_regclass('public.candidate_lists') is not null
  and to_regprocedure('public.add_candidate_list_member(uuid,text,text,uuid)') is not null
)::text")"
if [[ "$foundation_present" != "true" ]]; then
  echo "candidate-list-evidence-db: the verified 0064 candidate-list foundation is missing" >&2
  exit 1
fi

migration="$(ls supabase/migrations/0065_*.sql 2>/dev/null | head -n1 || true)"
rpc_missing="$(psql_stdin -Atq -c "select (to_regprocedure('public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)') is null)::text")"

if [[ -n "$migration" || "$rpc_missing" != "true" ]]; then
  echo "candidate-list-evidence-db: supabase/migrations/0065_*.sql or the governed manual provenance RPC already exists -- update this test for the next phase" >&2
  exit 1
fi

echo "candidate-list-evidence-db RED: supabase/migrations/0065_*.sql and the governed manual provenance RPC are absent. This is the expected first failure for the Phase 1 evidence bridge." >&2
exit 1
