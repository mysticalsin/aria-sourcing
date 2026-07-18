#!/bin/bash
# prod-apply-swarm-fixes.sh — OWNER-RUN. Bring prod up to the Codex-hardened
# swarm stack after the initial rollout shipped the pre-review versions.
#
# The initial rollout (prod-swarm-rollout.sh) applied migrations 0039-0046 and
# deployed the app from a working copy taken BEFORE the Codex adversarial pass.
# The migration ledger is applied-once by filename, so simply re-running the
# migrations phase skips the changed 0044/0045/0046. This script:
#   1. applies the corrected 0044/0045/0046 DIRECTLY (they are idempotent:
#      create-or-replace / add-column-if-not-exists / drop-if-exists), then
#      asks PostgREST to reload its schema cache,
#   2. verifies the P0 fix (enqueue_aria_job rejects 'swarm_assignment') and a
#      new function (claim_sequence_step_for_schedule) landed,
#   3. redeploys the app so the worker/executor/route fixes ship too.
#
# Idempotent and safe to re-run. Enables nothing new; the swarm stays DARK.
#
# Usage (repo root, YOUR terminal):
#   bash scripts/prod-apply-swarm-fixes.sh
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FLY_API_TOKEN="$(cat "$repo/production-readiness/.fly-token.env")"
export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a; source "$repo/production-readiness/.fly-secrets.env"; set +a

work="$(mktemp -d /tmp/aria-swarmfix.XXXXXX)"
trap 'rm -rf "$work"' EXIT

echo "=== 1/4 stage corrected authority SQL ==="
# Swarm authority (Codex pass) + channel fixes (WhatsApp go-live blocker,
# email bounce suppression, inbound erasure hardening). All idempotent
# create-or-replace / add-column-if-not-exists, safe to re-apply over the
# already-ledgered originals.
cat "$repo/supabase/migrations/0028_conversation_authority_hardening.sql" \
    "$repo/supabase/migrations/0039_email_channel_durability.sql" \
    "$repo/supabase/migrations/0041_email_outcomes.sql" \
    "$repo/supabase/migrations/0044_sourcing_enrichment_authority.sql" \
    "$repo/supabase/migrations/0045_outreach_sequence_authority.sql" \
    "$repo/supabase/migrations/0046_swarm_orchestration_authority.sql" \
    > "$work/prod-fixes.sql"
echo "select pg_notify('pgrst','reload schema');" >> "$work/prod-fixes.sql"
echo "  $(wc -l < "$work/prod-fixes.sql") lines staged"

echo "=== 2/4 apply directly to aria-mantu-db (idempotent) ==="
B64="$(base64 < "$work/prod-fixes.sql" | tr -d '\n')"
flyctl machine run "registry.fly.io/aria-mantu-bootstrap:latest" \
  --app aria-mantu-bootstrap --region cdg --rm \
  --entrypoint /bin/sh \
  -e PGPASSWORD="$FLY_PG_PASSWORD" \
  -e FIXSQL_B64="$B64" \
  -- -c 'echo "$FIXSQL_B64" | base64 -d | psql -X -h aria-mantu-db.internal -U postgres -d postgres -v ON_ERROR_STOP=1'

echo "=== 3/4 verify the P0 + new-function landed through prod PostgREST ==="
sleep 5
p0=$(curl -s -m 25 -H "apikey: $FLY_SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $FLY_SUPABASE_SERVICE_KEY" \
  -H "content-type: application/json" \
  -d '{"p_workspace_id":"00000000-0000-4000-8000-000000000000","p_kind":"swarm_assignment","p_idempotency_key":"probe0000","p_payload":{}}' \
  "https://aria-mantu-kong.fly.dev/rest/v1/rpc/enqueue_aria_job")
echo "  enqueue_aria_job swarm_assignment probe -> $p0"
echo "$p0" | grep -q 'invalid_request' && echo "  P0 CONFIRMED: swarm_assignment rejected by generic queue" \
  || { echo "  P0 CHECK FAILED — enqueue did not reject swarm_assignment"; exit 1; }
sched=$(curl -s -m 25 -o /dev/null -w "%{http_code}" \
  -H "apikey: $FLY_SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $FLY_SUPABASE_SERVICE_KEY" \
  -H "content-type: application/json" -d '{"p_step_id":"00000000-0000-4000-8000-000000000000"}' \
  "https://aria-mantu-kong.fly.dev/rest/v1/rpc/claim_sequence_step_for_schedule")
echo "  claim_sequence_step_for_schedule -> $sched (expect 200, not 404)"
[ "$sched" = "404" ] && { echo "  scheduling authority did not land"; exit 1; }

echo "=== 4/4 redeploy app (worker/executor/route fixes) ==="
rsync -a --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude '_agent_state' --exclude '_relay' --exclude 'graphify-out' \
  --exclude 'production-readiness' --exclude '.env*' "$repo/" "$work/app/"
( cd "$work/app" && flyctl deploy --config fly.app.toml --remote-only \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY" )

echo
echo "================ PROD SWARM FIXES APPLIED ================"
echo " Migrations corrected, P0 verified rejected, scheduling authority live,"
echo " app redeployed. Swarm remains DARK (no executor, roster enable already"
echo " done by the initial rollout). Next: real one-candidate proof."
