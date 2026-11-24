#!/usr/bin/env bash
# Compatibility entry point. Never resets the database or overwrites .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/local-stack.mjs up
