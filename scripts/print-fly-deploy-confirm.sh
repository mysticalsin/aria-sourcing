#!/usr/bin/env bash
# print-fly-deploy-confirm.sh — emit the exact owner deploy one-liner for the current checkout.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
SHA="$(git rev-parse HEAD)"
CONFIRM="aria-production-release-v1:fly-deploy-now:${SHA}:aria-mantu-bootstrap,aria-mantu-app"
cat <<EOF
# Fly production deploy (requires clean tree at \$SHA)
ARIA_RELEASE_SHA=${SHA} \\
ARIA_PROD_DEPLOY_CONFIRM=${CONFIRM} \\
  bash scripts/fly-deploy-now.sh
EOF
