#!/usr/bin/env bash
# Promote ARIA from open-demo (admin/admin) to LIVE tenant mode.
#
# Requires env already exported (never commit values):
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#   DATA_ENCRYPTION_KEY          # openssl rand -base64 32
#   LINKEDIN_INBOUND_WEBHOOK_SECRET   # optional but recommended
#   CRON_SECRET                  # optional
#   OUTREACH_UNSUBSCRIBE_BASE_URL    # https://<live-host>
#
# Optional:
#   SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF  → runs `supabase db push`
#   VERCEL_TOKEN + VERCEL_ORG_ID + VERCEL_PROJECT_ID → sets Production env via CLI
#
# This script REFUSES to set NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true.
set -euo pipefail

need() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "missing required env: $name" >&2
    exit 1
  fi
}

need NEXT_PUBLIC_SUPABASE_URL
need NEXT_PUBLIC_SUPABASE_ANON_KEY
need SUPABASE_SERVICE_ROLE_KEY
need DATA_ENCRYPTION_KEY

if [[ "${NEXT_PUBLIC_SUPABASE_URL}" == *"your-project"* ]]; then
  echo "NEXT_PUBLIC_SUPABASE_URL looks like a placeholder" >&2
  exit 1
fi

if [ "${NEXT_PUBLIC_ENABLE_DEMO_LOGIN:-}" = "true" ]; then
  echo "Refusing LIVE promote while NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true" >&2
  exit 1
fi

echo "▸ LIVE promote preflight OK (Supabase URL host: $(printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | awk -F/ '{print $3}'))"

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  if ! command -v supabase >/dev/null 2>&1; then
    echo "supabase CLI required for db push" >&2
    exit 1
  fi
  echo "▸ Linking Supabase project $SUPABASE_PROJECT_REF"
  supabase link --project-ref "$SUPABASE_PROJECT_REF"
  echo "▸ Applying migrations (db push)"
  supabase db push
else
  echo "▸ Skipping db push (set SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF to apply migrations)"
fi

if [ -n "${VERCEL_TOKEN:-}" ] && [ -n "${VERCEL_ORG_ID:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ]; then
  if ! command -v vercel >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
    echo "vercel CLI / npx required to set Production env" >&2
    exit 1
  fi
  VC=(npx vercel)
  command -v vercel >/dev/null 2>&1 && VC=(vercel)

  echo "▸ Writing Production env on Vercel project $VERCEL_PROJECT_ID (no demo login)"
  add_env() {
    local key="$1" val="$2"
    printf '%s' "$val" | "${VC[@]}" env add "$key" production --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID" --force >/dev/null
  }
  add_env NEXT_PUBLIC_SUPABASE_URL "$NEXT_PUBLIC_SUPABASE_URL"
  add_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
  add_env SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
  add_env DATA_ENCRYPTION_KEY "$DATA_ENCRYPTION_KEY"
  # Explicitly disable demo login for LIVE
  printf 'false' | "${VC[@]}" env add NEXT_PUBLIC_ENABLE_DEMO_LOGIN production --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID" --force >/dev/null || true
  [ -n "${LINKEDIN_INBOUND_WEBHOOK_SECRET:-}" ] && add_env LINKEDIN_INBOUND_WEBHOOK_SECRET "$LINKEDIN_INBOUND_WEBHOOK_SECRET"
  [ -n "${CRON_SECRET:-}" ] && add_env CRON_SECRET "$CRON_SECRET"
  [ -n "${OUTREACH_UNSUBSCRIBE_BASE_URL:-}" ] && add_env OUTREACH_UNSUBSCRIBE_BASE_URL "$OUTREACH_UNSUBSCRIBE_BASE_URL"

  echo "▸ Triggering production redeploy"
  "${VC[@]}" --prod --yes --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID"
else
  echo "▸ Skipping Vercel env write (set VERCEL_TOKEN + VERCEL_ORG_ID + VERCEL_PROJECT_ID)"
  echo "  Manual: Vercel → Project → Settings → Environment Variables → Production:"
  echo "    NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / DATA_ENCRYPTION_KEY"
  echo "    REMOVE or set NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false"
  echo "    then Redeploy"
fi

echo "✓ Promote script finished. Verify: login page has no admin/admin demo; /api/linkedin/simulate requires real auth + service_role."
