#!/bin/bash
# prod-swarm-rollout.sh — OWNER-RUN rollout of the swarm orchestration stack.
#
# Runs the whole chain in one deliberate command, from a local (non-OneDrive)
# working copy it creates itself:
#   1. rebuild + push the bootstrap image (bakes every numbered migration in the
#      reviewed checkout and the refreshed reviewed-baseline pins),
#   2. apply migrations to aria-mantu-db (idempotent, ledgered phase),
#   3. verify the swarm authority answers through prod PostgREST,
#   4. deploy the app (synchronous Send fix + /api/swarm routes),
#   5. enable the swarm DARK for the single prod workspace through the
#      authority RPCs themselves (seed roster -> enable agents ->
#      swarm_enabled on), attributed to the earliest admin profile.
#      Refuses if the DB has more or fewer than exactly one workspace.
#
# After this script the swarm is enabled but INERT: no executor is configured
# and no missions exist. Nothing dispatches until you create a mission, and
# nothing can ever send outreach except the existing approval gate.
#
# Usage (from the repo root, in YOUR terminal):
#   bash scripts/prod-swarm-rollout.sh
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/scripts/lib/prod-release-guard.sh"
aria_require_reviewed_production_release prod-swarm-rollout aria-mantu-bootstrap aria-mantu-app
export FLY_API_TOKEN="$(cat "$repo/production-readiness/.fly-token.env")"
export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a; source "$repo/production-readiness/.fly-secrets.env"; set +a

work="$(mktemp -d /tmp/aria-rollout.XXXXXX)"
trap 'rm -rf "$work"' EXIT
echo "=== 0/5 local working copy (off OneDrive) -> $work ==="
rsync -a \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude '_agent_state' --exclude '_relay' --exclude 'graphify-out' \
  --exclude 'production-readiness' --exclude '.env*' \
  "$repo/" "$work/"
cd "$work"
# The release guard above already binds HEAD to an exact reviewed SHA with a
# clean tree, which pins the migration set far harder than a literal count could
# — and a count that must be hand-bumped goes stale and aborts every run instead
# (it sat at 45 while the checkout carried more). So assert the thing the guard
# cannot see: that the local mirror this script just built actually matches the
# checkout it was copied from.
mirror_migrations="$(ls supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql | wc -l | tr -d ' ')"
repo_migrations="$(ls "$repo"/supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql | wc -l | tr -d ' ')"
[ "$mirror_migrations" = "$repo_migrations" ] || {
  echo "ABORT: mirror has $mirror_migrations migrations, checkout has $repo_migrations — rsync did not reproduce the checkout"
  exit 1
}
echo "    migrations: $mirror_migrations files, tip $(ls supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql | tail -1 | xargs basename)"

echo "=== 1/5 bootstrap image (remote builder) ==="
flyctl deploy --config fly.bootstrap.toml --build-only --push --image-label latest --remote-only

echo "=== 2/5 apply migrations (idempotent, ledgered) ==="
flyctl machine run "registry.fly.io/aria-mantu-bootstrap:latest" \
  --app aria-mantu-bootstrap --region cdg --rm \
  -e ARIA_BOOTSTRAP_PHASE=migrations \
  -e POSTGRES_TARGET_PASSWORD="$FLY_PG_PASSWORD"

echo "=== 3/5 verify swarm authority through prod PostgREST ==="
code=$(curl -s -m 25 -o /tmp/swarm-verify.out -w "%{http_code}" \
  -H "apikey: $FLY_SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $FLY_SUPABASE_SERVICE_KEY" \
  -H "content-type: application/json" \
  -d '{"p_workspace_id":"00000000-0000-4000-8000-000000000000"}' \
  "https://aria-mantu-kong.fly.dev/rest/v1/rpc/get_swarm_runtime")
echo "  get_swarm_runtime -> $code ($(head -c 120 /tmp/swarm-verify.out))"
[ "$code" = "200" ] || { echo "ABORT: swarm authority not reachable after migrate"; exit 1; }

echo "=== 4/5 deploy app (Send fix + /api/swarm routes) ==="
flyctl deploy --config fly.app.toml --remote-only \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY"

echo "=== 5/5 enable swarm DARK via the authority RPCs (single-workspace guard) ==="
cat > "$work/enable-swarm.sql" <<'SQL'
do $enable$
declare
  workspace_count integer;
  admin_id uuid;
  agent record;
  result jsonb;
begin
  select count(*) into workspace_count from public.workspaces;
  if workspace_count <> 1 then
    raise exception 'expected exactly 1 workspace, found % - enable manually per workspace', workspace_count;
  end if;
  select p.id into admin_id
    from public.profiles p
   where p.role = 'admin'
   order by p.created_at asc nulls last
   limit 1;
  if admin_id is null then
    raise exception 'no admin profile found';
  end if;

  -- Impersonate the admin through the same claims mechanism the app uses,
  -- so every enable is attributed in-DB exactly as if clicked in the UI
  -- (the pattern the DB proof suites use).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  result := public.seed_swarm_roster();
  raise notice 'seed_swarm_roster: %', result;

  for agent in
    select id, slug, max_concurrent, review_required
      from public.swarm_agents
  loop
    result := public.set_swarm_agent(agent.id, true, agent.max_concurrent, agent.review_required, null);
    raise notice 'enable %: %', agent.slug, result;
  end loop;

  result := public.set_sourcing_loop_controls(false, false, false, false, false, true, 10, 50, 200);
  raise notice 'controls: %', result;
end
$enable$;
select slug, enabled from public.swarm_agents order by slug;
select kill_switch, swarm_enabled, intake_enabled, sourcing_enabled, sequences_enabled
  from public.sourcing_loop_controls;
SQL
flyctl machine run "registry.fly.io/aria-mantu-bootstrap:latest" \
  --app aria-mantu-bootstrap --region cdg --rm \
  --entrypoint /bin/sh \
  -e PGPASSWORD="$FLY_PG_PASSWORD" \
  -e ENABLE_SQL_B64="$(base64 < "$work/enable-swarm.sql" | tr -d '\n')" \
  -- -c 'echo "$ENABLE_SQL_B64" | base64 -d | psql -X -h aria-mantu-db.internal -U postgres -d postgres -v ON_ERROR_STOP=1'

echo
echo "================ ROLLOUT COMPLETE ================"
echo " Swarm authority live + enabled (DARK: no executor, no missions)."
echo " Next: create a mission via POST /api/swarm/missions, and set"
echo " ARIA_SWARM_EXECUTOR_URL/_TOKEN + a swarm process group when you"
echo " choose the executor (after the Codex pass on 0042-0046)."
