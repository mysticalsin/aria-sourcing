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
AGENT_PROVIDER="${AGENT_PROVIDER:-anthropic}"      # tool-calling provider for /api/sourcing-agent (kimi/hermes are rejected)
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
    *)         echo "" ;;
  esac
}
OUTREACH_MODEL="${AGENT_MODEL:-$(default_model "$AGENT_PROVIDER")}"

# ---- output helpers --------------------------------------------------------
if [ -t 1 ]; then C_G="\033[32m"; C_R="\033[31m"; C_Y="\033[33m"; C_C="\033[36m"; C_B="\033[1m"; C_0="\033[0m"
else C_G=""; C_R=""; C_Y=""; C_C=""; C_B=""; C_0=""; fi
PASSES=0; FAILS=0; WARNS=0
step() { printf "\n${C_B}== %s ==${C_0}\n" "$1"; }
pass() { printf "  ${C_G}PASS${C_0}  %s\n" "$1"; PASSES=$((PASSES+1)); }
fail() { printf "  ${C_R}FAIL${C_0}  %s\n" "$1"; FAILS=$((FAILS+1)); }
warn() { printf "  ${C_Y}WARN${C_0}  %s\n" "$1"; WARNS=$((WARNS+1)); }
info() { printf "  ${C_C}·${C_0}     %s\n" "$1"; }
die()  { printf "\n${C_R}ABORT${C_0} %s\n" "$1" >&2; exit 2; }

# ---- preflight -------------------------------------------------------------
for bin in curl jq openssl; do command -v "$bin" >/dev/null 2>&1 || die "'$bin' is required but not installed."; done
[ -n "$ADMIN_EMAIL" ]    || die "ADMIN_EMAIL is required."
[ -n "$ADMIN_PASSWORD" ] || die "ADMIN_PASSWORD is required."
[ -n "$ANON_KEY" ]       || die "ANON_KEY is required (Supabase anon key)."
case "$ADMIN_EMAIL:$ADMIN_PASSWORD" in
  *$'\n'*|*$'\r'*) die "Admin credentials must not contain line breaks." ;;
esac

# Fly production enterprise E2E requires the signed webhook secret (hiring-need
# ignition). Skip only when ARIA_ALLOW_SKIP_WEBHOOK_E2E=1 (local harnesses).
if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ -z "${EMAIL_INBOUND_WEBHOOK_SECRET:-}" ]; then
  if [ "${ARIA_ALLOW_SKIP_WEBHOOK_E2E:-}" != "1" ]; then
    die "EMAIL_INBOUND_WEBHOOK_SECRET is required for Fly enterprise E2E (webhook → requisition_parse). Set it or ARIA_ALLOW_SKIP_WEBHOOK_E2E=1 for a partial run."
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
  case "$READY_MIG" in
    0066_*) ;;
    *)
      die "Fly /api/ready migration must be 0066_* for enterprise E2E (got '${READY_MIG:-none}'). Deploy tip via scripts/fly-enterprise-activate.sh or set ARIA_ALLOW_STALE_FLY_E2E=1."
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
  local method="$1" url="$2" data="${3:-}" tmo="${API_TIMEOUT:-60}"
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
step "2b) Webhook need email — POST /api/webhooks/email-inbound"
# ===========================================================================
WEBHOOK_SECRET="${EMAIL_INBOUND_WEBHOOK_SECRET:-}"
if [ -n "$WEBHOOK_SECRET" ]; then
  NEED_BODY='{"mailbox":"talent@mantu.com","providerId":"e2e-need-'"$$"'","from":"noreply@mantu.example","subject":"This need is now ACTIVE: Senior TypeScript Engineer","body":"Role: Senior TypeScript Engineer\nLocation: London, UK\nKey required skills\n- TypeScript\n- React\n- Node.js\nExperience: 5+ years"}'
  NEED_SIG=$(printf '%s' "$NEED_BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $NF}')
  WEBHOOK_CODE=$(curl -sS -m 30 -o "$WORK/webhook_need.json" -w '%{http_code}' \
    -X POST "$APP_URL/api/webhooks/email-inbound" \
    -H 'Content-Type: application/json' \
    -H "x-aria-signature: $NEED_SIG" \
    --data-binary "$NEED_BODY")
  WEBHOOK_ROUTE=$(jq -r '.route // empty' "$WORK/webhook_need.json")
  WEBHOOK_QUEUED=$(jq -r '.jobQueued // false' "$WORK/webhook_need.json")
  WEBHOOK_KIND=$(jq -r '.jobKind // empty' "$WORK/webhook_need.json")
  if [ "$WEBHOOK_CODE" = "200" ] && [ "$WEBHOOK_ROUTE" = "hiring_need" ] && [ "$WEBHOOK_KIND" = "requisition_parse" ] && [ "$WEBHOOK_QUEUED" = "true" ]; then
    pass "Webhook need email queued requisition_parse (route=$WEBHOOK_ROUTE, jobKind=$WEBHOOK_KIND)."
  else
    fail "Webhook need email (HTTP $WEBHOOK_CODE route=$WEBHOOK_ROUTE kind=$WEBHOOK_KIND queued=$WEBHOOK_QUEUED): $(head -c 300 "$WORK/webhook_need.json")"
  fi
else
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ]; then
    fail "EMAIL_INBOUND_WEBHOOK_SECRET unset on Fly E2E — hiring-need webhook step required."
  else
    warn "EMAIL_INBOUND_WEBHOOK_SECRET unset — skipping webhook need-email step."
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

# ===========================================================================
step "2d) M365 connections + Entra reporting surface"
# ===========================================================================
api GET "$APP_URL/api/email/connections"
CONN_OK=$(jq -r '.ok // false' "$RESP")
if [ "$HTTP" = "200" ] && [ "$CONN_OK" = "true" ]; then
  pass "GET /api/email/connections ok (providers=$(jq -c '.providers // {}' "$RESP"))."
else
  fail "GET /api/email/connections failed (HTTP $HTTP): $(head -c 200 "$RESP")"
fi
if grep -q 'graphSubscription' src/app/api/email/connections/route.ts \
  && grep -q 'ensure_graph_webhook' src/app/api/email/connections/route.ts \
  && grep -q 'Enable webhook' src/components/settings/email-connections-panel.tsx; then
  pass "Graph webhook ensure/repair wired in connections API + settings UI."
else
  fail "Graph webhook ensure/repair surface missing."
fi
if grep -q 'propose-calendar-book' scripts/sourcing-loop-worker.mjs \
  && grep -q 'claimCalendarBooking' src/app/api/cron/propose-calendar-book/route.ts \
  && grep -q 'interviewProposal' scripts/sourcing-loop-worker.mjs \
  && grep -q 'use_calendar_event_route' src/app/api/cron/propose-calendar-book/route.ts; then
  pass "calendar_book → propose dry-run + structured interviewProposal + UI-only live book."
else
  fail "calendar propose path missing interviewProposal or use_calendar_event_route guard."
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

# Entra SSO surface: login page exposes Azure only when the public flag is compiled in.
# After tip deploy with GoTrue Azure secrets, fly-deploy-now sets NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true.
if grep -q 'azureLoginEnabled' src/app/login/page.tsx \
  && grep -q 'provider: "azure"' src/app/login/page.tsx \
  && grep -q 'NEXT_PUBLIC_ENABLE_AZURE_LOGIN' fly.app.toml; then
  pass "Entra SSO login surface is flag-gated (azure provider + NEXT_PUBLIC_ENABLE_AZURE_LOGIN)."
else
  fail "Entra SSO login surface missing or not flag-gated."
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
    count: 3,
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
AGENT_CAMPAIGN_ID="${E2E_CAMPAIGN_ID:-camp-e2e}"
jq -n --arg id "$AGENT_CAMPAIGN_ID" '{campaignId:$id, count:3}' > "$WORK/agent_req.json"
HTTP=$(curl -sS -m "${API_TIMEOUT:-180}" -o "$RESP" -w '%{http_code}' -X POST "$APP_URL/api/sourcing-agent" \
  -H 'Content-Type: application/json' -H "Origin: $APP_URL" -H "Cookie: $COOKIE_HDR" \
  -H "Idempotency-Key: $(uuidgen | tr 'A-Z' 'a-z')" --data-binary @"$WORK/agent_req.json")
AG_CODE=$(jq -r '.code // empty' "$RESP")
if [ "$HTTP" = "404" ] || [ "$AG_CODE" = "CAMPAIGN_NOT_READY" ]; then
  info "sourcing-agent SKIPPED: campaign '$AGENT_CAMPAIGN_ID' is absent or its brief is unreviewed ($AG_CODE)."
  info "      Seed a campaign with status Sourcing whose jobAnalysis passes evaluateNeedReadiness"
  info "      (title, seniority and employmentType must not be Unspecified), then set E2E_CAMPAIGN_ID."
  echo 'null' > "$WORK/cand0.json"
  AG_OK="skipped"
fi
[ "${AG_OK:-}" = "skipped" ] || AG_OK=$(jq -r '.ok // false' "$RESP")
AG_N=$(jq -r '(.candidates // []) | length' "$RESP")
AG_LIVE=$(jq -r '[(.candidates // [])[] | select(.provenance=="live")] | length' "$RESP")
AG_URLED=$(jq -r '[(.candidates // [])[] | select((.githubUrl // .linkedinUrl // .sourceUrl // "") != "")] | length' "$RESP")
if [ "$AG_OK" = "skipped" ]; then
  : # already reported above; a missing or unreviewed campaign is a setup gap, not a failure
elif [ "$HTTP" = "200" ] && [ "$AG_OK" = "true" ] && [ "$AG_N" -gt 0 ] && [ "$AG_LIVE" = "$AG_N" ] && [ "$AG_URLED" -gt 0 ]; then
  pass "Agent returned $AG_N candidates, ALL provenance=\"live\", $AG_URLED with real profile URLs (totalFound=$(jq -r '.totalFound' "$RESP"))."
  jq '.candidates[0]' "$RESP" > "$WORK/cand0.json"
else
  # Report the server's OWN code and error. The old message asserted a missing
  # provider key regardless of cause, which mis-diagnosed a schema rejection.
  fail "sourcing-agent (HTTP $HTTP, code=${AG_CODE:-none}, ok=$AG_OK, n=$AG_N, live=$AG_LIVE): $(jq -rc '.error // .reason // "no candidates"' "$RESP")"
  echo 'null' > "$WORK/cand0.json"
fi

# Reuse a real candidate for outreach when available; else a synthetic id (approve doesn't require pre-existing state).
CAND_ID=$(jq -r 'if type=="object" and .id then .id else empty end' "$WORK/cand0.json")
[ -n "$CAND_ID" ] || CAND_ID="cand-e2e-$$"
CAND_LI=$(jq -r '(.linkedinUrl // .githubUrl // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
[ -n "$CAND_LI" ] || CAND_LI="https://www.linkedin.com/in/e2e-candidate"
CAND_EMAIL=$(jq -r '(.email // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
[ -n "$CAND_EMAIL" ] || CAND_EMAIL="e2e.candidate@example.com"

# ---- draft generator: /api/hermes/chat task=outreach; Fly fail-closed (no canned) ----
DRAFT_SUBJECT=""; DRAFT_BODY=""
gen_draft() {  # $1 = channel label used only in the prompt
  local channel="$1" prompt gen ok text
  prompt="Write a short first-touch ${channel} outreach message to a senior TypeScript engineer named ${CAND_ID%%-*} about a Senior TypeScript Engineer role in London. Lead with their work, one genuine reason, soft ask."
  jq -n --arg p "$prompt" --arg prov "$AGENT_PROVIDER" --arg model "$OUTREACH_MODEL" \
    '{task:"outreach", prompt:$p, provider:$prov, model:$model}' > "$WORK/draft_req.json"
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
  local channel="$1"
  if gen_draft "$channel"; then
    pass "Generated a ${channel} draft via /api/hermes/chat (subject: \"$(printf '%.60s' "$DRAFT_SUBJECT")\")."
    return 0
  fi
  if [ "$APP_URL" = "https://aria-mantu-app.fly.dev" ] && [ "${ARIA_ALLOW_CANNED_DRAFT_E2E:-}" != "1" ]; then
    fail "Fly enterprise E2E requires live Hermes ${channel} draft (canned fallback disabled). Set ARIA_ALLOW_CANNED_DRAFT_E2E=1 only for partial runs."
    return 1
  fi
  DRAFT_SUBJECT="Your open-source TypeScript work"
  DRAFT_BODY="Hi, I came across your recent TypeScript and React work and was genuinely impressed by how you structure things. We are hiring a senior engineer for a platform team in London and I thought of you. No pressure at all, but if you are even a little curious I would love to share more. Either way, keep up the great work."
  warn "${channel} draft generation degraded (no tool-calling/provider key): $(jq -rc '.reason // empty' "$RESP") — using a canned draft so the approval + no-send assertions still run."
  return 0
}

# ===========================================================================
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
jq -n --arg m "$MSG_LI" --arg c "$CAND_ID" --arg r "$CAND_LI" --arg s "$DRAFT_SUBJECT" --arg b "$DRAFT_BODY" \
  '{messageId:$m, candidateId:$c, channel:"LinkedIn", recipient:$r, subject:$s, body:$b}' > "$WORK/approve_req.json"
api POST "$APP_URL/api/outreach/approve" "$WORK/approve_req.json"
AP_OK=$(jq -r '.ok // false' "$RESP")
AP_PERSISTED=$(jq -r 'if has("persisted") then .persisted else true end' "$RESP")
if [ "$HTTP" = "200" ] && [ "$AP_OK" = "true" ] && [ "$AP_PERSISTED" = "true" ]; then
  pass "Human approval RECORDED server-side (this is the state the client renders as 'Pending Manual Send')."
elif [ "$HTTP" = "200" ] && [ "$AP_OK" = "true" ]; then
  warn "Approve returned dry-run/persisted:false → this instance runs in public-demo mode (NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true); approval is not durable."
elif [ "$HTTP" = "403" ]; then
  fail "Approve 403 — session lacks the 'outreach' permission."
else
  fail "Approve failed (HTTP $HTTP): $(head -c 300 "$RESP")"
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

# Query both durable outbound stores with the same authenticated identity. The
# manual LinkedIn refusal and confirmLive=false email dry run must create no
# ledger claim and no outbox row for either approval message id.
NO_SEND_LEDGER="$WORK/no-send-ledger.json"
NO_SEND_OUTBOX="$WORK/no-send-outbox.json"
NO_SEND_FILTER="in.($MSG_LI,$MSG_EM)"
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

# ===========================================================================
step "6) First interview — calendar/Teams dry-run (Outlook Graph when live)"
# ===========================================================================
# confirmLive:false must never create a Graph event. Live Teams join links require
# a connected Microsoft Graph seat + confirmLive:true (same route).
START_ISO=$(date -u -d '+2 days 15:00' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+2d +%Y-%m-%dT15:00:00Z)
END_ISO=$(date -u -d '+2 days 15:45' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+2d +%Y-%m-%dT15:45:00Z)
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
step "Summary"
# ===========================================================================
printf "  ${C_G}%d passed${C_0}, ${C_R}%d failed${C_0}, ${C_Y}%d warnings${C_0}\n" "$PASSES" "$FAILS" "$WARNS"
if [ "$FAILS" -gt 0 ]; then
  printf "  ${C_R}RESULT: FAIL${C_0}\n"; exit 1
else
  printf "  ${C_G}RESULT: PASS${C_0}\n"; exit 0
fi
