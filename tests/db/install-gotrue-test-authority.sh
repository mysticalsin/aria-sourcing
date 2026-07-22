#!/usr/bin/env bash

# Install the production Auth-owner bridges and the minimal GoTrue lifecycle
# shape before application migrations run in disposable database suites.
#
# The caller must expose a psql-compatible shell function whose connection
# honors ARIA_DB_TEST_ROLE. Keeping the owner phase here prevents individual
# suites from silently mutating auth.users as the restricted postgres role.
aria_install_gotrue_test_authority() {
  local runner="${1:-psql_stdin}"

  if ! declare -F "$runner" >/dev/null; then
    echo "GoTrue authority installer requires shell function: $runner" >&2
    return 1
  fi

  ARIA_DB_TEST_ROLE=supabase_admin "$runner" -q \
    < docker/bootstrap/auth-owner-bridges.sql
  ARIA_DB_TEST_ROLE=supabase_admin "$runner" -q \
    < tests/db/gotrue-owner-phase-fixture.sql
}
