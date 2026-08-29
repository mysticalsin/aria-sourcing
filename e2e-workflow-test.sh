#!/usr/bin/env bash
#
# e2e-workflow-test.sh — end-to-end smoke test for the DEPLOYED Aria Mantu tenant.
#
# Drives the real Fly app (https://aria-mantu-app.fly.dev) and its self-hosted
# Supabase/GoTrue (https://aria-mantu-kong.fly.dev) through the full recruiting
# loop, using the EXACT route shapes shipped in the codebase:
#
#   1. Admin session   — GoTrue password grant (apikey=anon) → sb-auth-token cookie
#   2. Intake          — POST /api/intake            (raw JD email → JobAnalysis)
#   3. Sourcing        — POST /api/source (GitHub raw) + POST /api/source (LinkedIn/Tavily)
#                        + POST /api/sourcing-agent   (scored, provenance="live" candidates)
#   4. LinkedIn draft  — POST /api/hermes/chat (draft) → POST /api/outreach/approve
#                        (assisted-manual / "Pending Manual Send") + POST /api/outreach/send
#                        proving the server refuses to auto-send LinkedIn (409 manual-required)
#   5. Email dry-run   — POST /api/outreach/send (channel=Email) → status:"dry-run"
#   5b. WhatsApp       — draft in candidate main language → POST /api/outreach/send dry-run
#   6. Teams/Outlook   — POST /api/calendar/event (confirmLive:false) → status:"dry-run"
#                        (live Graph+Teams when confirmLive + connected Outlook seat)
#
# Auth model (verified in src/lib/supabase/*, src/app/api/**): app routes read the
# session from a COOKIE named "sb-auth-token" (NOT a Bearer header). The cookie value
# is  "base64-" + base64url(JSON session)  chunked into sb-auth-token.0/.1 when the
# value exceeds 3180 chars (matches @supabase/ssr createChunks / combineChunks).
#
# NOTHING is ever delivered: LinkedIn is policy-blocked to assisted-manual (409) and
# email stays dry-run without confirmLive + a live domain-verified seat.
#
# ---------------------------------------------------------------------------
# Required env:  ADMIN_EMAIL  ADMIN_PASSWORD  ANON_KEY
#                EMAIL_INBOUND_WEBHOOK_SECRET (required for Fly production E2E)
# Optional env:  APP_URL  KONG_URL  AGENT_PROVIDER  AGENT_MODEL
#                GITHUB_QUERY  LINKEDIN_QUERY
#                ARIA_ALLOW_SKIP_WEBHOOK_E2E=1  ARIA_ALLOW_STALE_FLY_E2E=1
#                ARIA_ALLOW_PARTIAL_M365_E2E=1  ARIA_ALLOW_SYNTHETIC_CANDIDATE_E2E=1
#                ARIA_ALLOW_PARTIAL_LLM_E2E=1  (critics_required / approve LLM soft-fail only)
#                ARIA_ALLOW_SKIP_LIVE_CALENDAR=1  (PARTIAL only — never pretends full PASS)
#                ARIA_ALLOW_SKIP_APPROVE_E2E=1  (skip steps 4–5 approve/send — owner policy)
#                ARIA_ALLOW_SKIP_SOURCING_E2E=1  (quota/empty soft-skip — not tied to M365)
#                ARIA_ALLOW_SKIP_REPLY_CLASSIFY_E2E=1  (Fly reply route=none soft-skip)
#                E2E_INBOUND_MAILBOX  E2E_CAMPAIGN_ID  E2E_OUTREACH_LANGUAGE
# ANON_KEY may be loaded from production-readiness/.fly-secrets.env via
#   eval "$(bash scripts/print-fly-e2e-env.sh --export)"
# ---------------------------------------------------------------------------

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "${ANON_KEY:-}" ] && [ -r "$repo_root/production-readiness/.fly-secrets.env" ]; then
  ANON_KEY="$(node - "$repo_root/production-readiness/.fly-secrets.env" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
for (const line of fs.readFileSync(path, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  if (trimmed.slice(0, eq) !== "FLY_SUPABASE_ANON_KEY") continue;
  process.stdout.write(trimmed.slice(eq + 1));
  process.exit(0);
}
NODE
)"
fi

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
KONG_URL="${KONG_URL:-https://aria-mantu-kong.fly.dev}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ANON_KEY="${ANON_KEY:-}"
if [ -z "$ADMIN_EMAIL" ] && [ -r /tmp/aria-e2e-admin-email ]; then
  ADMIN_EMAIL="$(tr -d '\n\r' </tmp/aria-e2e-admin-email)"
fi
if [ -z "$ADMIN_PASSWORD" ] && [ -r /tmp/aria-e2e-admin-password ]; then
  ADMIN_PASSWORD="$(tr -d '\n\r' </tmp/aria-e2e-admin-password)"
fi

# Enterprise E2E is Fly-only. Refuse Vercel / lookalike / non-Fly hosts.
validate_fly_e2e_url() {
  local label="$1"
  local url="$2"
  local host=""
  if [[ "$url" =~ ^https://([^/:]+)(/.*)?$ ]]; then
    host="${BASH_REMATCH[1]}"
  else
    echo "ERROR: $label must be an https URL (got $url)." >&2
    exit 1
  fi
  case "$host" in
    aria-mantu-app.fly.dev|aria-mantu-kong.fly.dev) ;;
    *)
      if [ "${ARIA_ALLOW_NON_FLY_E2E:-}" != "1" ]; then
        echo "ERROR: $label must target Fly production (aria-mantu-app.fly.dev or aria-mantu-kong.fly.dev; got host=$host)." >&2
        exit 1
      fi
      ;;
  esac
  if [[ "$host" == *vercel.app* || "$host" == *vercel.com* ]]; then
    echo "ERROR: refusing Vercel host for $label." >&2
    exit 1
  fi
}
validate_fly_e2e_url "APP_URL" "$APP_URL"
validate_fly_e2e_url "KONG_URL" "$KONG_URL"

# ---- output helpers (needed before AGENT_PROVIDER probe messages) -----------
if [ -t 1 ]; then C_G="\033[32m"; C_R="\033[31m"; C_Y="\033[33m"; C_C="\033[36m"; C_B="\033[1m"; C_0="\033[0m"
else C_G=""; C_R=""; C_Y=""; C_C=""; C_B=""; C_0=""; fi
PASSES=0; FAILS=0; WARNS=0
E2E_SKIP_M365=0
E2E_SKIP_APPROVE=0
E2E_SKIP_CRON=0
E2E_SKIP_WEBHOOK=0
step() { printf "\n${C_B}== %s ==${C_0}\n" "$1"; }
pass() { printf "  ${C_G}PASS${C_0}  %s\n" "$1"; PASSES=$((PASSES+1)); }
fail() { printf "  ${C_R}FAIL${C_0}  %s\n" "$1"; FAILS=$((FAILS+1)); }
warn() { printf "  ${C_Y}WARN${C_0}  %s\n" "$1"; WARNS=$((WARNS+1)); }
info() { printf "  ${C_C}·${C_0}     %s\n" "$1"; }
die()  { printf "\n${C_R}ABORT${C_0} %s\n" "$1" >&2; exit 2; }

# Hermes outreach drafts use AGENT_PROVIDER. Do NOT hard-pin kimi on Fly —
# a present-but-401 KIMI_API_KEY yields critics_required / draft cloud 401s.
# Prefer an explicit live provider from print-fly-e2e-env / probe-fly-llm-auth.
# /api/sourcing-agent resolves its own workspace/cloud provider; this env is
# for hermes chat only.
if [ -z "${AGENT_PROVIDER:-}" ]; then
  if [ -r /tmp/aria-e2e-agent-provider ]; then
    AGENT_PROVIDER="$(tr -d '\n\r' < /tmp/aria-e2e-agent-provider)"
    info "AGENT_PROVIDER from probe cache: $AGENT_PROVIDER"
  elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
    # One probe attempt — caches FIRST_LIVE_PROVIDER for subsequent runs.
    if bash scripts/probe-fly-llm-auth.sh >/tmp/e2e-llm-probe.log 2>&1 \
      && [ -r /tmp/aria-e2e-agent-provider ]; then
      AGENT_PROVIDER="$(tr -d '\n\r' < /tmp/aria-e2e-agent-provider)"
      info "AGENT_PROVIDER from live probe: $AGENT_PROVIDER"
    else
      # Env-key probe miss is not a hard gap — Hermes gateway / vault failover still drafts.
      AGENT_PROVIDER=hermes
      info "AGENT_PROVIDER=hermes (Fly env llm probe miss — Hermes gateway / vault failover)."
    fi
  else
    AGENT_PROVIDER=anthropic
  fi
fi

# Fly: never keep a stale shell AGENT_PROVIDER (e.g. kimi) when that key is auth-dead.
# Re-probe and either switch to FIRST_LIVE_PROVIDER or fall back to provider=hermes.
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  if bash scripts/probe-fly-llm-auth.sh >/tmp/e2e-llm-probe.log 2>&1 \
    && [ -r /tmp/aria-e2e-agent-provider ]; then
    LIVE_PROV="$(tr -d '\n\r' < /tmp/aria-e2e-agent-provider)"
    if [ -n "$LIVE_PROV" ] && [ "${AGENT_PROVIDER:-}" != "$LIVE_PROV" ]; then
      info "AGENT_PROVIDER was ${AGENT_PROVIDER:-unset}; switching to live ${LIVE_PROV} from probe."
      AGENT_PROVIDER="$LIVE_PROV"
    fi
  else
    if [ -n "${AGENT_PROVIDER:-}" ] && [ "${AGENT_PROVIDER}" != "hermes" ]; then
      info "Clearing AGENT_PROVIDER=${AGENT_PROVIDER} — Fly llm_auth dead/absent (do not pin auth-dead cloud keys)."
    fi
    AGENT_PROVIDER=hermes
    info "AGENT_PROVIDER=hermes (cloud llm_auth dead — drafts use Hermes gateway, not dead Kimi env)."
  fi
fi

AGENT_MODEL="${AGENT_MODEL:-}"                      # optional model override; blank => provider default
GITHUB_QUERY="${GITHUB_QUERY:-language:typescript location:london followers:>50}"
LINKEDIN_QUERY="${LINKEDIN_QUERY:-senior typescript engineer london}"

# Default model per provider (for the outreach draft on /api/hermes/chat, which,
# unlike /api/sourcing-agent, has no server-side model fallback for the outreach task).
default_model() {
  case "$1" in
    anthropic) echo "claude-sonnet-4-6" ;;
    openai)    echo "gpt-4o-mini" ;;
    groq)      echo "llama-3.3-70b-versatile" ;;
    xai)       echo "grok-2-latest" ;;
    mistral)   echo "mistral-large-latest" ;;
    kimi)      echo "moonshot-v1-8k" ;;
    deepseek)  echo "deepseek-chat" ;;
    hermes)    echo "" ;;
    *)         echo "" ;;
  esac
}
OUTREACH_MODEL="${AGENT_MODEL:-$(default_model "${AGENT_PROVIDER:-}")}"

# Candidate main language for outreach drafts (ISO 639-1). Fly enterprise defaults
# to French — Mantu EU needs often require French copy even when the JD is English.
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  E2E_OUTREACH_LANGUAGE="${E2E_OUTREACH_LANGUAGE:-fr}"
else
  E2E_OUTREACH_LANGUAGE="${E2E_OUTREACH_LANGUAGE:-en}"
fi
case "$E2E_OUTREACH_LANGUAGE" in
  fr) E2E_LANG_LABEL="French" ;;
  de) E2E_LANG_LABEL="German" ;;
  es) E2E_LANG_LABEL="Spanish" ;;
  it) E2E_LANG_LABEL="Italian" ;;
  pt) E2E_LANG_LABEL="Portuguese" ;;
  nl) E2E_LANG_LABEL="Dutch" ;;
  *)  E2E_LANG_LABEL="English" ;;
esac

# ---- preflight -------------------------------------------------------------
for bin in curl jq openssl; do command -v "$bin" >/dev/null 2>&1 || die "'$bin' is required but not installed."; done
# Portable UUID for Idempotency-Key (uuidgen is often missing on slim CI/agent images).
e2e_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import uuid
print(str(uuid.uuid4()))
PY
    return 0
  fi
  # openssl is required in preflight — format 32 hex chars as UUID v4-shaped.
  local hex
  hex="$(openssl rand -hex 16)"
  printf '%s-%s-%s-%s-%s\n' "${hex:0:8}" "${hex:8:4}" "${hex:12:4}" "${hex:16:4}" "${hex:20:12}"
}
# PostgREST decodes '+' as space in query values — encode timestamptz offsets for filters.
encode_postgrest_ts() {
  printf '%s' "$1" | sed 's/+/%2B/g'
}
[ -n "$ADMIN_EMAIL" ]    || die "ADMIN_EMAIL is required."
[ -n "$ADMIN_PASSWORD" ] || die "ADMIN_PASSWORD is required."
[ -n "$ANON_KEY" ]       || die "ANON_KEY is required (Supabase anon key)."
case "$ADMIN_EMAIL:$ADMIN_PASSWORD" in
  *$'\n'*|*$'\r'*) die "Admin credentials must not contain line breaks." ;;
esac

# Fly production enterprise E2E requires the signed webhook secret (hiring-need
# ignition). Prefer an explicit env; otherwise reuse the agent-owned secret file
# written when EMAIL_INBOUND_WEBHOOK_SECRET was set on Fly.
if [ -z "${EMAIL_INBOUND_WEBHOOK_SECRET:-}" ] && [ -r /tmp/aria-e2e-webhook-secret ]; then
  EMAIL_INBOUND_WEBHOOK_SECRET="$(tr -d '\n\r' </tmp/aria-e2e-webhook-secret)"
  export EMAIL_INBOUND_WEBHOOK_SECRET
fi
if [ -z "${CRON_SECRET:-}" ] && [ -r /tmp/aria-e2e-cron-secret ]; then
  CRON_SECRET="$(tr -d '\n\r' </tmp/aria-e2e-cron-secret)"
  export CRON_SECRET
fi
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ -z "${EMAIL_INBOUND_WEBHOOK_SECRET:-}" ]; then
  if [ "${ARIA_ALLOW_SKIP_WEBHOOK_E2E:-}" != "1" ]; then
    die "EMAIL_INBOUND_WEBHOOK_SECRET is required for Fly enterprise E2E (webhook → requisition_parse). Set it or ARIA_ALLOW_SKIP_WEBHOOK_E2E=1 for a partial run."
  fi
fi
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ -z "${CRON_SECRET:-}" ]; then
  if [ "${ARIA_ALLOW_SKIP_CRON_E2E:-}" != "1" ]; then
    die "CRON_SECRET is required for Fly enterprise E2E (draft + graph-stage cron probes). Set it, keep /tmp/aria-e2e-cron-secret, or ARIA_ALLOW_SKIP_CRON_E2E=1 for a partial run."
  fi
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/aria-e2e.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
RESP="$WORK/resp.json"                 # scratch body for the current app call
COOKIE_HDR=""                          # populated after login

printf "${C_B}Aria Mantu — E2E workflow test${C_0}\n"
info "App:  $APP_URL"
info "Kong: $KONG_URL"
info "Admin credential supplied. Agent provider: $AGENT_PROVIDER   Model: ${OUTREACH_MODEL:-<default>}"

# Fail closed when the live Fly tenant has not reached the enterprise migration.
READY_CODE=$(curl -sS -m 20 -o "$WORK/ready.json" -w '%{http_code}' "$APP_URL/api/ready" || echo "000")
READY_MIG=$(jq -r '.migration // empty' "$WORK/ready.json" 2>/dev/null || true)
READY_OK=$(jq -r '.ok // false' "$WORK/ready.json" 2>/dev/null || true)
READY_BUILD=$(jq -r '.build // empty' "$WORK/ready.json" 2>/dev/null || true)
info "Ready probe HTTP $READY_CODE ok=$READY_OK migration=${READY_MIG:-?} build=${READY_BUILD:0:12}"
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_STALE_FLY_E2E:-}" != "1" ]; then
  # Floor: Teams meeting_url column (0066). Tip may be newer (e.g. 0067 allowlist grants).
  case "$READY_MIG" in
    0066_*|006[7-9]_*|00[7-9][0-9]_*|0[1-9][0-9][0-9]_*) ;;
    *)
      die "Fly /api/ready migration must be >= 0066_* for enterprise E2E (got '${READY_MIG:-none}'). Deploy tip via scripts/fly-enterprise-activate.sh or set ARIA_ALLOW_STALE_FLY_E2E=1."
      ;;
  esac
fi

# api METHOD URL [datafile] -> writes body to $RESP, echoes HTTP status into $HTTP
#
# Sends Origin: $APP_URL. The sourcing routes classify the request boundary before
# doing any work and answer 403 CROSS_ORIGIN_REQUEST when Origin is absent or
# foreign (src/app/api/source/route.ts:68, sourcing-agent/route.ts:223,
# source/apollo/search/route.ts:101, source/apollo/select/route.ts:76). A browser
# always sends Origin on these calls, so a harness that omits it is not modelling
# the real client — it was silently unable to exercise sourcing at all.
HTTP=""
api() {
  local method="$1" url="$2" data="${3:-}" tmo="${4:-${API_TIMEOUT:-60}}"
  if [ -n "$data" ]; then
    HTTP=$(curl -sS -m "$tmo" -o "$RESP" -w '%{http_code}' -X "$method" "$url" \
      -H 'Content-Type: application/json' -H "Origin: $APP_URL" -H "Cookie: $COOKIE_HDR" --data-binary @"$data")
  else
    HTTP=$(curl -sS -m "$tmo" -o "$RESP" -w '%{http_code}' -X "$method" "$url" \
      -H "Origin: $APP_URL" -H "Cookie: $COOKIE_HDR")
  fi
}

# ===========================================================================
step "1) Admin session (GoTrue password grant → sb-auth-token cookie)"
# ===========================================================================
SESS_RAW="$WORK/session_raw.json"
LOGIN_BODY="$WORK/login.json"
printf '%s\n%s\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" | \
  jq -Rn 'input as $email | input as $password | {email:$email,password:$password}' > "$LOGIN_BODY"
LOGIN_CODE=$(curl -sS -m 30 -o "$SESS_RAW" -w '%{http_code}' \
  -X POST "$KONG_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  --data-binary "@$LOGIN_BODY")
ACCESS_TOKEN=$(jq -r '.access_token // empty' "$SESS_RAW" 2>/dev/null)
if [ "$LOGIN_CODE" != "200" ] || [ -z "$ACCESS_TOKEN" ]; then
  fail "GoTrue login (HTTP $LOGIN_CODE): $(jq -rc '{error:.error, error_description:.error_description, msg:.msg}' "$SESS_RAW" 2>/dev/null)"
  die "Cannot obtain a session — the remaining steps require an authenticated admin."
fi
pass "Password grant returned an access_token (HTTP 200)."

# Ensure the profile + workspace exist and the first admin is promoted (idempotent).
curl -sS -m 20 -o "$WORK/ensure.json" -w '' \
  -X POST "$KONG_URL/rest/v1/rpc/ensure_workspace" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary '{}' >/dev/null 2>&1 || true
ROLE=$(curl -sS -m 20 -X POST "$KONG_URL/rest/v1/rpc/current_profile_role" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary '{}' 2>/dev/null | jq -r '. // empty')
if [ "$ROLE" = "admin" ]; then
  pass "current_profile_role = admin (has source + outreach permissions)."
else
  fail "current_profile_role is '${ROLE:-null}', not admin."
  die "Authenticated profile is not an admin; stop before campaign acceptance."
fi

# Arm the workspace switchboard so webhook hire-need enqueue + worker claim are allowed.
# Env ARIA_LOOP_KILL_SWITCH=false is still required on the Fly loop process.
jq -n '{
  p_kill_switch: false,
  p_intake_enabled: true,
  p_sourcing_enabled: true,
  p_enrichment_enabled: true,
  p_sequences_enabled: true,
  p_swarm_enabled: false,
  p_max_sourcing_runs_per_day: 50,
  p_max_sequence_sends_per_day: 200,
  p_max_enrichment_units_per_day: 1000
}' > "$WORK/arm_loop.json"
ARM_CODE=$(curl -sS -m 20 -o "$WORK/arm_loop_resp.json" -w '%{http_code}' \
  -X POST "$KONG_URL/rest/v1/rpc/set_sourcing_loop_controls" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @"$WORK/arm_loop.json")
ARM_STATUS=$(jq -r '.status // empty' "$WORK/arm_loop_resp.json" 2>/dev/null || true)
if [ "$ARM_CODE" = "200" ] && [ "$ARM_STATUS" = "updated" ]; then
  pass "Workspace loop switchboard armed (kill_switch=false, intake/sourcing/sequences on)."
else
  fail "set_sourcing_loop_controls (HTTP $ARM_CODE status='$ARM_STATUS'): $(head -c 200 "$WORK/arm_loop_resp.json")"
  die "Cannot arm workspace loop controls — webhook enqueue would control_block."
fi

# Build the sb-auth-token cookie: 'base64-' + base64url(compact session JSON),
# chunked at 3180 chars (base64url has no %-escapes so encodeURIComponent length == length).
jq -cj '.' "$SESS_RAW" > "$WORK/session.json"
B64URL=$(openssl base64 -A -in "$WORK/session.json" | tr '+/' '-_' | tr -d '=')
COOKIE_VALUE="base64-$B64URL"
VLEN=${#COOKIE_VALUE}
if [ "$VLEN" -le 3180 ]; then
  COOKIE_HDR="sb-auth-token=$COOKIE_VALUE"
  info "Session cookie fits in one part (${VLEN} chars)."
else
  off=0; idx=0; COOKIE_HDR=""
  while [ "$off" -lt "$VLEN" ]; do
    part="${COOKIE_VALUE:off:3180}"
    if [ -z "$COOKIE_HDR" ]; then COOKIE_HDR="sb-auth-token.${idx}=${part}"
    else COOKIE_HDR="${COOKIE_HDR}; sb-auth-token.${idx}=${part}"; fi
    off=$((off+3180)); idx=$((idx+1))
  done
  info "Session cookie chunked into ${idx} parts (${VLEN} chars)."
fi

# Prove the cookie authenticates against a route that runs getUser() (GET probe).
api GET  "$APP_URL/api/source"
if [ "$HTTP" = "200" ] && [ "$(jq -r '.ok // false' "$RESP")" = "true" ]; then
  pass "Cookie accepted by GET /api/source (connected=$(jq -r '.connected' "$RESP"), anonymous=$(jq -r '.anonymous' "$RESP"))."
elif [ "$HTTP" = "401" ]; then
  fail "GET /api/source returned 401 — cookie not accepted (session/encoding problem)."
elif [ "$HTTP" = "403" ]; then
  warn "GET /api/source returned 403 — authenticated but lacks 'source' permission."
else
  warn "GET /api/source unexpected HTTP $HTTP: $(head -c 200 "$RESP")"
fi

# ===========================================================================
step "2) Intake — POST /api/intake (raw JD email → JobAnalysis)"
# ===========================================================================
if [ "$E2E_OUTREACH_LANGUAGE" = "fr" ]; then
  JD_EMAIL="From: Marie Dupont <marie.dupont@bnpp.fr>
Subject: Urgent - Senior TypeScript Consultant (Paris)

Bonjour,

Nous recrutons un Consultant TypeScript Senior pour rejoindre notre équipe plateforme à Paris (hybride). Besoin assez urgent.

Role: Senior TypeScript Consultant
Location: Paris, France
Language (must): French
Language (nice): English
Skills: TypeScript, React, Node.js, GraphQL, PostgreSQL
Nice to have: Next.js, AWS
Experience: 5+ years

Merci,
Marie"
else
  JD_EMAIL="From: Priya Nair <priya.nair@acme.io>
Subject: Urgent - hiring a Senior TypeScript Engineer (London)

Hi team,

We are looking for a Senior TypeScript Engineer to join our platform team in London (hybrid). This is fairly urgent.

Role: Senior TypeScript Engineer
Location: London, UK
Skills: TypeScript, React, Node.js, GraphQL, PostgreSQL
Nice to have: Next.js, AWS
Experience: 5+ years
Salary: 90000-120000 GBP

Thanks,
Priya"
fi
jq -n --arg email "$JD_EMAIL" '{email:$email}' > "$WORK/intake_req.json"
api POST "$APP_URL/api/intake" "$WORK/intake_req.json"
# The route nests the analysis under .parsed.jobAnalysis alongside .parsed.sender,
# .parsed.intent and .parsed.urgency. Reading .parsed.title yielded empty, so this
# step reported FAIL on an HTTP 200 ok:true response carrying a complete analysis —
# and then wrote the whole envelope as the JobAnalysis, handing the wrong shape to
# every downstream step. Prefer the nested object, fall back to the flat one.
INTAKE_TITLE=$(jq -r '.parsed.jobAnalysis.title // .parsed.title // empty' "$RESP")
if [ "$HTTP" = "200" ] && [ "$(jq -r '.ok // false' "$RESP")" = "true" ] && [ -n "$INTAKE_TITLE" ]; then
  pass "Parsed JobAnalysis: title='$INTAKE_TITLE', skills=$(jq -c '.parsed.jobAnalysis.requiredSkills // .parsed.requiredSkills' "$RESP"), format=$(jq -r '.format' "$RESP")."
  jq '.parsed.jobAnalysis // .parsed' "$RESP" > "$WORK/job_analysis.json"
else
  fail "Intake failed (HTTP $HTTP): $(head -c 300 "$RESP")"
  echo '{"title":"Senior TypeScript Engineer","requiredSkills":["TypeScript"],"niceToHaveSkills":[],"scoringWeights":null}' > "$WORK/job_analysis.json"
fi

# ===========================================================================
step "2a) Intake UI parity — materialize parsed brief into workspace_state"
# ===========================================================================
# Mirrors /intake → Parse JD → Create campaign → flushWorkspaceSave before sourcing.
# Without this, step 3c only works when the webhook loop materializes a campaign.
if [ -n "${E2E_CAMPAIGN_ID:-}" ]; then
  info "E2E_CAMPAIGN_ID already set ($E2E_CAMPAIGN_ID) — skipping intake UI materialization."
elif [ -z "$INTAKE_TITLE" ]; then
  warn "Intake parse did not yield a title — skipping UI materialization."
else
  E2E_WORKSPACE_ID=$(curl -sS -m 20 -X POST "$KONG_URL/rest/v1/rpc/ensure_workspace" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'Content-Type: application/json' --data-binary '{}' | jq -r '. // empty')
  if [ -z "$E2E_WORKSPACE_ID" ]; then
    fail "ensure_workspace returned no id — cannot materialize intake campaign."
  else
    curl -sS -m 20 -o "$WORK/ws_row.json" \
      "$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$E2E_WORKSPACE_ID&select=state,updated_at" \
      -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H 'Accept: application/json' >/dev/null 2>&1 || true
    export WORK E2E_WORKSPACE_ID
    if ! npx tsx scripts/materialize-intake-campaign.mts; then
      fail "Intake UI materialization script failed (createCampaign / workspace merge)."
    else
      INTAKE_UI_ID=$(tr -d '\n\r' < "$WORK/intake_ui_campaign_id.txt")
      WS_UPD=$(jq -r '.[0].updated_at // empty' "$WORK/ws_row.json" 2>/dev/null || true)
      if [ -z "$WS_UPD" ] || [ "$WS_UPD" = "null" ]; then
        jq -nc --arg id "$E2E_WORKSPACE_ID" --slurpfile s "$WORK/new_state.json" '{workspace_id:$id,state:$s[0]}' > "$WORK/mat_post.json"
        MAT_CODE=$(curl -sS --http1.1 -m 60 -o "$WORK/mat_save.json" -w '%{http_code}' \
          -X POST "$KONG_URL/rest/v1/workspace_state" \
          -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
          -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
          --data-binary "@$WORK/mat_post.json")
      else
        WS_UPD_ENC=$(encode_postgrest_ts "$WS_UPD")
        jq -nc --slurpfile s "$WORK/new_state.json" '{state:$s[0]}' > "$WORK/mat_patch.json"
        MAT_CODE=$(curl -sS --http1.1 -m 60 -o "$WORK/mat_save.json" -w '%{http_code}' \
          -X PATCH "$KONG_URL/rest/v1/workspace_state?workspace_id=eq.$E2E_WORKSPACE_ID&updated_at=eq.$WS_UPD_ENC" \
          -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
          -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
          --data-binary "@$WORK/mat_patch.json")
      fi
      if [ "$MAT_CODE" = "200" ] || [ "$MAT_CODE" = "201" ] || [ "$MAT_CODE" = "204" ]; then
        pass "Intake UI parity: campaign '$INTAKE_UI_ID' materialized in workspace_state (HTTP $MAT_CODE)."
        E2E_CAMPAIGN_ID="$INTAKE_UI_ID"
        info "Using intake-materialized campaign for sourcing-agent: $E2E_CAMPAIGN_ID"
      else
        fail "Intake UI workspace save failed (HTTP $MAT_CODE): $(head -c 200 "$WORK/mat_save.json")"
      fi
    fi
  fi
fi

# ===========================================================================
step "2b) Webhook need email — POST /api/webhooks/email-inbound"
# ===========================================================================
WEBHOOK_SECRET="${EMAIL_INBOUND_WEBHOOK_SECRET:-}"
if [ -n "$WEBHOOK_SECRET" ]; then
  # Prefer a live inbound mailbox from Settings connections; fall back to env / talent@mantu.com.
  E2E_MAILBOX="${E2E_INBOUND_MAILBOX:-}"
  if [ -z "$E2E_MAILBOX" ]; then
    api GET "$APP_URL/api/email/connections" >/dev/null 2>&1 || true
    # api() writes HTTP into $HTTP and body into $RESP
    E2E_MAILBOX=$(jq -r '
      ([.connections // [] | .[] | select((.provider // "") | test("Microsoft|Graph"; "i")) | .inboundRoute.mailbox // empty]
       + [.connections // [] | .[] | .inboundRoute.mailbox // empty]
       + [.connections // [] | .[] | .accountEmail // .account_email // empty])
      | map(select(type=="string" and length>3))
      | .[0] // empty
    ' "$RESP" 2>/dev/null || true)
  fi
  [ -n "$E2E_MAILBOX" ] || E2E_MAILBOX="talent@mantu.com"
  info "Webhook need mailbox: $E2E_MAILBOX"
  # Include Type: Permanent so heuristic readiness clears without relying on LLM invention.
  NEED_BODY=$(jq -nc \
    --arg mb "$E2E_MAILBOX" \
    --arg pid "e2e-need-$$" \
    --arg body $'Recruiter: E2E Autopilot\nRole: Senior TypeScript Engineer\nLocation: London, UK\nType: Permanent\nSkills: TypeScript, React, Node.js\nExperience: 5+ years' \
    '{mailbox:$mb,providerId:$pid,from:"noreply@mantu.example",subject:"This need is now ACTIVE: Senior TypeScript Engineer",body:$body}')
  NEED_SIG=$(printf '%s' "$NEED_BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $NF}')
  WEBHOOK_CODE=$(curl -sS -m 30 -o "$WORK/webhook_need.json" -w '%{http_code}' \
    -X POST "$APP_URL/api/webhooks/email-inbound" \
    -H 'Content-Type: application/json' \
    -H "x-aria-signature: $NEED_SIG" \
    --data-binary "$NEED_BODY")
  WEBHOOK_ROUTE=$(jq -r '.route // empty' "$WORK/webhook_need.json")
  WEBHOOK_QUEUED=$(jq -r '.jobQueued // false' "$WORK/webhook_need.json")
  WEBHOOK_KIND=$(jq -r '.jobKind // empty' "$WORK/webhook_need.json")
  WEBHOOK_CAMPAIGN_ID=""
  if [ "$WEBHOOK_CODE" = "200" ] && [ "$WEBHOOK_ROUTE" = "hiring_need" ] && [ "$WEBHOOK_KIND" = "requisition_parse" ] && [ "$WEBHOOK_QUEUED" = "true" ]; then
    pass "Webhook need email queued requisition_parse (route=$WEBHOOK_ROUTE, jobKind=$WEBHOOK_KIND)."
    # Wait for the loop worker to materialize a campaign from requisition_parse
    # (workspace_state is member-readable; aria_jobs is service-only).
    NEED_TITLE="Senior TypeScript Engineer"
    WORKER_OK=0
    info "Polling workspace_state for campaign title matching '${NEED_TITLE}' (loop worker)…"
    for _poll in $(seq 1 36); do
      curl -sS -m 20 -o "$WORK/ws_state.json" \
        "$KONG_URL/rest/v1/workspace_state?select=state&limit=1" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H 'Accept: application/json' >/dev/null 2>&1 || true
      FOUND=$(jq -r --arg t "$NEED_TITLE" '
        (.[0].state.campaigns // [])
        | map(select((.jobAnalysis.title // .title // "") | test($t; "i")))
        | length
      ' "$WORK/ws_state.json" 2>/dev/null || echo 0)
      if [ "${FOUND:-0}" -gt 0 ] 2>/dev/null; then
        WEBHOOK_CAMPAIGN_ID=$(jq -r --arg t "$NEED_TITLE" '
          (.[0].state.campaigns // [])
          | map(select((.jobAnalysis.title // .title // "") | test($t; "i")))
          | map(select(.id != "camp-e2e" and (.id | test("^camp_[0-9]+_") | not)))
          | .[0].id // empty
        ' "$WORK/ws_state.json" 2>/dev/null || true)
        if [ -z "$WEBHOOK_CAMPAIGN_ID" ]; then
          WEBHOOK_CAMPAIGN_ID=$(jq -r --arg t "$NEED_TITLE" '
            (.[0].state.campaigns // [])
            | map(select((.jobAnalysis.title // .title // "") | test($t; "i")))
            | .[0].id // empty
          ' "$WORK/ws_state.json" 2>/dev/null || true)
        fi
        WORKER_OK=1
        break
      fi
      sleep 5
    done
    if [ "$WORKER_OK" = "1" ]; then
      pass "Loop worker materialized campaign for webhook need (title match '${NEED_TITLE}' id='${WEBHOOK_CAMPAIGN_ID:-?}')."
      if [ -n "$WEBHOOK_CAMPAIGN_ID" ] && [ -z "${E2E_CAMPAIGN_ID:-}" ]; then
        E2E_CAMPAIGN_ID="$WEBHOOK_CAMPAIGN_ID"
        info "Using webhook-materialized campaign for sourcing-agent: $E2E_CAMPAIGN_ID"
      fi
    else
      fail "Webhook queued requisition_parse but no matching campaign appeared in workspace_state within ~180s (arm loop worker / kill_switch / ARIA_LOOP_KILL_SWITCH)."
    fi
  else
    fail "Webhook need email (HTTP $WEBHOOK_CODE route=$WEBHOOK_ROUTE kind=$WEBHOOK_KIND queued=$WEBHOOK_QUEUED): $(head -c 300 "$WORK/webhook_need.json")"
  fi
else
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
    if [ "${ARIA_ALLOW_SKIP_WEBHOOK_E2E:-}" = "1" ]; then
      warn "EMAIL_INBOUND_WEBHOOK_SECRET unset — skipping webhook need-email step (ARIA_ALLOW_SKIP_WEBHOOK_E2E=1)."
      E2E_SKIP_WEBHOOK=1
    else
      fail "EMAIL_INBOUND_WEBHOOK_SECRET unset on Fly E2E — hiring-need webhook step required."
    fi
  else
    warn "EMAIL_INBOUND_WEBHOOK_SECRET unset — skipping webhook need-email step."
    E2E_SKIP_WEBHOOK=1
  fi
fi

# ===========================================================================
step "2c) Graph webhook validation handshake — GET/POST validationToken"
# ===========================================================================
GRAPH_VALID_CODE=$(curl -sS -m 20 -o "$WORK/graph_validation.txt" -w '%{http_code}' \
  "$APP_URL/api/webhooks/microsoft-graph?validationToken=e2e-graph-validation-token")
GRAPH_VALID_BODY=$(tr -d '\r\n' < "$WORK/graph_validation.txt")
if [ "$GRAPH_VALID_CODE" = "200" ] && [ "$GRAPH_VALID_BODY" = "e2e-graph-validation-token" ]; then
  pass "Graph webhook validationToken echo (HTTP 200 plain text)."
else
  fail "Graph validationToken handshake (HTTP $GRAPH_VALID_CODE body=$(head -c 120 "$WORK/graph_validation.txt"))."
fi

# Graph-shaped notification with unknown subscriptionId must 202 without inventing ingest.
jq -n '{
  value:[{
    subscriptionId:"e2e-unknown-subscription",
    clientState:"e2e-forged",
    changeType:"created",
    resource:"Users/u/Messages('\''AAMkAGE2e2e'\'')",
    resourceData:{id:"AAMkAGE2e2e"}
  }]
}' > "$WORK/graph_notify.json"
GRAPH_NOTIFY_CODE=$(curl -sS -m 20 -o "$WORK/graph_notify_resp.json" -w '%{http_code}' \
  -X POST "$APP_URL/api/webhooks/microsoft-graph" \
  -H 'Content-Type: application/json' \
  --data-binary @"$WORK/graph_notify.json")
GRAPH_NOTIFY_STATUS=$(jq -r '.results[0].status // empty' "$WORK/graph_notify_resp.json" 2>/dev/null || true)
if [ "$GRAPH_NOTIFY_CODE" = "202" ] && [ "$GRAPH_NOTIFY_STATUS" = "unknown_subscription" ]; then
  pass "Graph notification envelope accepted (202) and unknown subscription rejected without ingest."
else
  fail "Graph notification path (HTTP $GRAPH_NOTIFY_CODE status='$GRAPH_NOTIFY_STATUS'): $(head -c 200 "$WORK/graph_notify_resp.json")"
fi
# Source contract: Graph absent → fail-closed non-retryable statuses (no invent enqueue).
if grep -q 'token_unavailable' src/lib/email-graph-subscriptions.ts \
  && grep -q 'connection_missing' src/lib/email-graph-subscriptions.ts \
  && grep -q 'never invents a hiring-need enqueue' src/app/api/webhooks/microsoft-graph/route.ts \
  && grep -q 'r.status === "message_fetch_failed"' src/app/api/webhooks/microsoft-graph/route.ts; then
  RETRYABLE_BLOCK=$(awk '/const retryable = results.some/,/\);/' src/app/api/webhooks/microsoft-graph/route.ts)
  if printf '%s' "$RETRYABLE_BLOCK" | grep -q 'message_fetch_failed' \
    && ! printf '%s' "$RETRYABLE_BLOCK" | grep -q 'token_unavailable' \
    && ! printf '%s' "$RETRYABLE_BLOCK" | grep -q 'connection_missing'; then
    pass "Graph absent fail-closed: token/connection gaps are non-retryable (HMAC path still enqueues hiring needs)."
  else
    fail "Graph retryable predicate must include only message_fetch_failed/ingest_5xx — not token/connection gaps."
  fi
else
  fail "Graph fail-closed token/connection distinction missing from webhook ingest."
fi

# Static honesty asserts that do not need a live Outlook/Teams calendar seat.
if grep -q 'bookingInterviewTitle' src/lib/booking-status.ts \
  && grep -q 'Needs calendar:' src/lib/booking-status.ts \
  && grep -q 'Mantu Group is hiring' src/lib/i18n.ts \
  && grep -q 'Mantu Group is hiring' src/lib/seed.ts \
  && grep -q 'bookingInterviewTitle(booking' src/lib/seed.ts \
  && grep -q 'bookingInterviewTitle(res.booking' src/components/candidates/candidate-drawer.tsx \
  && grep -q 'hiring_need_handler' src/app/api/email/test/route.ts \
  && grep -q 'Graph subscription optional' src/app/api/email/test/route.ts \
  && grep -q 'DEFAULT_SHORTLIST_MIN_SCORE' src/lib/langchain/recruiting-graph.ts \
  && grep -q 'shortlist_below_min_score' scripts/sourcing-loop-worker.mjs; then
  pass "Non-MS honesty pins: booking Needs calendar titles, Mantu drafts, hiring_need_handler without Graph, top-10 min score."
else
  fail "Non-MS honesty pins missing (booking title / Mantu drafts / hiring_need_handler / shortlist min score)."
fi

# ===========================================================================
step "2d) M365 connections + Entra reporting surface"
# ===========================================================================
api GET "$APP_URL/api/email/connections"
CONN_OK=$(jq -r '.ok // false' "$RESP")
MS_OAUTH=$(jq -r '.providers.microsoftOAuth // false' "$RESP")
INBOUND_READY=$(jq -r '.providers.inboundWebhookSecret // false' "$RESP")
if [ "$HTTP" = "200" ] && [ "$CONN_OK" = "true" ]; then
  pass "GET /api/email/connections ok (providers=$(jq -c '.providers // {}' "$RESP"))."
else
  fail "GET /api/email/connections failed (HTTP $HTTP): $(head -c 200 "$RESP")"
fi
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" != "1" ]; then
  if [ "$MS_OAUTH" = "true" ]; then
    pass "Fly microsoftOAuth provider ready (MICROSOFT_CLIENT_* configured)."
  else
    fail "Fly enterprise requires microsoftOAuth=true on /api/email/connections (set MICROSOFT_CLIENT_ID/SECRET)."
  fi
  if [ "$INBOUND_READY" = "true" ]; then
    pass "Fly inboundWebhookSecret provider ready."
  else
    fail "Fly enterprise requires inboundWebhookSecret=true (set EMAIL_INBOUND_WEBHOOK_SECRET)."
  fi
  GRAPH_ACTIVE_N=$(jq -r '
    [(.connections // [])[]
      | select(
          (.provider // "") == "Microsoft Graph"
          and (.hasRefreshToken == true)
          and ((.graphSubscription.active // false) == true)
        )
    ] | length
  ' "$RESP" 2>/dev/null || echo 0)
  GRAPH_CONNECTED_N=$(jq -r '
    [(.connections // [])[]
      | select((.provider // "") == "Microsoft Graph" and (.hasRefreshToken == true))
    ] | length
  ' "$RESP" 2>/dev/null || echo 0)
  if [ "${GRAPH_CONNECTED_N:-0}" -gt 0 ]; then
    if [ "${GRAPH_ACTIVE_N:-0}" -gt 0 ]; then
      pass "Fly Graph mail subscription active on a connected Outlook mailbox (push intake, no polling)."
    else
      fail "Fly Outlook is connected but graphSubscription.active is false — Enable webhook under Connect email before E2E PASS."
    fi
  else
    info "No connected Outlook mailbox yet — Graph subscription check deferred until Connect Outlook."
  fi
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" = "1" ]; then
  # Honest PARTIAL: soft-skip Graph/Teams only. Generic HMAC inbound webhook is
  # the non-MS hiring-need intake path — still required for PARTIAL green.
  if [ "$MS_OAUTH" != "true" ]; then
    warn "PARTIAL: microsoftOAuth=false — MICROSOFT_CLIENT_* not ready; calendar/Teams steps will skip."
    E2E_SKIP_M365=1
  fi
  if [ "$INBOUND_READY" = "true" ]; then
    pass "Fly inboundWebhookSecret provider ready (HMAC intake; independent of Graph)."
  else
    fail "PARTIAL still requires inboundWebhookSecret=true (EMAIL_INBOUND_WEBHOOK_SECRET) for hiring-need intake."
  fi
  # After tip 0073: register an HMAC-only intake mailbox without OAuth.
  HMAC_MAIL="e2e-hmac-$(date -u +%Y%m%d%H%M%S)@aria-e2e.test"
  jq -nc --arg m "$HMAC_MAIL" '{action:"register_hmac_mailbox",mailbox:$m,purpose:"intake"}' > "$WORK/hmac_register.json"
  api POST "$APP_URL/api/email/connections" "$WORK/hmac_register.json"
  HMAC_HTTP="$HTTP"
  HMAC_RESP="$(cat "$RESP")"
  HMAC_OK=$(jq -r '.ok // false' <<<"$HMAC_RESP")
  HMAC_ONLY=$(jq -r '.hmacOnly // false' <<<"$HMAC_RESP")
  HMAC_ROUTE=$(jq -r '.routeId // empty' <<<"$HMAC_RESP")
  if [ "$HMAC_HTTP" = "200" ] && [ "$HMAC_OK" = "true" ] && { [ "$HMAC_ONLY" = "true" ] || [ -n "$HMAC_ROUTE" ]; }; then
    pass "POST register_hmac_mailbox ok (mailbox=$HMAC_MAIL, no OAuth)."
    api GET "$APP_URL/api/email/connections"
    HMAC_LISTED=$(jq -r --arg m "$(printf '%s' "$HMAC_MAIL" | tr '[:upper:]' '[:lower:]')" '
      [(.hmacRoutes // [])[] | select((.mailbox // "") == $m and (.active == true))] | length
    ' "$RESP" 2>/dev/null || echo 0)
    if [ "${HMAC_LISTED:-0}" -gt 0 ]; then
      pass "GET connections lists HMAC route for $HMAC_MAIL."
    else
      fail "HMAC mailbox registered but missing from hmacRoutes on GET connections."
    fi
  elif [ "$HMAC_HTTP" = "503" ] && jq -r '.error // empty' <<<"$HMAC_RESP" | grep -qi '0073'; then
    fail "register_hmac_mailbox 503 — migration 0073 missing on live Fly (deploy tip)."
  else
    fail "register_hmac_mailbox failed (HTTP ${HMAC_HTTP:-empty}): $(head -c 240 <<<"$HMAC_RESP")"
  fi
fi
# email/test hiring_need_handler: ready without Graph (HMAC path). Assert when any mailbox seat exists.
TEST_SEAT=$(jq -r '
  ([.connections // [] | .[] | .seatId // empty]
   | map(select(type=="string" and length>0))
   | .[0] // empty)
' "$RESP" 2>/dev/null || true)
if [ -n "$TEST_SEAT" ]; then
  jq -nc --arg s "$TEST_SEAT" '{seatId:$s}' > "$WORK/email_test_req.json"
  api POST "$APP_URL/api/email/test" "$WORK/email_test_req.json"
  HN_OK=$(jq -r '[.checks // [] | .[] | select(.id=="hiring_need_handler") | .ok] | .[0] // empty' "$RESP" 2>/dev/null || true)
  HN_DETAIL=$(jq -r '[.checks // [] | .[] | select(.id=="hiring_need_handler") | .detail] | .[0] // empty' "$RESP" 2>/dev/null || true)
  if [ "$HTTP" = "200" ] && [ "$HN_OK" = "true" ]; then
    pass "POST /api/email/test hiring_need_handler ready without requiring Graph subscription ($HN_DETAIL)."
  elif [ "$HTTP" = "200" ] && [ "$HN_OK" = "false" ]; then
    # Honest gap: mailbox connected but inbound route/secret not armed — not a calendar gap.
    fail "hiring_need_handler not ready: $HN_DETAIL"
  elif [ "$HTTP" = "404" ]; then
    warn "email/test 404 — seat has no mailbox row (skipped hiring_need_handler live assert)."
  else
    fail "email/test unexpected (HTTP $HTTP): $(head -c 200 "$RESP")"
  fi
else
  info "No email connection seat — skipped live hiring_need_handler assert (static pin still required)."
fi
if grep -q 'graphSubscription' src/app/api/email/connections/route.ts \
  && grep -q 'ensure_graph_webhook' src/app/api/email/connections/route.ts \
  && grep -q 'Enable webhook' src/components/settings/email-connections-panel.tsx; then
  pass "Graph webhook ensure/repair wired in connections API + settings UI."
else
  fail "Graph webhook ensure/repair surface missing."
fi
if grep -q 'propose-calendar-book' scripts/sourcing-loop-worker.mjs \
  && grep -q 'confirm-calendar-book' scripts/sourcing-loop-worker.mjs \
  && grep -q 'calendarConfirmUrl' scripts/sourcing-loop-worker.mjs \
  && grep -q 'claimCalendarBooking' src/app/api/cron/propose-calendar-book/route.ts \
  && grep -q 'interviewProposal' scripts/sourcing-loop-worker.mjs \
  && grep -q 'use_calendar_event_route' src/app/api/cron/propose-calendar-book/route.ts \
  && grep -q 'loop_confirm_live' scripts/sourcing-loop-worker.mjs; then
  pass "calendar_book → propose dry-run + confirm-calendar-book live Teams (fallback propose) + interviewProposal."
else
  fail "calendar propose/confirm path missing interviewProposal, confirm-calendar-book, or use_calendar_event_route guard."
fi
# Positive interest → pre_call_propose only after live model classification
# (keyword deterministic_fallback must not invent successors).
if grep -q 'classifier === "model"' scripts/sourcing-loop-worker.mjs \
  && grep -q 'inbound_classify->pre_call_propose' scripts/sourcing-loop-worker.mjs \
  && grep -q 'trigger: "inbound_classify"' scripts/sourcing-loop-worker.mjs; then
  pass "inbound_classify positive interest → pre_call_propose only when classifier=model."
else
  fail "interest→pre_call_propose model-only wiring missing from loop worker."
fi

# ===========================================================================
step "2c) Reply webhook — POST /api/webhooks/email-inbound (inbound_classify)"
# ===========================================================================
if [ -n "$WEBHOOK_SECRET" ]; then
  REPLY_BODY=$(jq -nc \
    --arg mb "${E2E_MAILBOX:-talent@mantu.com}" \
    --arg pid "e2e-reply-$$" \
    '{mailbox:$mb,providerId:$pid,from:"candidate@example.com",subject:"Re: Senior TypeScript Engineer opportunity",body:"Yes, I am interested in learning more about the role. When can we speak?",inReplyTo:"<outbound-msg-e2e@mantu.example>"}')
  REPLY_SIG=$(printf '%s' "$REPLY_BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $NF}')
  REPLY_CODE=$(curl -sS -m 30 -o "$WORK/webhook_reply.json" -w '%{http_code}' \
    -X POST "$APP_URL/api/webhooks/email-inbound" \
    -H 'Content-Type: application/json' \
    -H "x-aria-signature: $REPLY_SIG" \
    --data-binary "$REPLY_BODY")
  REPLY_ROUTE=$(jq -r '.route // empty' "$WORK/webhook_reply.json")
  REPLY_QUEUED=$(jq -r '.jobQueued // false' "$WORK/webhook_reply.json")
  REPLY_KIND=$(jq -r '.jobKind // empty' "$WORK/webhook_reply.json")
  if [ "$REPLY_CODE" = "200" ] && [ "$REPLY_ROUTE" = "reply_classify" ] && [ "$REPLY_KIND" = "inbound_classify" ] && [ "$REPLY_QUEUED" = "true" ]; then
    pass "Webhook candidate reply queued inbound_classify (route=$REPLY_ROUTE, jobKind=$REPLY_KIND)."
  elif [ "$REPLY_CODE" = "200" ] && [ "$REPLY_ROUTE" = "none" ] \
    && [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SKIP_REPLY_CLASSIFY_E2E:-}" = "1" ]; then
    warn "Reply webhook route=none ($(jq -r '.reason // empty' "$WORK/webhook_reply.json")) — ARIA_ALLOW_SKIP_REPLY_CLASSIFY_E2E=1 soft-skip."
  elif [ "$REPLY_CODE" = "200" ] && [ "$REPLY_ROUTE" = "none" ] && [ "$APP_URL" != "https://aria-mantu-app.fly.dev" ]; then
    warn "Reply webhook returned route=none ($(jq -r '.reason // empty' "$WORK/webhook_reply.json")) — classify enqueue proxy covered by tests/inbound-reply-trigger.mts."
  else
    fail "Reply webhook expected inbound_classify enqueue; got HTTP $REPLY_CODE route='$REPLY_ROUTE' kind='$REPLY_KIND': $(head -c 200 "$WORK/webhook_reply.json")"
  fi
else
  info "EMAIL_INBOUND_WEBHOOK_SECRET unset — reply webhook live assert skipped (static pins still required)."
fi
if grep -q 'decideInterviewPrepEnqueue' src/lib/interview-prep-trigger.ts \
  && grep -q 'interview_prep_send' scripts/sourcing-loop-worker.mjs \
  && grep -q 'handleInterviewPrepSend' scripts/sourcing-loop-worker.mjs \
  && grep -q 'interview-prep-dispatch' src/app/api/cron/interview-prep-dispatch/route.ts \
  && grep -q '/api/booking/interview-prep' src/lib/store.ts; then
  pass "Live booking → interview_prep_send enqueue + approval-gated prep dispatch wired."
else
  fail "Interview prep dispatch wiring missing (trigger, worker handler, cron route, or store enqueue)."
fi
if [ -f supabase/migrations/0071_interview_prep_send_loop_kind.sql ] \
  && grep -q "interview_prep_send" supabase/migrations/0071_interview_prep_send_loop_kind.sql; then
  pass "Migration 0071 adds interview_prep_send loop kind."
else
  fail "Migration 0071 interview_prep_send missing."
fi

# ===========================================================================
step "2e) HeyReach MCP LinkedIn outreach stack (production allowlist)"
# ===========================================================================
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  api GET "$APP_URL/api/admin/mcp/allowlist"
  HR_N=$(jq -r '
    [(.entries // [])[]
      | select(
          ((.base_url // "") | test("mcp\\.heyreach\\.io"; "i"))
          and ((.enabled // false) == true)
          and ((.tool_manifest_sha256 // "") | test("^[0-9a-f]{64}$"))
        )
    ] | length
  ' "$RESP" 2>/dev/null || echo 0)
  if [ "$HTTP" = "200" ] && [ "${HR_N:-0}" -gt 0 ]; then
    pass "HeyReach MCP allowlisted for workspace (enabled + manifest hash)."
  else
    fail "HeyReach MCP allowlist missing/disabled on Fly (HTTP $HTTP entries=$HR_N). Connect via Settings → Integrations."
  fi
  curl -sS -m 20 -o "$WORK/ws_heyreach.json" \
    "$KONG_URL/rest/v1/workspace_state?select=state&limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'Accept: application/json' >/dev/null 2>&1 || true
  HR_MCP=$(jq -r '
    (.[0].state.settings.mcpServers // [])
    | map(select(
        ((.preset // "") == "heyreach" or ((.url // "") | test("mcp\\.heyreach\\.io"; "i")))
        and ((.enabled // false) == true)
        and ((.status // "") == "connected")
      ))
    | length
  ' "$WORK/ws_heyreach.json" 2>/dev/null || echo 0)
  HR_INTEG=$(jq -r '
    (.[0].state.integrations // [])
    | map(select((.id // "") == "int_heyreach" and ((.status // "") == "connected")))
    | length
  ' "$WORK/ws_heyreach.json" 2>/dev/null || echo 0)
  if [ "${HR_MCP:-0}" -gt 0 ] && [ "${HR_INTEG:-0}" -gt 0 ]; then
    pass "Workspace HeyReach MCP server connected (agents can list LinkedIn outreach tools)."
  else
    fail "Workspace HeyReach MCP not connected (mcp=$HR_MCP integ=$HR_INTEG)."
  fi
else
  info "Non-Fly host — HeyReach allowlist/live connect check skipped."
fi
if grep -q 'HEYREACH_MCP_HOST' src/lib/heyreach-mcp.ts \
  && grep -q 'Connect HeyReach MCP' src/components/settings/heyreach-mcp-panel.tsx; then
  pass "HeyReach MCP settings panel + host guard present in source."
else
  fail "HeyReach MCP settings wiring missing."
fi

if grep -q 'outlook.body-content-type' src/lib/email-graph-subscriptions.ts \
  && grep -q 'normalizeGraphMessageBody' src/lib/email-graph-subscriptions.ts \
  && grep -q 'Job enqueue rejected' src/lib/inbound-email-ingest.ts; then
  pass "Graph hiring-need ingest prefers text body + durable enqueue status honesty."
else
  fail "Graph ingest text Prefer or enqueue-status honesty missing."
fi
if grep -q 'not live-verified' src/components/settings/microsoft365-stack.tsx \
  && grep -q 'of 3 live mailbox steps' src/components/settings/microsoft365-stack.tsx; then
  pass "Entra SSO settings surface does not treat login flag as M365-ready."
else
  fail "Entra SSO settings honesty (flag ≠ ready) missing."
fi
if grep -q 'llm_required' src/app/api/cron/parse-inbound-need/route.ts \
  && grep -q 'llm_required' src/app/api/intake/route.ts \
  && grep -q 'critics_required' src/app/api/cron/generate-outreach-draft/route.ts \
  && grep -q 'intent: "draft_quality"' src/app/api/cron/generate-outreach-draft/route.ts \
  && grep -q 'graph_stage_invalid' src/app/api/cron/generate-outreach-draft/route.ts; then
  pass "Autonomous parse/draft/intake fail closed (llm_required + critics_required + draft_quality stage honesty)."
else
  fail "LLM fail-closed guards missing from parse, intake, or draft routes."
fi

# Live cron auth probe (route present + fail-closed without Bearer).
CRON_PROBE_CODE=$(curl -sS -m 20 -o "$WORK/cron_draft_unauth.json" -w '%{http_code}' \
  -X POST "$APP_URL/api/cron/generate-outreach-draft" \
  -H 'Content-Type: application/json' \
  --data '{"workspaceId":"00000000-0000-4000-8000-000000000000","campaignId":"camp-e2e","candidateId":"cand-e2e"}')
if [ "$CRON_PROBE_CODE" = "401" ]; then
  pass "POST /api/cron/generate-outreach-draft rejects unauthenticated cron (401)."
else
  fail "Expected 401 from generate-outreach-draft without CRON_SECRET; got HTTP $CRON_PROBE_CODE."
fi
# LangGraph stage checkpoint must be live on the app (worker calls this after parse/rank/book).
GRAPH_STAGE_PROBE_CODE=$(curl -sS -m 20 -o "$WORK/cron_graph_stage_unauth.json" -w '%{http_code}' \
  -X POST "$APP_URL/api/cron/recruiting-graph-stage" \
  -H 'Content-Type: application/json' \
  --data '{"workspaceId":"00000000-0000-4000-8000-000000000000","intent":"book_only","allowedStages":["queued_for_approval"]}')
if [ "$GRAPH_STAGE_PROBE_CODE" = "401" ]; then
  pass "POST /api/cron/recruiting-graph-stage rejects unauthenticated cron (401)."
else
  fail "Expected 401 from recruiting-graph-stage without CRON_SECRET; got HTTP $GRAPH_STAGE_PROBE_CODE (route missing on deploy?)."
fi
if [ -n "${CRON_SECRET:-}" ]; then
  CRON_AUTH_CODE=$(curl -sS -m 30 -o "$WORK/cron_draft_auth.json" -w '%{http_code}' \
    -X POST "$APP_URL/api/cron/generate-outreach-draft" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CRON_SECRET" \
    --data '{"workspaceId":"00000000-0000-4000-8000-000000000000","campaignId":"camp-missing","candidateId":"cand-missing"}')
  CRON_AUTH_STATUS=$(jq -r '.status // empty' "$WORK/cron_draft_auth.json" 2>/dev/null || true)
  if [ "$CRON_AUTH_CODE" = "404" ] || [ "$CRON_AUTH_CODE" = "503" ]; then
    pass "Authenticated draft cron fail-closed on missing workspace/candidate (HTTP $CRON_AUTH_CODE status=$CRON_AUTH_STATUS)."
  elif [ "$CRON_AUTH_CODE" = "401" ]; then
    fail "CRON_SECRET rejected by generate-outreach-draft (HTTP 401) — secret mismatch with Fly."
  else
    fail "Unexpected authenticated draft cron response HTTP $CRON_AUTH_CODE: $(head -c 200 "$WORK/cron_draft_auth.json")"
  fi
  GRAPH_STAGE_AUTH_CODE=$(curl -sS -m 30 -o "$WORK/cron_graph_stage_auth.json" -w '%{http_code}' \
    -X POST "$APP_URL/api/cron/recruiting-graph-stage" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $CRON_SECRET" \
    --data '{"workspaceId":"00000000-0000-4000-8000-000000000000","intent":"book_only","allowedStages":["queued_for_approval"]}')
  GRAPH_STAGE_OK=$(jq -r '.ok // false' "$WORK/cron_graph_stage_auth.json" 2>/dev/null || true)
  GRAPH_STAGE_NAME=$(jq -r '.stage // empty' "$WORK/cron_graph_stage_auth.json" 2>/dev/null || true)
  GRAPH_STAGE_REASON=$(jq -r '.status // empty' "$WORK/cron_graph_stage_auth.json" 2>/dev/null || true)
  if [ "$GRAPH_STAGE_AUTH_CODE" = "200" ] && [ "$GRAPH_STAGE_OK" = "true" ] && [ -n "$GRAPH_STAGE_NAME" ]; then
    pass "Authenticated recruiting-graph-stage book_only → stage=$GRAPH_STAGE_NAME."
  elif [ "$GRAPH_STAGE_AUTH_CODE" = "401" ]; then
    fail "CRON_SECRET rejected by recruiting-graph-stage (HTTP 401) — secret mismatch with Fly."
  elif [ "$GRAPH_STAGE_AUTH_CODE" = "400" ] || [ "$GRAPH_STAGE_AUTH_CODE" = "503" ]; then
    pass "Authenticated recruiting-graph-stage fail-closed (HTTP $GRAPH_STAGE_AUTH_CODE) — route live."
  elif [ "$GRAPH_STAGE_AUTH_CODE" = "422" ]; then
    pass "Authenticated recruiting-graph-stage fail-closed (422 status=${GRAPH_STAGE_REASON:-unknown} stage=${GRAPH_STAGE_NAME:-none})."
  else
    fail "Unexpected recruiting-graph-stage response HTTP $GRAPH_STAGE_AUTH_CODE: $(head -c 200 "$WORK/cron_graph_stage_auth.json")"
  fi
else
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SKIP_CRON_E2E:-}" != "1" ]; then
    fail "CRON_SECRET unset on Fly — authenticated draft/graph-stage cron probes are required (set ARIA_ALLOW_SKIP_CRON_E2E=1 only for partial runs)."
  else
    E2E_SKIP_CRON=1
    warn "CRON_SECRET unset — skipped authenticated draft/graph-stage cron fail-closed probes."
  fi
fi

# Entra SSO surface: login page exposes Azure only when the public flag is compiled in.
# After tip deploy with GoTrue Azure secrets, fly-deploy-now sets NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true.
if grep -q 'azureLoginEnabled' src/app/login/page.tsx \
  && grep -q 'provider: "azure"' src/app/login/page.tsx \
  && grep -q 'NEXT_PUBLIC_ENABLE_AZURE_LOGIN' fly.app.toml; then
  pass "Entra SSO login surface is flag-gated (azure provider + NEXT_PUBLIC_ENABLE_AZURE_LOGIN)."
else
  fail "Entra SSO login surface missing or not flag-gated."
fi
# Live proof: when GoTrue Azure secrets are on Fly, the reminted tip must show the CTA.
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  ENTRA_SECRETS_OK=1
  for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
    if ! flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
      ENTRA_SECRETS_OK=0
      break
    fi
  done
  if [ "$ENTRA_SECRETS_OK" = "1" ]; then
    LOGIN_HTML="$(curl -fsS "$APP_URL/login" 2>/dev/null || true)"
    if printf '%s' "$LOGIN_HTML" | grep -q 'Sign in with Microsoft'; then
      pass "Live /login exposes Sign in with Microsoft (Entra SSO remint baked NEXT_PUBLIC_ENABLE_AZURE_LOGIN)."
    else
      fail "GoTrue Azure secrets present but /login missing Sign in with Microsoft — remint tip with NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true."
    fi
  else
    info "GoTrue Azure secrets incomplete — skipped live /login Entra CTA assert."
  fi
fi

# ===========================================================================
step "2f) parse→campaign→sourcing→draft→quality chain (contracts + webhook progress)"
# ===========================================================================
if grep -q 'priorStatus === "campaign_created"' scripts/sourcing-loop-worker.mjs \
  && grep -q 'key !== "graphStage"' scripts/sourcing-loop-worker.mjs \
  && grep -q 'handleCampaignCreate' scripts/sourcing-loop-worker.mjs \
  && grep -q 'run-sourcing-batch' scripts/sourcing-loop-worker.mjs \
  && grep -q 'generate-outreach-draft' scripts/sourcing-loop-worker.mjs \
  && grep -q 'dryRun: true' scripts/sourcing-loop-worker.mjs \
  && grep -q 'Needs Approval' scripts/sourcing-loop-worker.mjs \
  && grep -q 'shortlistMinScore: minScore' scripts/sourcing-loop-worker.mjs \
  && grep -q 'graphResult.stage === "approval_blocked"' src/app/api/cron/generate-outreach-draft/route.ts \
  && grep -q 'quality_critics_incomplete' src/app/api/cron/generate-outreach-draft/route.ts \
  && grep -q 'stale graph "blocked"' src/app/api/cron/generate-outreach-draft/route.ts \
  && grep -q 'validateOutreachQualityLive' src/app/api/cron/generate-outreach-draft/route.ts; then
  pass "Loop chain pins: graphStage strip, campaign→sourcing→draft dry-run, live re-validation recovers stale approval_blocked."
else
  fail "parse→campaign→sourcing→draft→quality chain contract pins missing from worker/draft routes."
fi
if [ -n "${WEBHOOK_CAMPAIGN_ID:-}" ]; then
  curl -sS -m 20 -o "$WORK/ws_chain.json" \
    "$KONG_URL/rest/v1/workspace_state?select=state&limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H 'Accept: application/json' >/dev/null 2>&1 || true
  CHAIN_CAMP_STATUS=$(jq -r --arg id "$WEBHOOK_CAMPAIGN_ID" '
    (.[0].state.campaigns // [])
    | map(select(.id == $id))
    | .[0].status // empty
  ' "$WORK/ws_chain.json" 2>/dev/null || true)
  CHAIN_CAND_N=$(jq -r --arg id "$WEBHOOK_CAMPAIGN_ID" '
    (.[0].state.candidates // [])
    | map(select(.campaignId == $id))
    | length
  ' "$WORK/ws_chain.json" 2>/dev/null || echo 0)
  CHAIN_DRAFT_N=$(jq -r --arg id "$WEBHOOK_CAMPAIGN_ID" '
    (.[0].state.outreach // [])
    | map(select(.campaignId == $id and (.status // "") == "Needs Approval"))
    | length
  ' "$WORK/ws_chain.json" 2>/dev/null || echo 0)
  info "Webhook campaign chain snapshot: status='${CHAIN_CAMP_STATUS:-?}' candidates=${CHAIN_CAND_N:-0} needs_approval_drafts=${CHAIN_DRAFT_N:-0} (live build ${READY_BUILD:0:12})."
  if [ "${CHAIN_CAND_N:-0}" -gt 0 ] 2>/dev/null || [ "${CHAIN_DRAFT_N:-0}" -gt 0 ] 2>/dev/null; then
    pass "Webhook campaign chain progressed past parse (candidates=${CHAIN_CAND_N:-0} drafts=${CHAIN_DRAFT_N:-0})."
  elif [ "$CHAIN_CAMP_STATUS" = "Sourcing" ] || [ "$CHAIN_CAMP_STATUS" = "Active" ]; then
    pass "Webhook campaign status=${CHAIN_CAMP_STATUS} — sourcing stage reached."
  elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_STALE_FLY_E2E:-}" != "1" ]; then
    fail "Webhook campaign stalled at status='${CHAIN_CAMP_STATUS:-none}' with 0 candidates — tip deploy required (graphStage strip + campaign_create resume on build ${READY_BUILD:0:12})."
  else
    warn "Webhook campaign stalled (status='${CHAIN_CAMP_STATUS:-none}' candidates=0) — expected on stale live until tip deploy."
  fi
else
  info "No webhook-materialized campaign — skipped live chain progress probe."
fi

# ===========================================================================
step "3) Sourcing — REAL candidates (GitHub raw, LinkedIn/Tavily, provenance=live)"
# ===========================================================================

# 3a/3b. /api/source must REFUSE live campaign search in a live tenant.
#
# These two steps used to post a raw query to /api/source and expect real users
# and leads back. Against a live tenant that can never succeed and never could:
# src/app/api/source/route.ts:125-134 answers 409 CAMPAIGN_AUTHORITY_REQUIRED by
# design, so live search "cannot bypass campaign readiness, idempotency, learning
# receipts, or configuration authority". The route keeps exact-profile intake and
# the signed demo path only. So the old steps reported a deliberate control as a
# product failure, and the harness had no way to prove live sourcing at all.
#
# The refusal is worth asserting on its own terms — it is the control that stops
# an ad-hoc query reaching a paid provider outside campaign authority. The live
# proof moves to 3c, which the script already calls the only route returning
# scored provenance="live" candidates.
for probe in "GitHub:$GITHUB_QUERY:src_gh" "LinkedIn:$LINKEDIN_QUERY:src_li"; do
  platform="${probe%%:*}"; rest="${probe#*:}"; query="${rest%:*}"; slug="${rest##*:}"
  jq -n --arg q "$query" --arg p "$platform" '{platform:$p, query:$q, count:8}' > "$WORK/$slug.json"
  api POST "$APP_URL/api/source" "$WORK/$slug.json"
  SRC_CODE=$(jq -r '.code // empty' "$RESP")
  if [ "$HTTP" = "409" ] && [ "$SRC_CODE" = "CAMPAIGN_AUTHORITY_REQUIRED" ]; then
    pass "$platform ad-hoc search REFUSED by campaign authority (409 CAMPAIGN_AUTHORITY_REQUIRED) — no provider was reached."
  elif [ "$HTTP" = "200" ] && [ "$(jq -r '.ok // false' "$RESP")" = "true" ]; then
    fail "$platform ad-hoc search SUCCEEDED against /api/source (HTTP 200) — live campaign search must not bypass campaign authority."
  else
    fail "$platform ad-hoc search returned an unexpected verdict (HTTP $HTTP, code=$SRC_CODE): $(jq -rc '.error // empty' "$RESP")"
  fi
done

# 3c. Agentic sourcing — the only HTTP route that returns scored provenance="live" candidates.
jq -n \
  --slurpfile ja "$WORK/job_analysis.json" \
  --arg prov "$AGENT_PROVIDER" --arg model "$AGENT_MODEL" '
  {
    campaign: {
      id: "camp-e2e",
      title: ($ja[0].title // "Senior Engineer"),
      department: ($ja[0].department // "Engineering"),
      jobAnalysis: $ja[0],
      scoringWeights: {skills:34, experience:22, companyStage:12, industry:12, location:10, activity:10},
      sourcingStrategy: {githubQueries:[], linkedinBoolean:"", stackOverflowTags:[], excludedCompanies:[]}
    },
    existing: [],
    count: 10,
    provider: $prov
  }
  | if ($model | length) > 0 then . + {model:$model} else . end
' > "$WORK/agent_req.json"
# The route takes { campaignId, count } and an Idempotency-Key UUID header — NOT an
# inline campaign (SourcingAgentRequestSchema is .strict(), body cap 2 KB). The old
# request was rejected as INVALID_REQUEST and this step blamed a missing provider
# key, which sent three separate investigations down the wrong path. The campaign
# must already exist in workspace_state and pass evaluateNeedReadiness — there is no
# server-side route that creates one, so E2E_CAMPAIGN_ID must name a reviewed
# campaign that already exists.
# count:10 matches TOP_CANDIDATE_SHORTLIST_SIZE (top-10 shortlist objective).
AGENT_CAMPAIGN_ID="${E2E_CAMPAIGN_ID:-camp-e2e}"
jq -n --arg id "$AGENT_CAMPAIGN_ID" '{campaignId:$id, count:10}' > "$WORK/agent_req.json"
SOURCING_ATTEMPT=0
# Fly always gets retry headroom — sourcing soft-skip is NOT tied to PARTIAL_M365
# (that flag is Microsoft-only; quota/empty must not hide under M365 deferral).
# Strict Fly runs: transient sourcing quota and LLM critic saturation need headroom without partial escapes.
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  SOURCING_MAX="${E2E_SOURCING_MAX:-6}"
else
  SOURCING_MAX="${E2E_SOURCING_MAX:-2}"
fi
while [ "$SOURCING_ATTEMPT" -lt "$SOURCING_MAX" ]; do
  SOURCING_ATTEMPT=$((SOURCING_ATTEMPT + 1))
  HTTP=$(curl -sS -m "${API_TIMEOUT:-180}" -o "$RESP" -w '%{http_code}' -X POST "$APP_URL/api/sourcing-agent" \
    -H 'Content-Type: application/json' -H "Origin: $APP_URL" -H "Cookie: $COOKIE_HDR" \
    -H "Idempotency-Key: $(e2e_uuid)" --data-binary @"$WORK/agent_req.json")
  AG_N=$(jq -r '(.candidates // []) | length' "$RESP")
  AG_CODE=$(jq -r '.code // empty' "$RESP")
  if [ "$HTTP" = "200" ] && [ "$(jq -r '.ok // false' "$RESP")" = "true" ] && [ "$AG_N" -gt 0 ]; then
    break
  fi
  if [ "$SOURCING_ATTEMPT" -lt "$SOURCING_MAX" ]; then
    BACKOFF=$((5 * SOURCING_ATTEMPT))
    if [ "$HTTP" = "429" ] || [ "$AG_CODE" = "SOURCING_AGENT_RATE_LIMITED" ]; then
      BACKOFF=$((30 * SOURCING_ATTEMPT))
    fi
    warn "sourcing-agent returned n=$AG_N (HTTP $HTTP code=${AG_CODE:-none}) — retry $SOURCING_ATTEMPT/$SOURCING_MAX after ${BACKOFF}s."
    sleep "$BACKOFF"
  fi
done
AG_CODE=$(jq -r '.code // empty' "$RESP")
AG_OK=""
if [ "$HTTP" = "404" ] || [ "$AG_CODE" = "CAMPAIGN_NOT_READY" ]; then
  if [ -n "${WEBHOOK_CAMPAIGN_ID:-}" ] && [ "$AGENT_CAMPAIGN_ID" = "$WEBHOOK_CAMPAIGN_ID" ]; then
    fail "sourcing-agent: webhook campaign '$AGENT_CAMPAIGN_ID' is absent or unreviewed ($AG_CODE) — Type: Permanent need should clear readiness."
    echo 'null' > "$WORK/cand0.json"
    AG_OK="failed"
  elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SKIP_SOURCING_E2E:-}" != "1" ]; then
    fail "sourcing-agent: campaign '$AGENT_CAMPAIGN_ID' absent/unreviewed on Fly ($AG_CODE). Webhook materialization or E2E_CAMPAIGN_ID required."
    echo 'null' > "$WORK/cand0.json"
    AG_OK="failed"
  else
    info "sourcing-agent SKIPPED: campaign '$AGENT_CAMPAIGN_ID' is absent or its brief is unreviewed ($AG_CODE)."
    info "      Seed a campaign with status Sourcing whose jobAnalysis passes evaluateNeedReadiness"
    info "      (title, seniority and employmentType must not be Unspecified), then set E2E_CAMPAIGN_ID."
    echo 'null' > "$WORK/cand0.json"
    AG_OK="skipped"
  fi
fi
[ "${AG_OK:-}" = "skipped" ] || [ "${AG_OK:-}" = "failed" ] || AG_OK=$(jq -r '.ok // false' "$RESP")
AG_N=$(jq -r '(.candidates // []) | length' "$RESP")
AG_LIVE=$(jq -r '[(.candidates // [])[] | select(.provenance=="live")] | length' "$RESP")
AG_URLED=$(jq -r '[(.candidates // [])[] | select(([(.githubUrl // ""), (.linkedinUrl // ""), (.sourceUrl // "")] | any(. != "")))] | length' "$RESP")
if [ "$AG_OK" = "skipped" ] || [ "$AG_OK" = "failed" ]; then
  : # already reported above
elif [ "$HTTP" = "200" ] && [ "$AG_OK" = "true" ] && [ "$AG_N" -gt 0 ] && [ "$AG_LIVE" = "$AG_N" ] && [ "$AG_URLED" -gt 0 ]; then
  # Requested top-10 shortlist size; accept any live batch ≥1 (providers may return fewer).
  if [ "$AG_N" -ge 10 ]; then
    pass "Agent returned top-10 shortlist ($AG_N), ALL provenance=\"live\", $AG_URLED with real profile URLs (totalFound=$(jq -r '.totalFound' "$RESP"))."
  else
    pass "Agent returned $AG_N live candidates (requested count:10 / top-10 shortlist), ALL provenance=\"live\", $AG_URLED with real profile URLs (totalFound=$(jq -r '.totalFound' "$RESP"))."
  fi
  jq '.candidates[0]' "$RESP" > "$WORK/cand0.json"
elif [ "$HTTP" = "200" ] && [ "$AG_OK" = "true" ] && [ "$AG_N" -gt 0 ] && [ "$AG_LIVE" -lt "$AG_N" ] && [ "$AG_URLED" -gt 0 ] \
  && [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_STALE_FLY_E2E:-}" = "1" ]; then
  # Pre-a75bc57 Fly builds sourced live candidates but omitted provenance=live on HTTP DTOs.
  warn "Stale Fly build ${READY_BUILD:0:12} omits provenance=live stamp (tip a75bc57+); accepting $AG_URLED profile-URL candidates."
  pass "Agent returned $AG_N candidates with real profile URLs on stale Fly (provenance stamp pending tip deploy)."
  E2E_STALE_FLY=1
  jq '.candidates[0]' "$RESP" > "$WORK/cand0.json"
elif [ "$HTTP" = "429" ] && [ "$AG_CODE" = "SOURCING_AGENT_RATE_LIMITED" ] \
  && [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SKIP_SOURCING_E2E:-}" = "1" ]; then
  warn "sourcing-agent daily live limit reached on Fly — ARIA_ALLOW_SKIP_SOURCING_E2E=1 soft-skip (explicit opt-in)."
  E2E_SKIP_SOURCING=1
  echo 'null' > "$WORK/cand0.json"
  AG_OK="skipped"
elif [ "$HTTP" = "200" ] && [ "$AG_OK" = "true" ] && [ "$AG_N" -eq 0 ] \
  && [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SKIP_SOURCING_E2E:-}" = "1" ]; then
  warn "sourcing-agent returned zero live candidates — ARIA_ALLOW_SKIP_SOURCING_E2E=1 soft-skip (explicit opt-in)."
  E2E_SKIP_SOURCING=1
  echo 'null' > "$WORK/cand0.json"
  AG_OK="skipped"
else
  # Report the server's OWN code and error. The old message asserted a missing
  # provider key regardless of cause, which mis-diagnosed a schema rejection.
  fail "sourcing-agent (HTTP $HTTP, code=${AG_CODE:-none}, ok=$AG_OK, n=$AG_N, live=$AG_LIVE): $(jq -rc '.error // .reason // "no candidates"' "$RESP")"
  echo 'null' > "$WORK/cand0.json"
fi

# Reuse a real candidate for outreach when available.
CAND_ID=$(jq -r 'if type=="object" and .id then .id else empty end' "$WORK/cand0.json")
CAND_LI=$(jq -r '(.linkedinUrl // .githubUrl // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
CAND_EMAIL=$(jq -r '(.email // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
CAND_NAME=$(jq -r '(.name // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
CAND_TITLE=$(jq -r '(.currentTitle // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
CAND_COMPANY=$(jq -r '(.currentCompany // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
CAND_STACK=$(jq -r '[(.techStack // [])[] | select(type=="string" and .!="")] | .[0:6] | join(", ")' "$WORK/cand0.json" 2>/dev/null)
CAND_ACTIVITY=$(jq -r '(.recentActivity // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null | head -c 280)
CAND_GH=$(jq -r '(.githubUrl // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
if [ -z "$CAND_ID" ]; then
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SYNTHETIC_CANDIDATE_E2E:-}" != "1" ] && [ "${E2E_SKIP_SOURCING:-0}" != "1" ]; then
    fail "Fly enterprise E2E requires a live sourced candidate (no synthetic cand-e2e). Set ARIA_ALLOW_SYNTHETIC_CANDIDATE_E2E=1 only for partial runs."
    CAND_ID="cand-e2e-$$"
  else
    CAND_ID="cand-e2e-$$"
    if [ "${E2E_SKIP_SOURCING:-0}" = "1" ]; then
      warn "No live candidate — sourcing skipped (empty results/quality filter or quota); synthetic id for downstream dry-run only."
    else
      warn "No live candidate — using synthetic id for approve/no-send assertions only."
    fi
  fi
fi
[ -n "$CAND_LI" ] || CAND_LI="https://www.linkedin.com/in/e2e-candidate"
[ -n "$CAND_EMAIL" ] || CAND_EMAIL="e2e.candidate@example.com"
[ -n "$CAND_NAME" ] || CAND_NAME="${E2E_CANDIDATE_NAME:-$([ "$E2E_OUTREACH_LANGUAGE" = "fr" ] && echo "Marie Dubois" || echo "Alex Chen")}"

# ---- draft generator: /api/hermes/chat task=outreach; Fly fail-closed (no canned) ----
DRAFT_SUBJECT=""; DRAFT_BODY=""
assert_outreach_language() {
  local channel="$1"
  printf '%s\n%s' "$DRAFT_SUBJECT" "$DRAFT_BODY" > "$WORK/draft_text.txt"
  if npx tsx scripts/assert-outreach-language.mts "$E2E_OUTREACH_LANGUAGE" "$WORK/draft_text.txt" >/dev/null 2>&1; then
    pass "${channel} draft is in candidate main language ($E2E_OUTREACH_LANGUAGE / $E2E_LANG_LABEL)."
    return 0
  fi
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_CANNED_DRAFT_E2E:-}" != "1" ]; then
    fail "${channel} draft not in candidate main language ($E2E_OUTREACH_LANGUAGE)."
    return 1
  fi
  warn "${channel} draft language check failed ($E2E_OUTREACH_LANGUAGE) — continuing with canned fallback only."
  return 0
}
gen_draft() {  # $1 = channel label used only in the prompt
  local channel="$1" prompt gen ok text fmt_hint specifics
  if [ "$channel" = "WhatsApp" ]; then
    fmt_hint="Write ONE short WhatsApp message (no Subject line, under 400 characters)."
  else
    fmt_hint="Format: Subject: ... then body."
  fi
  specifics=""
  [ -n "${CAND_TITLE:-}" ] && specifics="${specifics} Title: ${CAND_TITLE}."
  [ -n "${CAND_COMPANY:-}" ] && specifics="${specifics} Company: ${CAND_COMPANY}."
  [ -n "${CAND_STACK:-}" ] && specifics="${specifics} Skills/stack: ${CAND_STACK}."
  [ -n "${CAND_GH:-}" ] && specifics="${specifics} GitHub: ${CAND_GH}."
  [ -n "${CAND_ACTIVITY:-}" ] && specifics="${specifics} Activity signal: ${CAND_ACTIVITY}."
  [ -n "${APPROVE_CRITIC_FEEDBACK:-}" ] && specifics="${specifics} Prior quality-critic block to fix (do not repeat): ${APPROVE_CRITIC_FEEDBACK}."
  [ -n "$specifics" ] || specifics=" Use any concrete public signal you can infer from their name; never invent employers."
  prompt="Draft a first-touch ${channel} recruiting message in language ISO code ${E2E_OUTREACH_LANGUAGE}. The candidate's main language is ${E2E_LANG_LABEL}. Write the entire message in ${E2E_LANG_LABEL} only (proper nouns like Mantu Group excepted). Do not ask clarifying questions — output the final message only. ${fmt_hint} Reach out to ${CAND_NAME} about a senior engineering role with Mantu Group. Mention Mantu Group by name. Lead with ONE specific detail from this candidate profile (not a generic compliment):${specifics} Soft ask for a short chat. Avoid salary/compensation. Avoid generic openers like 'I hope this finds you well'."
  # Hermes uses server default model — never send model:"" (Zod rejects empty string).
  if [ -n "${OUTREACH_MODEL:-}" ]; then
    jq -n --arg p "$prompt" --arg prov "$AGENT_PROVIDER" --arg model "$OUTREACH_MODEL" \
      '{task:"outreach", prompt:$p, provider:$prov, model:$model}' > "$WORK/draft_req.json"
  else
    jq -n --arg p "$prompt" --arg prov "$AGENT_PROVIDER" \
      '{task:"outreach", prompt:$p, provider:$prov}' > "$WORK/draft_req.json"
  fi
  api POST "$APP_URL/api/hermes/chat" "$WORK/draft_req.json"
  ok=$(jq -r '.ok // false' "$RESP"); text=$(jq -r '.text // empty' "$RESP")
  if [ "$ok" = "true" ] && [ -n "$text" ]; then
    DRAFT_SUBJECT=$(printf '%s\n' "$text" | sed -n 's/^[Ss]ubject:[[:space:]]*//p' | head -1)
    DRAFT_BODY=$(printf '%s\n' "$text" | awk 'BEGIN{b=0} /^[Ss]ubject:/{next} /^[[:space:]]*$/{if(!b)next} {b=1; print}')
    [ -n "$DRAFT_SUBJECT" ] || DRAFT_SUBJECT="Quick note about your work"
    [ -n "$DRAFT_BODY" ] || DRAFT_BODY="$text"
    return 0
  fi
  return 1
}

require_live_draft_or_canned() {
  # $1 = channel label for messages
  local channel="$1" attempt=0
  while [ "$attempt" -lt 3 ]; do
    if gen_draft "$channel"; then
      if assert_outreach_language "$channel"; then
        pass "Generated a ${channel} draft via /api/hermes/chat (subject: \"$(printf '%.60s' "$DRAFT_SUBJECT")\")."
        return 0
      fi
      attempt=$((attempt + 1))
      [ "$attempt" -lt 3 ] && warn "Regenerating ${channel} draft — language mismatch (attempt $attempt/3)."
      continue
    fi
    break
  done
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_CANNED_DRAFT_E2E:-}" != "1" ]; then
    fail "Fly enterprise E2E requires live Hermes ${channel} draft in ${E2E_OUTREACH_LANGUAGE} (canned fallback disabled). Set ARIA_ALLOW_CANNED_DRAFT_E2E=1 only for partial runs."
    return 1
  fi
  if [ "$E2E_OUTREACH_LANGUAGE" = "fr" ]; then
    DRAFT_SUBJECT="Votre travail open-source TypeScript"
    DRAFT_BODY="Bonjour, j'ai découvert votre travail récent sur TypeScript et React et j'ai été sincèrement impressionné par la clarté de votre code. Mantu Group recrute un ingénieur senior pour une équipe plateforme et j'ai pensé à vous. Aucune pression — si vous êtes même un peu curieuse, j'aimerais en dire plus. Dans tous les cas, continuez votre excellent travail.

Bien cordialement,
Recrutement · Mantu Group"
  else
    DRAFT_SUBJECT="Your open-source TypeScript work"
    DRAFT_BODY="Hi, I came across your recent TypeScript and React work and was genuinely impressed by how you structure things. Mantu Group is hiring a senior engineer for a platform team in London and I thought of you. No pressure at all, but if you are even a little curious I would love to share more. Either way, keep up the great work.

Best,
Recruiting · Mantu Group"
  fi
  warn "${channel} draft generation degraded (no tool-calling/provider key): $(jq -rc '.reason // empty' "$RESP") — using a canned ${E2E_OUTREACH_LANGUAGE} draft so the approval + no-send assertions still run."
  assert_outreach_language "$channel" || true
  return 0
}

# ===========================================================================
if [ "${ARIA_ALLOW_SKIP_APPROVE_E2E:-}" = "1" ]; then
  E2E_SKIP_APPROVE=1
  warn "ARIA_ALLOW_SKIP_APPROVE_E2E=1 — skipping approve/send outreach steps (owner no Approve/send policy)."
else
step "4) LinkedIn outreach — draft → approve (assisted-manual) → NO send fired"
# ===========================================================================
if require_live_draft_or_canned "LinkedIn"; then
  :
fi

# Quality gate: drafts must not disclose salary/budget (multi-agent compliance floor).
if printf '%s\n%s' "$DRAFT_SUBJECT" "$DRAFT_BODY" | grep -Eiq '\b(salary|compensation|budget|£[0-9]|€[0-9]|\$[0-9]|120k|90000)\b'; then
  fail "LinkedIn draft failed outreach quality gate (salary/compensation disclosure detected)."
else
  pass "LinkedIn draft passes salary-disclosure quality gate."
fi

MSG_LI="msg-e2e-li-$$"
APPROVE_TRY=0
APPROVE_CRITIC_FEEDBACK=""
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  APPROVE_MAX="${E2E_APPROVE_MAX:-5}"
else
  APPROVE_MAX="${E2E_APPROVE_MAX:-3}"
fi
while [ "$APPROVE_TRY" -lt "$APPROVE_MAX" ]; do
  if [ "$APPROVE_TRY" -gt 0 ]; then
    APPROVE_CRITIC_FEEDBACK="$(jq -r '.error // .detail // empty' "$APPROVE_RESP" 2>/dev/null | tr '\n' ' ' | head -c 280)"
    warn "Approve retry $APPROVE_TRY/$APPROVE_MAX — regenerating LinkedIn draft after HTTP $HTTP${APPROVE_CRITIC_FEEDBACK:+ (critic: $APPROVE_CRITIC_FEEDBACK)}."
    require_live_draft_or_canned "LinkedIn" || break
    if printf '%s\n%s' "$DRAFT_SUBJECT" "$DRAFT_BODY" | grep -Eiq '\b(salary|compensation|budget|£[0-9]|€[0-9]|\$[0-9]|120k|90000)\b'; then
      fail "LinkedIn draft failed outreach quality gate on approve retry (salary/compensation disclosure)."
      break
    fi
  fi
  jq -n --arg m "$MSG_LI" --arg c "$CAND_ID" --arg r "$CAND_LI" --arg s "$DRAFT_SUBJECT" --arg b "$DRAFT_BODY" \
    '{messageId:$m, candidateId:$c, channel:"LinkedIn", recipient:$r, subject:$s, body:$b}' > "$WORK/approve_req.json"
  APPROVE_RESP="$WORK/approve_resp.json"
  RESP="$APPROVE_RESP"
  api POST "$APP_URL/api/outreach/approve" "$WORK/approve_req.json" "" "${APPROVE_API_TIMEOUT:-180}"
  RESP="$WORK/resp.json"
  if [ "$HTTP" = "200" ] && [ "$(jq -r '.ok // false' "$APPROVE_RESP")" = "true" ]; then
    APPROVE_CRITIC_FEEDBACK=""
    break
  fi
  # LLM drafts are non-deterministic — retry on critic infra (503), quality block (422), or curl timeout (000).
  if [ "$HTTP" = "503" ] && [ "$(jq -r '.status // empty' "$APPROVE_RESP")" = "critics_required" ]; then
    APPROVE_TRY=$((APPROVE_TRY + 1))
    sleep $((10 * APPROVE_TRY))
    continue
  fi
  if [ "$HTTP" = "422" ] || [ "$HTTP" = "000" ]; then
    APPROVE_TRY=$((APPROVE_TRY + 1))
    sleep $((5 * APPROVE_TRY))
    continue
  fi
  break
done
AP_OK=$(jq -r '.ok // false' "$APPROVE_RESP")
AP_PERSISTED=$(jq -r 'if has("persisted") then .persisted else true end' "$APPROVE_RESP")
AP_CRITICS=$(jq -r '.qualityCriticsUsed // false' "$APPROVE_RESP")
AP_CRITIC_N=$(jq -r '.criticStageCount // 0' "$APPROVE_RESP")
if [ "$HTTP" = "200" ] && [ "$AP_OK" = "true" ] && [ "$AP_PERSISTED" = "true" ]; then
  pass "Human approval RECORDED server-side (this is the state the client renders as 'Pending Manual Send')."
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
    if [ "$AP_CRITICS" = "true" ] && [ "$AP_CRITIC_N" -ge 3 ]; then
      pass "Multi-agent quality validation: live LLM critics used (stages=$AP_CRITIC_N)."
    else
      fail "Fly approve missing live multi-agent critics proof (qualityCriticsUsed=$AP_CRITICS criticStageCount=$AP_CRITIC_N)."
    fi
  fi
elif [ "$HTTP" = "200" ] && [ "$AP_OK" = "true" ]; then
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
    fail "Approve returned persisted:false on Fly — public-demo mode must be off for enterprise E2E."
  else
    warn "Approve returned dry-run/persisted:false → this instance runs in public-demo mode (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true); approval is not durable."
  fi
elif [ "$HTTP" = "403" ]; then
  fail "Approve 403 — session lacks the 'outreach' permission."
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ] \
  && { [ "$HTTP" = "503" ] || [ "$HTTP" = "000" ]; } \
  && [ "$(jq -r '.status // empty' "$APPROVE_RESP" 2>/dev/null)" = "critics_required" ]; then
  E2E_LLM_GAP=1
  warn "Approve critics_required on Fly after retries — PARTIAL continuation (live LLM critics unavailable)."
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ] \
  && [ "$HTTP" = "000" ]; then
  E2E_LLM_GAP=1
  warn "Approve timed out on Fly after retries — PARTIAL continuation (live LLM critics/transport unavailable)."
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ] \
  && [ "$HTTP" = "422" ]; then
  E2E_LLM_GAP=1
  warn "Approve quality block (422) on Fly after retries — PARTIAL continuation (non-deterministic LLM critics)."
else
  fail "Approve failed (HTTP $HTTP): $(head -c 300 "$APPROVE_RESP")"
fi

# The assisted-manual guarantee: the send route HARD-REJECTS LinkedIn with 409
# manual-required BEFORE any provider/approval/claim/email fallback → no ledger
# 'sent' row is ever written and nothing is delivered.
jq -n --arg m "$MSG_LI" --arg c "$CAND_ID" --arg s "$DRAFT_SUBJECT" --arg b "$DRAFT_BODY" \
  '{messageId:$m, candidateId:$c, campaignId:"camp-e2e", channel:"LinkedIn", subject:$s, body:$b, confirmLive:true}' > "$WORK/send_li.json"
api POST "$APP_URL/api/outreach/send" "$WORK/send_li.json"
SEND_STATUS=$(jq -r '.status // empty' "$RESP")
if [ "$HTTP" = "409" ] && [ "$SEND_STATUS" = "manual-required" ]; then
  pass "POST /api/outreach/send (LinkedIn) → 409 manual-required: assisted-manual only, NO send fired, no 'sent' ledger row."
else
  fail "Expected 409 manual-required for LinkedIn; got HTTP $HTTP status='$SEND_STATUS': $(head -c 200 "$RESP")"
fi

# ===========================================================================
step "5) Email outreach — draft → send returns dry-run (nothing delivered)"
# ===========================================================================
if require_live_draft_or_canned "email"; then
  :
fi

if printf '%s\n%s' "$DRAFT_SUBJECT" "$DRAFT_BODY" | grep -Eiq '\b(salary|compensation|budget|£[0-9]|€[0-9]|\$[0-9]|120k|90000)\b'; then
  fail "Email draft failed outreach quality gate (salary/compensation disclosure detected)."
else
  pass "Email draft passes salary-disclosure quality gate."
fi

MSG_EM="msg-e2e-em-$$"
jq -n --arg m "$MSG_EM" --arg c "$CAND_ID" --arg to "$CAND_EMAIL" --arg s "$DRAFT_SUBJECT" --arg b "$DRAFT_BODY" \
  '{messageId:$m, candidateId:$c, campaignId:"camp-e2e", channel:"Email", candidateEmail:$to, subject:$s, body:$b, confirmLive:false}' > "$WORK/send_em.json"
api POST "$APP_URL/api/outreach/send" "$WORK/send_em.json"
EM_STATUS=$(jq -r '.status // empty' "$RESP")
if [ "$HTTP" = "200" ] && [ "$EM_STATUS" = "dry-run" ]; then
  pass "POST /api/outreach/send (Email) → dry-run: $(jq -rc '.detail' "$RESP") — nothing delivered."
else
  fail "Expected 200 dry-run for Email; got HTTP $HTTP status='$EM_STATUS': $(head -c 200 "$RESP")"
fi

# ===========================================================================
step "5b) WhatsApp outreach — draft in candidate language → send dry-run"
# ===========================================================================
if require_live_draft_or_canned "WhatsApp"; then
  :
fi

if printf '%s\n%s' "$DRAFT_SUBJECT" "$DRAFT_BODY" | grep -Eiq '\b(salary|compensation|budget|£[0-9]|€[0-9]|\$[0-9]|120k|90000)\b'; then
  fail "WhatsApp draft failed outreach quality gate (salary/compensation disclosure detected)."
else
  pass "WhatsApp draft passes salary-disclosure quality gate."
fi

MSG_WA="msg-e2e-wa-$$"
CAND_PHONE="${CAND_PHONE:-+33601020304}"
jq -n --arg m "$MSG_WA" --arg c "$CAND_ID" --arg p "$CAND_PHONE" --arg s "$DRAFT_SUBJECT" --arg b "$DRAFT_BODY" \
  '{messageId:$m, candidateId:$c, campaignId:"camp-e2e", channel:"WhatsApp", phone:$p, subject:$s, body:$b, confirmLive:false}' > "$WORK/send_wa.json"
api POST "$APP_URL/api/outreach/send" "$WORK/send_wa.json"
WA_STATUS=$(jq -r '.status // empty' "$RESP")
if [ "$HTTP" = "200" ] && [ "$WA_STATUS" = "dry-run" ]; then
  pass "POST /api/outreach/send (WhatsApp) → dry-run: $(jq -rc '.detail' "$RESP") — nothing delivered."
else
  fail "Expected 200 dry-run for WhatsApp; got HTTP $HTTP status='$WA_STATUS': $(head -c 200 "$RESP")"
fi

# Query both durable outbound stores with the same authenticated identity. The
# manual LinkedIn refusal and confirmLive=false email dry run must create no
# ledger claim and no outbox row for either approval message id.
NO_SEND_LEDGER="$WORK/no-send-ledger.json"
NO_SEND_OUTBOX="$WORK/no-send-outbox.json"
NO_SEND_FILTER="in.($MSG_LI,$MSG_EM,$MSG_WA)"
NO_SEND_LEDGER_CODE=$(curl -sS -m 20 -o "$NO_SEND_LEDGER" -w '%{http_code}' --get \
  "$KONG_URL/rest/v1/outreach_ledger" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode 'select=id,status,approval_message_id' \
  --data-urlencode "approval_message_id=$NO_SEND_FILTER")
NO_SEND_OUTBOX_CODE=$(curl -sS -m 20 -o "$NO_SEND_OUTBOX" -w '%{http_code}' --get \
  "$KONG_URL/rest/v1/messages_outbound" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode 'select=id,status,approval_message_id' \
  --data-urlencode "approval_message_id=$NO_SEND_FILTER")
NO_SEND_LEDGER_COUNT=$(jq -r 'if type == "array" then length else -1 end' "$NO_SEND_LEDGER" 2>/dev/null)
NO_SEND_OUTBOX_COUNT=$(jq -r 'if type == "array" then length else -1 end' "$NO_SEND_OUTBOX" 2>/dev/null)
if [ "$NO_SEND_LEDGER_CODE" = "200" ] && [ "$NO_SEND_OUTBOX_CODE" = "200" ] \
   && [ "$NO_SEND_LEDGER_COUNT" -eq 0 ] && [ "$NO_SEND_OUTBOX_COUNT" -eq 0 ]; then
  pass "No-send proof: outreach_ledger=0 and messages_outbound=0 for both canary message ids."
else
  fail "No-send database proof failed (ledger HTTP $NO_SEND_LEDGER_CODE count=$NO_SEND_LEDGER_COUNT; outbox HTTP $NO_SEND_OUTBOX_CODE count=$NO_SEND_OUTBOX_COUNT)."
fi
fi

# ===========================================================================
step "6) First interview — calendar/Teams dry-run (Outlook Graph when live)"
# ===========================================================================
# confirmLive:false must never create a Graph event. Live Teams join links require
# a connected Microsoft Graph seat + confirmLive:true (same route).
# Jitter slot per run so re-runs do not collide on calendar_booking_ledger double_booked.
CAL_JITTER_MIN=$(( ( $$ + ${RANDOM:-0} ) % 50 ))
CAL_JITTER_HOUR=$(( 10 + ( $$ % 7 ) ))
CAL_END_MIN=$(( CAL_JITTER_MIN + 45 ))
CAL_END_HOUR=$CAL_JITTER_HOUR
if [ "$CAL_END_MIN" -ge 60 ]; then
  CAL_END_MIN=$(( CAL_END_MIN - 60 ))
  CAL_END_HOUR=$(( CAL_END_HOUR + 1 ))
fi
START_ISO=$(date -u -d "+2 days ${CAL_JITTER_HOUR}:$(printf '%02d' "$CAL_JITTER_MIN")" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v+2d -v${CAL_JITTER_HOUR}H -v${CAL_JITTER_MIN}M +%Y-%m-%dT%H:%M:%SZ)
END_ISO=$(date -u -d "+2 days ${CAL_END_HOUR}:$(printf '%02d' "$CAL_END_MIN")" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v+2d -v${CAL_END_HOUR}H -v${CAL_END_MIN}M +%Y-%m-%dT%H:%M:%SZ)
SEAT_UUID="81111111-1111-4111-8111-111111111111"
jq -n \
  --arg seat "$SEAT_UUID" \
  --arg cand "$CAND_ID" \
  --arg name "E2E Candidate" \
  --arg email "$CAND_EMAIL" \
  --arg role "Senior TypeScript Engineer" \
  --arg start "$START_ISO" \
  --arg end "$END_ISO" \
  --arg req "cal-e2e-$$" \
  '{
    seatId:$seat,
    candidateId:$cand,
    candidateName:$name,
    candidateEmail:$email,
    role:$role,
    startTime:$start,
    endTime:$end,
    timezone:"UTC",
    agenda:[
      "Introduce Mantu Group and our consulting model",
      "Walk through the Senior TypeScript Engineer role — scope, team, and expectations",
      "Understand the candidate'\''s background, motivations, and timing",
      "Answer questions and agree next steps if there is mutual interest"
    ],
    requestId:$req,
    confirmLive:false
  }' > "$WORK/calendar_req.json"
api POST "$APP_URL/api/calendar/event" "$WORK/calendar_req.json"
CAL_STATUS=$(jq -r '.status // empty' "$RESP")
if [ "$HTTP" = "200" ] && [ "$CAL_STATUS" = "dry-run" ]; then
  pass "POST /api/calendar/event (confirmLive:false) → dry-run: no Outlook/Teams event created."
  CAL_TEAMS=$(jq -r '.teamsJoinUrl // .joinUrl // .eventId // empty' "$RESP" 2>/dev/null || true)
  if [ -z "$CAL_TEAMS" ]; then
    pass "Calendar dry-run omits live Teams join URL / event id (Needs calendar honesty without live seat)."
  else
    fail "Calendar dry-run must not return live Teams/event proof (got '$CAL_TEAMS')."
  fi
elif [ "$HTTP" = "403" ]; then
  fail "Calendar book 403 — session lacks the 'book' permission."
else
  fail "Expected 200 dry-run for calendar; got HTTP $HTTP status='$CAL_STATUS': $(head -c 200 "$RESP")"
fi
# Prove the route source creates Teams meetings when Graph succeeds live.
if grep -q 'isOnlineMeeting: true' src/lib/calendar.ts && grep -q 'teamsForBusiness' src/lib/calendar.ts; then
  pass "Calendar Graph adapter requests Teams online meetings (isOnlineMeeting + teamsForBusiness)."
else
  fail "src/lib/calendar.ts missing Teams online-meeting flags."
fi
if grep -q 'mantuEmailHtmlWrapper' src/lib/email-send.ts \
  && grep -q 'htmlBody' src/lib/email-send.ts \
  && grep -q 'mantuFirstInterviewAgenda' src/lib/store/booking-report-actions.ts; then
  pass "Live send path brands Mantu HTML; Confirm-slot preserves Mantu interview agenda."
else
  fail "Mantu MIME branding or Confirm-slot agenda wiring missing."
fi

# ===========================================================================
step "6b) Live Outlook/Teams book (confirmLive:true) when a Graph seat is connected"
# ===========================================================================
# Dry-run alone cannot prove Teams joinUrl. On Fly, require a live Microsoft Graph
# seat and assert status=created + Teams join URL (unless explicitly skipped).
api GET "$APP_URL/api/email/connections" || true
# Prefer a seat that is mode=live AND has an active Graph mail subscription
# (confirmLive books require seat.mode === "live" on /api/calendar/event).
LIVE_SEAT_ID=$(jq -r '
  (.connections // []) as $conns
  | (.seats // []) as $seats
  | [
      $conns[]
      | select(
          (.provider // "") == "Microsoft Graph"
          and (.hasRefreshToken == true)
          and ((.graphSubscription.active // false) == true)
          and ((.seatId // "") | length) > 0
        )
      | .seatId as $sid
      | select(
          ($seats
            | map(select(
                (.id // "") == $sid
                and (.mode // "") == "live"
                and ((.status // "active") == "active")
              ))
            | length) > 0
        )
      | $sid
    ]
  | .[0] // empty
' "$RESP" 2>/dev/null || true)
# Fall back to any live Graph seat only for partial M365 runs (subscription not required).
if [ -z "$LIVE_SEAT_ID" ] && [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" = "1" ]; then
  LIVE_SEAT_ID=$(jq -r '
    (.seats // [])
    | map(select(
        (.provider // "") == "Microsoft Graph"
        and (.mode // "") == "live"
        and ((.status // "active") == "active")
        and ((.connectedAccount // "") | length) > 3
      ))
    | .[0].id // empty
  ' "$RESP" 2>/dev/null || true)
fi
if [ -z "$LIVE_SEAT_ID" ] && [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" = "1" ]; then
  LIVE_SEAT_ID=$(jq -r '
    (.connections // [])
    | map(select(
        (.provider // "") == "Microsoft Graph"
        and (.hasRefreshToken == true)
        and ((.seatId // "") | length) > 0
      ))
    | .[0].seatId // empty
  ' "$RESP" 2>/dev/null || true)
fi
# On full Fly E2E, if Outlook webhook is active but seat is still mock, fail closed.
# Owner-ordered Microsoft skip uses ARIA_ALLOW_PARTIAL_M365_E2E=1 (honest PARTIAL, not PASS).
# Do NOT use ARIA_ALLOW_SKIP_LIVE_CALENDAR=1 to pretend full enterprise success.
if [ -z "$LIVE_SEAT_ID" ] && [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" != "1" ] && [ "${ARIA_ALLOW_SKIP_LIVE_CALENDAR:-}" != "1" ]; then
  MOCK_WITH_SUB=$(jq -r '
    (.connections // []) as $conns
    | (.seats // []) as $seats
    | [
        $conns[]
        | select(
            (.provider // "") == "Microsoft Graph"
            and (.hasRefreshToken == true)
            and ((.graphSubscription.active // false) == true)
            and ((.seatId // "") | length) > 0
          )
        | .seatId as $sid
        | select(($seats | map(select(.id == $sid and (.mode // "") != "live")) | length) > 0)
        | $sid
      ]
    | length
  ' "$RESP" 2>/dev/null || echo 0)
  if [ "${MOCK_WITH_SUB:-0}" -gt 0 ]; then
    fail "Outlook Graph webhook is active but seat.mode is not live — reconnect Outlook (callback must set mode=live) before confirmLive Teams book."
  fi
fi

MS_LIVE_GAP=0
if [ -n "$LIVE_SEAT_ID" ]; then
  info "Live Microsoft Graph seat for confirmLive book: $LIVE_SEAT_ID"
  LIVE_SCOPE=$(jq -r --arg sid "$LIVE_SEAT_ID" '
    (.connections // [])
    | map(select((.seatId // "") == $sid))
    | .[0].scope // ""
  ' "$RESP" 2>/dev/null || true)
  if ! printf '%s' "$LIVE_SCOPE" | grep -Eiq 'OnlineMeetings\.ReadWrite|onlinemeetings\.readwrite'; then
    fail "Live Graph seat $LIVE_SEAT_ID missing OnlineMeetings.ReadWrite in token scope — reconnect Outlook after tip with OnlineMeetings authorize scope."
  else
    pass "Live Graph seat token includes OnlineMeetings.ReadWrite for Teams joinUrl."
  fi
  jq -n \
    --arg seat "$LIVE_SEAT_ID" \
    --arg cand "$CAND_ID" \
    --arg name "E2E Candidate" \
    --arg email "$CAND_EMAIL" \
    --arg role "Senior TypeScript Engineer" \
    --arg start "$START_ISO" \
    --arg end "$END_ISO" \
    --arg req "cal-e2e-live-$$" \
    '{
      seatId:$seat,
      candidateId:$cand,
      candidateName:$name,
      candidateEmail:$email,
      role:$role,
      startTime:$start,
      endTime:$end,
      timezone:"UTC",
      agenda:[
        "Introduce Mantu Group and our consulting model",
        "Walk through the Senior TypeScript Engineer role — scope, team, and expectations",
        "Understand the candidate'\''s background, motivations, and timing",
        "Answer questions and agree next steps if there is mutual interest"
      ],
      requestId:$req,
      confirmLive:true
    }' > "$WORK/calendar_live_req.json"
  api POST "$APP_URL/api/calendar/event" "$WORK/calendar_live_req.json"
  LIVE_CAL_STATUS=$(jq -r '.status // empty' "$RESP")
  LIVE_CAL_LINK=$(jq -r '.link // empty' "$RESP")
  LIVE_TEAMS=0
  if [ -n "$LIVE_CAL_LINK" ]; then
    case "$(printf '%s' "$LIVE_CAL_LINK" | tr 'A-Z' 'a-z')" in
      *://teams.microsoft.com/*|*://*.teams.microsoft.com/*|*://teams.live.com/*|*://*.teams.live.com/*) LIVE_TEAMS=1 ;;
    esac
  fi
  if [ "$HTTP" = "200" ] && [ "$LIVE_CAL_STATUS" = "created" ] && [ "$LIVE_TEAMS" = "1" ]; then
    pass "Live Outlook/Teams book (confirmLive:true) → created with Teams joinUrl."
  else
    fail "Live calendar/Teams book failed (HTTP $HTTP status='$LIVE_CAL_STATUS' teams=$LIVE_TEAMS): $(head -c 240 "$RESP")"
  fi
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" = "1" ]; then
  MS_LIVE_GAP=1
  E2E_SKIP_M365=1
  warn "PARTIAL M365: no live Graph seat — skipping confirmLive Teams book (owner-ordered Microsoft skip; not a full PASS)."
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_SKIP_LIVE_CALENDAR:-}" = "1" ]; then
  MS_LIVE_GAP=1
  E2E_SKIP_M365=1
  # Honesty: this flag never upgrades to RESULT: PASS — only PARTIAL with an explicit MS gap.
  warn "ARIA_ALLOW_SKIP_LIVE_CALENDAR=1 set — live Teams book skipped; run will be PARTIAL (never pretends full enterprise PASS)."
elif [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
  fail "No live Microsoft Graph seat for Teams book — connect Outlook in Settings, or set ARIA_ALLOW_PARTIAL_M365_E2E=1 for an honest non-MS PARTIAL (do not use ARIA_ALLOW_SKIP_LIVE_CALENDAR=1 to pretend PASS)."
else
  warn "No live Microsoft Graph seat — skipping confirmLive Teams book proof."
fi

# ===========================================================================
step "Summary"
# ===========================================================================
printf "  ${C_G}%d passed${C_0}, ${C_R}%d failed${C_0}, ${C_Y}%d warnings${C_0}\n" "$PASSES" "$FAILS" "$WARNS"
if [ "$FAILS" -gt 0 ]; then
  printf "  ${C_R}RESULT: FAIL${C_0}\n"; exit 1
elif [ "${MS_LIVE_GAP:-0}" = "1" ] \
  || [ "${E2E_LLM_GAP:-0}" = "1" ] \
  || [ "${ARIA_ALLOW_PARTIAL_M365_E2E:-}" = "1" ] \
  || [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ] \
  || [ "${ARIA_ALLOW_STALE_FLY_E2E:-}" = "1" ] \
  || [ "${E2E_STALE_FLY:-0}" = "1" ] \
  || [ "${E2E_SKIP_APPROVE:-0}" = "1" ] \
  || [ "${E2E_SKIP_CRON:-0}" = "1" ] \
  || [ "${E2E_SKIP_SOURCING:-0}" = "1" ] \
  || [ "${E2E_SKIP_WEBHOOK:-0}" = "1" ]; then
  printf "  ${C_Y}RESULT: PARTIAL${C_0} — core recruiting loop green (${PASSES} pass, 0 fail); outstanding gaps below are explicit skips only.\n"
  if [ "${E2E_SKIP_M365:-0}" = "1" ]; then
    printf "  Skipped (Microsoft / calendar): confirmLive Teams book — no live Graph seat or owner ARIA_ALLOW_PARTIAL_M365_E2E=1.\n"
    printf "  MS still needed: Outlook connect, Graph webhook push ingest, live confirmLive book.\n"
  fi
  if [ "${E2E_LLM_GAP:-0}" = "1" ] || [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ]; then
    printf "  Skipped (LLM): multi-agent critics / approve path — rotate live LLM key (ARIA_ALLOW_PARTIAL_LLM_E2E=1).\n"
  fi
  if [ "${E2E_SKIP_APPROVE:-0}" = "1" ]; then
    printf "  Skipped (owner policy): approve/send outreach (ARIA_ALLOW_SKIP_APPROVE_E2E=1).\n"
  fi
  if [ "${E2E_SKIP_CRON:-0}" = "1" ]; then
    printf "  Skipped (env): authenticated draft/graph-stage cron probes (CRON_SECRET unset).\n"
  fi
  if [ "${E2E_STALE_FLY:-0}" = "1" ]; then
    printf "  Stale Fly deploy: provenance=live stamp pending tip golive; profile-URL candidates accepted.\n"
  fi
  if [ "${E2E_SKIP_SOURCING:-0}" = "1" ]; then
    printf "  Skipped (quota): live sourcing-agent proof — daily limit on shared Fly tenant.\n"
  fi
  if [ "${E2E_SKIP_WEBHOOK:-0}" = "1" ]; then
    printf "  Skipped (owner policy): webhook hiring-need intake (ARIA_ALLOW_SKIP_WEBHOOK_E2E=1).\n"
  fi
  if [ "${E2E_SKIP_M365:-0}" != "1" ] && [ "${E2E_SKIP_APPROVE:-0}" != "1" ] && [ "${E2E_SKIP_CRON:-0}" != "1" ] && [ "${E2E_LLM_GAP:-0}" != "1" ]; then
    printf "  MS gaps: microsoftOAuth live seat, Outlook connect, Graph webhook push ingest, confirmLive Teams book.\n"
  fi
  exit 0
else
  printf "  ${C_G}RESULT: PASS${C_0}\n"; exit 0
fi
