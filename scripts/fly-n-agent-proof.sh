#!/usr/bin/env bash
# fly-n-agent-proof.sh — read-only post-deploy proof for N campaign agents goal.
#
# After owner lands PR #150 onto deploy/fly-github-actions and dispatches
# Deploy Aria Mantu, run this to verify production matches tip.
#
# Usage:
#   bash scripts/fly-n-agent-proof.sh [expected_tip_sha]
#
# expected_tip_sha defaults to origin/deploy/fly-github-actions (fetch first).
# Exit 0 only when /api/ready build==tip, agentFrameworks==true, migration~0087.
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

ready_json="$(curl -sS -m 30 "${APP_URL}/api/ready" || true)"
[[ -n "$ready_json" ]] || die "empty /api/ready response"

node -e '
  const expected = process.argv[1];
  let j;
  try { j = JSON.parse(process.argv[2]); } catch { process.exit(2); }
  const build = String(j.build ?? "");
  const migration = String(j.migration ?? "");
  const frameworks = j.components && j.components.agentFrameworks === true;
  const okBuild = build === expected;
  const okMig = /0087/.test(migration);
  console.log(`  build            : ${build || "(missing)"}`);
  console.log(`  migration        : ${migration || "(missing)"}`);
  console.log(`  agentFrameworks  : ${j.components?.agentFrameworks}`);
  console.log(`  status           : ${j.status ?? j.ok}`);
  console.log(`  build==tip       : ${okBuild}`);
  console.log(`  migration≥0087   : ${okMig}`);
  console.log(`  frameworks true  : ${frameworks}`);
  if (!okBuild || !okMig || !frameworks) process.exit(1);
' "$EXPECTED" "$ready_json"

echo
echo "PASS: /api/ready matches tip + agentFrameworks + migration 0087."
echo
echo "Remaining manual proof (do not invent sessionHealthy=true):"
echo "  1. Open each campaign LI desk on Floor/Fleet"
echo "  2. Take control → LinkedIn login → Release"
echo "  3. Confirm sessionHealthy===true only after fleet probe paints it"
echo "  4. Confirm N desks visible on 3D floor with attach-gated pulse/PacketFX"
echo
echo "Then UpdateGoal complete is allowed."
