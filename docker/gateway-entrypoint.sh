#!/bin/sh
# Render the origin allowlist into the Caddyfile, then start Caddy.
# ARIA_CORS_ORIGINS is comma- or space-separated. Empty denies every origin.
# A wildcard entry refuses to start. No default allowlist is applied here.
set -eu

template=/etc/caddy/Caddyfile
output=/tmp/Caddyfile
raw=$(printf '%s' "${ARIA_CORS_ORIGINS:-}" | tr ',' ' ')
matcher=""

set -f
# Intentional split: origins do not contain spaces. Globbing stays off for the loop.
# shellcheck disable=SC2086
set -- $raw
if [ "$#" -eq 0 ]; then
  matcher='	header Origin https://deny.invalid'
else
  for origin in "$@"; do
    case "$origin" in
      *\**)
        echo "gateway: origin allowlist rejects a wildcard" >&2
        exit 1
        ;;
      http://*|https://*)
        matcher="${matcher}	header Origin ${origin}
"
        ;;
      *)
        echo "gateway: origin allowlist has an unsupported entry" >&2
        exit 1
        ;;
    esac
  done
fi

awk -v matcher="$matcher" '
  $1 == "__CORS_ORIGIN_MATCHER__" { printf "%s\n", matcher; next }
  { print }
' "$template" > "$output"

exec caddy run --config "$output" --adapter caddyfile
