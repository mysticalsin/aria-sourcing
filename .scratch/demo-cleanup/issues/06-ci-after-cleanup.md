# Verify the GitHub Actions CI after the cleanup

Status: needs-triage

`.github/workflows/ci.yml` was edited (Fly supply-chain job, Obscura steps,
removed DB suites) but has not run since: nothing was pushed, and the relay
notes say the Actions budget was exhausted. The `database-security` job runs
disposable-Postgres suites (`tests/*-db.sh`) that were not executed locally
during the cleanup. Push the branch, check every job, and fix or remove what
fails.
