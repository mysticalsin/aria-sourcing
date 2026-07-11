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
# Optional env:  APP_URL  KONG_URL  AGENT_PROVIDER  AGENT_MODEL
#                GITHUB_QUERY  LINKEDIN_QUERY
# ---------------------------------------------------------------------------

set -uo pipefail

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
KONG_URL="${KONG_URL:-https://aria-mantu-kong.fly.dev}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ANON_KEY="${ANON_KEY:-}"
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

WORK="$(mktemp -d "${TMPDIR:-/tmp}/aria-e2e.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
RESP="$WORK/resp.json"                 # scratch body for the current app call
COOKIE_HDR=""                          # populated after login

printf "${C_B}Aria Mantu — E2E workflow test${C_0}\n"
info "App:  $APP_URL"
info "Kong: $KONG_URL"
info "Admin credential supplied. Agent provider: $AGENT_PROVIDER   Model: ${OUTREACH_MODEL:-<default>}"

# api METHOD URL [datafile] -> writes body to $RESP, echoes HTTP status into $HTTP
HTTP=""
api() {
  local method="$1" url="$2" data="${3:-}" tmo="${API_TIMEOUT:-60}"
  if [ -n "$data" ]; then
    HTTP=$(curl -sS -m "$tmo" -o "$RESP" -w '%{http_code}' -X "$method" "$url" \
      -H 'Content-Type: application/json' -H "Cookie: $COOKIE_HDR" --data-binary @"$data")
  else
    HTTP=$(curl -sS -m "$tmo" -o "$RESP" -w '%{http_code}' -X "$method" "$url" \
      -H "Cookie: $COOKIE_HDR")
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
INTAKE_TITLE=$(jq -r '.parsed.title // empty' "$RESP")
if [ "$HTTP" = "200" ] && [ "$(jq -r '.ok // false' "$RESP")" = "true" ] && [ -n "$INTAKE_TITLE" ]; then
  pass "Parsed JobAnalysis: title='$INTAKE_TITLE', skills=$(jq -c '.parsed.requiredSkills' "$RESP"), format=$(jq -r '.format' "$RESP")."
  jq '.parsed' "$RESP" > "$WORK/job_analysis.json"
else
  fail "Intake failed (HTTP $HTTP): $(head -c 300 "$RESP")"
  echo '{"title":"Senior TypeScript Engineer","requiredSkills":["TypeScript"],"niceToHaveSkills":[],"scoringWeights":null}' > "$WORK/job_analysis.json"
fi

# ===========================================================================
step "3) Sourcing — REAL candidates (GitHub raw, LinkedIn/Tavily, provenance=live)"
# ===========================================================================

# 3a. GitHub Users Search API — raw GithubUser[] with real profile URLs.
jq -n --arg q "$GITHUB_QUERY" '{platform:"GitHub", query:$q, count:8}' > "$WORK/src_gh.json"
api POST "$APP_URL/api/source" "$WORK/src_gh.json"
GH_OK=$(jq -r '.ok // false' "$RESP"); GH_SRC=$(jq -r '.source // empty' "$RESP")
GH_N=$(jq -r '(.users // []) | length' "$RESP")
GH_URL=$(jq -r '(.users // [])[0].htmlUrl // empty' "$RESP")
if [ "$HTTP" = "200" ] && [ "$GH_OK" = "true" ] && [ "$GH_SRC" = "github" ] && [ "$GH_N" -gt 0 ] && [[ "$GH_URL" == *github.com/* ]]; then
  pass "GitHub sourcing returned $GH_N REAL users (e.g. $(jq -r '.users[0].login' "$RESP") → $GH_URL)."
else
  fail "GitHub sourcing (HTTP $HTTP, ok=$GH_OK, source=$GH_SRC, n=$GH_N): $(jq -rc '.error // "no users"' "$RESP") — note: anonymous GitHub is 60 req/hr per egress IP."
fi

# 3b. LinkedIn — site:linkedin.com/in web search (Tavily preferred; DuckDuckGo fallback ~0 for people).
jq -n --arg q "$LINKEDIN_QUERY" '{platform:"LinkedIn", query:$q, count:8}' > "$WORK/src_li.json"
api POST "$APP_URL/api/source" "$WORK/src_li.json"
LI_OK=$(jq -r '.ok // false' "$RESP"); LI_SRC=$(jq -r '.source // empty' "$RESP")
LI_N=$(jq -r '(.leads // []) | length' "$RESP")
if [ "$HTTP" = "200" ] && [ "$LI_OK" = "true" ] && [ "$LI_SRC" = "web" ] && [ "$LI_N" -gt 0 ]; then
  pass "LinkedIn sourcing returned $LI_N REAL web leads (e.g. $(jq -r '.leads[0].name // "?"' "$RESP") → $(jq -r '.leads[0].url // "?"' "$RESP"))."
elif [ "$HTTP" = "200" ] && [ "$LI_SRC" = "web" ]; then
  fail "LinkedIn web search returned 0 leads — TAVILY_API_KEY is effectively required (DuckDuckGo fallback returns ~0 people)."
else
  fail "LinkedIn sourcing failed (HTTP $HTTP, ok=$LI_OK, source=$LI_SRC): $(jq -rc '.error // empty' "$RESP")"
fi

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
API_TIMEOUT=150 api POST "$APP_URL/api/sourcing-agent" "$WORK/agent_req.json"
AG_OK=$(jq -r '.ok // false' "$RESP")
AG_N=$(jq -r '(.candidates // []) | length' "$RESP")
AG_LIVE=$(jq -r '[(.candidates // [])[] | select(.provenance=="live")] | length' "$RESP")
AG_URLED=$(jq -r '[(.candidates // [])[] | select((.githubUrl // .linkedinUrl // .sourceUrl // "") != "")] | length' "$RESP")
if [ "$HTTP" = "200" ] && [ "$AG_OK" = "true" ] && [ "$AG_N" -gt 0 ] && [ "$AG_LIVE" = "$AG_N" ] && [ "$AG_URLED" -gt 0 ]; then
  pass "Agent returned $AG_N candidates, ALL provenance=\"live\", $AG_URLED with real profile URLs (totalFound=$(jq -r '.totalFound' "$RESP"))."
  jq '.candidates[0]' "$RESP" > "$WORK/cand0.json"
else
  fail "sourcing-agent (HTTP $HTTP, ok=$AG_OK, n=$AG_N, live=$AG_LIVE): $(jq -rc '.reason // "no candidates"' "$RESP") — needs a tool-calling provider key (e.g. ANTHROPIC_API_KEY) enabled for '$AGENT_PROVIDER'."
  echo 'null' > "$WORK/cand0.json"
fi

# Reuse a real candidate for outreach when available; else a synthetic id (approve doesn't require pre-existing state).
CAND_ID=$(jq -r 'if type=="object" and .id then .id else empty end' "$WORK/cand0.json")
[ -n "$CAND_ID" ] || CAND_ID="cand-e2e-$$"
CAND_LI=$(jq -r '(.linkedinUrl // .githubUrl // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
[ -n "$CAND_LI" ] || CAND_LI="https://www.linkedin.com/in/e2e-candidate"
CAND_EMAIL=$(jq -r '(.email // "") | select(.!="")' "$WORK/cand0.json" 2>/dev/null)
[ -n "$CAND_EMAIL" ] || CAND_EMAIL="e2e.candidate@example.com"

# ---- draft generator: /api/hermes/chat task=outreach; falls back to a canned draft ----
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

# ===========================================================================
step "4) LinkedIn outreach — draft → approve (assisted-manual) → NO send fired"
# ===========================================================================
if gen_draft "LinkedIn"; then
  pass "Generated a LinkedIn draft via /api/hermes/chat (subject: \"$(printf '%.60s' "$DRAFT_SUBJECT")\")."
else
  DRAFT_SUBJECT="Your open-source TypeScript work"
  DRAFT_BODY="Hi, I came across your recent TypeScript and React work and was genuinely impressed by how you structure things. We are hiring a senior engineer for a platform team in London and I thought of you. No pressure at all, but if you are even a little curious I would love to share more. Either way, keep up the great work."
  warn "Draft generation degraded (no tool-calling/provider key): $(jq -rc '.reason // empty' "$RESP") — using a canned draft so the approval + no-send assertions still run."
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
if gen_draft "email"; then
  pass "Generated an email draft via /api/hermes/chat (subject: \"$(printf '%.60s' "$DRAFT_SUBJECT")\")."
else
  DRAFT_SUBJECT="A role I think fits your TypeScript work"
  DRAFT_BODY="Hi, your recent TypeScript and Node work caught my eye. We are hiring a senior engineer for a London platform team and I thought it might be up your street. Happy to share detail if useful, and no worries if the timing is off."
  warn "Email draft generation degraded ($(jq -rc '.reason // empty' "$RESP")); using a canned draft."
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
step "Summary"
# ===========================================================================
printf "  ${C_G}%d passed${C_0}, ${C_R}%d failed${C_0}, ${C_Y}%d warnings${C_0}\n" "$PASSES" "$FAILS" "$WARNS"
if [ "$FAILS" -gt 0 ]; then
  printf "  ${C_R}RESULT: FAIL${C_0}\n"; exit 1
else
  printf "  ${C_G}RESULT: PASS${C_0}\n"; exit 0
fi
