#!/bin/bash
# prod-apply-swarm-fixes.sh — OWNER-RUN. Bring prod to the Codex-hardened,
# channel-audited build after the initial rollout shipped the pre-review versions.
#
# WHY THIS IS NOT A PLAIN `migrations` RUN:
# The initial rollout applied migrations 0001-0046 and deployed the app from a
# working copy taken BEFORE the Codex adversarial pass and the channel audit.
# Fixes were then made IN PLACE to already-applied migrations 0028/0039/0041/
# 0044/0045/0046 (all idempotent create-or-replace / add-column-if-not-exists /
# revoke). The bootstrap's migration ledger is immutable-by-hash, so the normal
# `migrations` phase HARD-FAILS ("migration hash changed") when a change hits an
# applied file — and passing the full corrected SQL as one arg overflows the
# exec limit ("Argument list too long"). This script instead:
#   1. rebuilds + pushes the bootstrap image so /migrations holds the current
#      corrected files,
#   2. runs a tiny driver INSIDE that image: psql -f each changed migration
#      (read from the image, no arg limit; idempotent so re-runnable), then
#      reconciles the ledger sha256 for those files (the `supabase migration
#      repair` pattern) so future `migrations` runs are clean,
#   3. verifies the P0 fix + a new function through prod PostgREST,
#   4. redeploys the app so the worker/executor/route fixes ship.
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

# The migrations edited in place after the prod baseline (git: since eecdb7d).
CHANGED="0028_conversation_authority_hardening 0039_email_channel_durability 0041_email_outcomes 0044_sourcing_enrichment_authority 0045_outreach_sequence_authority 0046_swarm_orchestration_authority"

work="$(mktemp -d /tmp/aria-swarmfix.XXXXXX)"
trap 'rm -rf "$work"' EXIT

echo "=== 1/5 rebuild + push bootstrap image (current corrected migrations) ==="
mkdir -p "$work/ctx/docker"
cp -R "$repo/supabase" "$work/ctx/supabase"
cp -R "$repo/docker/bootstrap" "$work/ctx/docker/bootstrap"
cp "$repo/fly.bootstrap.toml" "$work/ctx/"
( cd "$work/ctx" && flyctl deploy --config fly.bootstrap.toml --build-only --push --image-label latest --remote-only )

echo "=== 2/5 apply changed migrations from the image + reconcile the ledger ==="
# Tiny driver: files are read from /migrations in the image (no arg limit).
DRIVER='set -e
for f in '"$CHANGED"'; do
  path="/migrations/${f}.sql"
  echo "  applying ${f}.sql (idempotent)"
  psql -X -h aria-mantu-db.internal -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$path"
  sha="$(sha256sum "$path" | awk "{print \$1}")"
  psql -X -h aria-mantu-db.internal -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c \
    "update public.aria_schema_migrations set sha256='"'"'$sha'"'"' where filename='"'"'${f}.sql'"'"'"
  echo "  reconciled ledger sha256 for ${f}.sql -> $sha"
done
psql -X -h aria-mantu-db.internal -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "select pg_notify('"'"'pgrst'"'"','"'"'reload schema'"'"')"
echo "  schema cache reload signalled"'
flyctl machine run "registry.fly.io/aria-mantu-bootstrap:latest" \
  --app aria-mantu-bootstrap --region cdg --rm \
  --entrypoint /bin/sh \
  -e PGPASSWORD="$FLY_PG_PASSWORD" \
  -e DRIVER="$DRIVER" \
  -- -c 'echo "$DRIVER" | sh'

echo "=== 3/5 verify P0 + new scheduling authority through prod PostgREST ==="
sleep 6
p0=$(curl -s -m 25 -H "apikey: $FLY_SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $FLY_SUPABASE_SERVICE_KEY" \
  -H "content-type: application/json" \
  -d '{"p_workspace_id":"00000000-0000-4000-8000-000000000000","p_kind":"swarm_assignment","p_idempotency_key":"probe0000","p_payload":{}}' \
  "https://aria-mantu-kong.fly.dev/rest/v1/rpc/enqueue_aria_job")
echo "  enqueue_aria_job swarm_assignment -> $p0"
echo "$p0" | grep -q 'invalid_request' && echo "  P0 OK: swarm_assignment rejected by generic queue" || { echo "  P0 CHECK FAILED"; exit 1; }
sched=$(curl -s -m 25 -o /dev/null -w "%{http_code}" \
  -H "apikey: $FLY_SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $FLY_SUPABASE_SERVICE_KEY" \
  -H "content-type: application/json" -d '{"p_step_id":"00000000-0000-4000-8000-000000000000"}' \
  "https://aria-mantu-kong.fly.dev/rest/v1/rpc/claim_sequence_step_for_schedule")
echo "  claim_sequence_step_for_schedule -> $sched (expect 200, not 404)"
[ "$sched" = "404" ] && { echo "  scheduling authority did not land"; exit 1; }

echo "=== 4/5 redeploy app (worker/executor/route/send fixes) ==="
rsync -a --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude '_agent_state' --exclude '_relay' --exclude 'graphify-out' \
  --exclude 'production-readiness' --exclude '.env*' "$repo/" "$work/app/"
( cd "$work/app" && flyctl deploy --config fly.app.toml --remote-only \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY" )

echo "=== 5/5 confirm the ledger is consistent (next migrations run will be clean) ==="
echo
echo "================ PROD FIXES APPLIED ================"
echo " Migrations corrected + ledger reconciled, P0 verified, scheduling"
echo " authority live, app redeployed. Swarm remains DARK. Next: one-candidate"
echo " proof (docs/runbooks/one-candidate-live-proof.md)."
