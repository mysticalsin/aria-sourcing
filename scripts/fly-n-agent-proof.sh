#!/usr/bin/env bash
# fly-n-agent-proof.sh — read-only post-deploy proof for N campaign agents goal.
#
# After owner lands PR #150 onto deploy/fly-github-actions and dispatches
# Deploy Aria Mantu, run this to verify production matches tip for LI N-desks.
#
# Usage:
#   bash scripts/fly-n-agent-proof.sh [expected_tip_sha]
#
# expected_tip_sha defaults to origin/deploy/fly-github-actions (fetch first).
#
# Exit 0 only when /api/ready JSON shows:
#   build == tip, migration ≥0087 (0088+ OK), hermesRuntime==true, database/auth/queue true
#
# Does NOT require agentFrameworks==true or HTTP 200. DeerFlow/Flowise sidecars
# are not on this Fly tenant; /api/ready stays 503 while /api/health routes the
# app (see _relay/evidence/2026-09-05-fly-linkedin-live.md). N campaign agents
# use Hermes/Browser Computer, not those adapters.
#
# LI Take→login→Release remains a manual owner step (sessionHealthy only after probe).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"

die() { echo "ERROR: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

need_cmd curl
need_cmd git
need_cmd node

if [[ $# -ge 1 && -n "${1:-}" ]]; then
  EXPECTED="$1"
else
  git fetch origin deploy/fly-github-actions >/dev/null 2>&1 || true
  EXPECTED="$(git rev-parse origin/deploy/fly-github-actions 2>/dev/null || true)"
fi

[[ "$EXPECTED" =~ ^[0-9a-f]{40}$ ]] || die "expected tip must be a 40-char lowercase Git SHA (got: ${EXPECTED:-empty})"

echo "=== N-agent Fly proof (read-only) ==="
echo "  app URL : $APP_URL"
echo "  expect  : $EXPECTED"
echo

# Accept non-200: tenant keeps /api/ready 503 when agentFrameworks is false.
http_code="$(curl -sS -m 30 -o /tmp/aria-n-agent-ready.json -w '%{http_code}' "${APP_URL}/api/ready" || true)"
ready_json="$(cat /tmp/aria-n-agent-ready.json 2>/dev/null || true)"
[[ -n "$ready_json" ]] || die "empty /api/ready response (http=${http_code:-none})"

node -e '
  const expected = process.argv[1];
  const httpCode = process.argv[2];
  let j;
  try { j = JSON.parse(process.argv[3]); } catch { process.exit(2); }
  const c = j.components || {};
  const build = String(j.build ?? "");
  const migration = String(j.migration ?? "");
  const okBuild = build === expected;
  const okMig = (() => {
    const n = Number((migration.match(/^(\d{4})/) || [])[1] || 0);
    return Number.isFinite(n) && n >= 87;
  })();
  const okHermes = c.hermesRuntime === true;
  const okPlane = c.database === true && c.auth === true && c.queue === true;
  // Honest report only — not a pass gate on this tenant.
  const frameworks = c.agentFrameworks === true;
  console.log(`  http             : ${httpCode}`);
  console.log(`  build            : ${build || "(missing)"}`);
  console.log(`  migration        : ${migration || "(missing)"}`);
  console.log(`  hermesRuntime    : ${c.hermesRuntime}`);
  console.log(`  database/auth/q  : ${c.database}/${c.auth}/${c.queue}`);
  console.log(`  agentFrameworks  : ${c.agentFrameworks} (orthogonal; not required)`);
  console.log(`  status           : ${j.status ?? j.ok}`);
  console.log(`  build==tip       : ${okBuild}`);
  console.log(`  migration≥0087   : ${okMig}`);
  console.log(`  hermes true      : ${okHermes}`);
  console.log(`  data plane true  : ${okPlane}`);
  if (!okBuild || !okMig || !okHermes || !okPlane) process.exit(1);
  if (frameworks) {
    console.log("  note             : agentFrameworks unexpectedly true on this probe");
  }
' "$EXPECTED" "$http_code" "$ready_json"

echo
echo "PASS: tip SHA + migration ≥0087 + Hermes data plane ready for N-agent LI desks."
echo
echo "Remaining manual proof (do not invent sessionHealthy=true):"
echo "  1. Open each campaign LI desk on Floor/Fleet"
echo "  2. Take control → LinkedIn login → Release"
echo "  3. Confirm sessionHealthy===true only after fleet probe paints it"
echo "  4. Confirm N desks visible on 3D floor with attach-gated pulse/PacketFX"
echo
echo "Note: full Deploy Aria Mantu may still fail require_http_200 on /api/ready"
echo "      (AGENT_FRAMEWORKS_REQUIRED) even after tip+0087 land — check build/migration."
echo
echo "Then UpdateGoal complete is allowed."
