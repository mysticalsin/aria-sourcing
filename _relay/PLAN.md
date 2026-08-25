# PLAN: Ship 4 - Fix 500s on /api/hermes/chat and /api/sourcing-agent

**Basis:** fix/fly-auth-public-origin @ fe197d3 (after ship 3)
**Written:** 2026-08-25
**Scope:** Diagnose and fix 500 errors on AI/sourcing API routes. No Fly deploy.

## Current State

Ships 1-3 committed:
- 7417cd0: Auth redirects use public host (not 0.0.0.0:3000)
- a25dd1f: scripts/seed-fly-admin.sh documents admin@hermes.local setup
- fe197d3: docs/FLY_SETUP.md documents complete deployment checklist

After Tony completes ships 1-3 setup:
- Login works
- Workspace loads (Command Center shows)
- But workspace is EMPTY (no campaigns, no candidates, no integrations)
- Clicking "Source next batch" or using chat fails

## Problem

Both `/api/hermes/chat` and `/api/sourcing-agent` require:

1. **Authentication:** User must be logged in (getServerSupabase)
2. **Workspace state:** Must have campaigns and data
3. **External API keys:** AI provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
4. **Database tables:** All migrations applied (agent_seats, outreach_ledger, etc.)

The 500s likely come from ONE of:
- Campaign not found (empty workspace state, no campaigns seeded)
- Provider API key missing (vault lookup fails, no fallback)
- Database query fails (migrations incomplete)

## Diagnosis

**Case 1: Campaign not found (expected after first login)**

After Tony seeds admin@hermes.local and logs in:
- workspace_state row doesn't exist yet
- Store builds EMPTY state via `buildLiveEmptyState()` (src/lib/seed.ts)
- Empty state has: 0 campaigns, 0 candidates, 0 seats, default integrations
- User sees Command Center but it's blank

If user clicks "Source next batch" (or any action that calls /api/sourcing-agent):
- Store sends campaignId from empty state
- Route calls `readWorkspace` → finds empty state
- Returns 400 CAMPAIGN_NOT_FOUND (NOT a 500, but still breaks)

**Fix:** Seed demo campaigns OR document that admin must create campaigns via UI.

**Case 2: Provider API key missing**

/api/hermes/chat and /api/sourcing-agent try to resolve AI provider keys:
- Vault lookup: SELECT from api_keys table (requires 0003_api_keys.sql migration)
- Env fallback: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.

If BOTH fail:
- Routes may return 500 or 503 SOURCING_AGENT_NOT_CONFIGURED
- Hermes route falls back to deterministic mock (no 500)

**Fix:** Set provider API keys as Fly secrets.

**Case 3: Migrations incomplete**

If migrations 0003+ aren't applied, queries to api_keys, email_connections, etc. fail.

**Fix:** Apply all migrations (docs/FLY_SETUP.md step 3).

## Verification Steps for Tony

**Check 1: Is the workspace empty?**

After login, open browser console and run:

```javascript
// Get current state from store
const state = window.__HERMES_STATE__; // or inspect Network tab for /api/ready response
console.log("Campaigns:", state?.campaigns?.length ?? 0);
console.log("Candidates:", state?.candidates?.length ?? 0);
```

If both are 0: workspace is empty. Admin must create campaigns via UI.

**Check 2: Are provider keys configured?**

```bash
fly secrets list -a aria-mantu-app
```

Check for:
- ANTHROPIC_API_KEY (for Claude)
- OPENAI_API_KEY (for GPT)
- TAVILY_API_KEY (for web sourcing, optional)

If MISSING: AI routes will fail or fall back to mock.

**Check 3: Are all migrations applied?**

```bash
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
\dt public.*
SQL
```

Expected tables: workspaces, profiles, workspace_state, agent_seats, suppression_list, outreach_ledger, api_keys, email_connections, outbound_approvals, whatsapp_*, etc.

If MISSING: apply remaining migrations (see docs/FLY_SETUP.md step 3).

## Fixes

**Fix 1: Seed demo campaigns (optional, for testing)**

Create a seed script that inserts demo campaigns into workspace_state:

```bash
#!/usr/bin/env bash
# scripts/seed-fly-demo-campaigns.sh
# Inserts 3 demo campaigns into the admin workspace for testing.

set -euo pipefail

ADMIN_EMAIL="admin@hermes.local"

# Get service role key
SERVICE_ROLE_KEY=$(fly secrets list -a aria-mantu-app -j | jq -r '.[] | select(.Name=="SUPABASE_SERVICE_ROLE_KEY") | .Value')

# Get admin user + workspace
ADMIN_JSON=$(curl -s "https://aria-mantu-kong.fly.dev/auth/v1/admin/users?email=eq.${ADMIN_EMAIL}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}")

ADMIN_ID=$(echo "$ADMIN_JSON" | jq -r '.[0].id')

PROFILE_JSON=$(curl -s "https://aria-mantu-kong.fly.dev/rest/v1/profiles?id=eq.${ADMIN_ID}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "apikey: ${SERVICE_ROLE_KEY}")

WORKSPACE_ID=$(echo "$PROFILE_JSON" | jq -r '.[0].workspace_id')

# Load demo seed state (3 campaigns) from buildSeedState()
# This is complex — easier to do via UI or manual SQL
echo "[seed] Workspace ID: ${WORKSPACE_ID}"
echo "[seed] To seed campaigns, create them via the UI at https://aria-mantu-app.fly.dev/"
echo "[seed] Or paste a pre-built state JSON into workspace_state.state column."
```

**Recommendation:** Skip this for now. Admin should create campaigns via UI.

**Fix 2: Set AI provider keys**

```bash
# Anthropic (for Claude, used by /api/sourcing-agent)
fly secrets set ANTHROPIC_API_KEY=<your-key> -a aria-mantu-app

# OpenAI (for GPT, used by /api/hermes/chat fallback)
fly secrets set OPENAI_API_KEY=<your-key> -a aria-mantu-app

# Optional: Tavily for web sourcing
fly secrets set TAVILY_API_KEY=<your-key> -a aria-mantu-app

# Restart app to pick up new secrets
fly restart -a aria-mantu-app
```

After this, AI routes will use real models instead of failing.

**Fix 3: Apply remaining migrations**

If any migrations are missing, apply them:

```bash
# Check which migrations exist
ls supabase/migrations/

# Apply missing ones (example: 0003_api_keys.sql)
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" < supabase/migrations/0003_api_keys.sql

# Reload PostgREST
fly ssh console -a aria-mantu-db -C "psql -U postgres -d postgres" <<'SQL'
notify pgrst, 'reload schema';
SQL
```

## In-Repo Change for Ship 4

Update docs/FLY_SETUP.md to add a new section after step 5:

### 7. Configure AI Provider Keys (Required for Sourcing)

```bash
# Set provider keys (at least one is required)
fly secrets set ANTHROPIC_API_KEY=<your-anthropic-key> -a aria-mantu-app
fly secrets set OPENAI_API_KEY=<your-openai-key> -a aria-mantu-app

# Optional: Tavily for web sourcing
fly secrets set TAVILY_API_KEY=<your-tavily-key> -a aria-mantu-app

# Restart app
fly restart -a aria-mantu-app
```

Without provider keys, /api/hermes/chat falls back to deterministic mock, and /api/sourcing-agent returns 503 SOURCING_AGENT_NOT_CONFIGURED.

### 8. Create First Campaign

After login, create a campaign via the UI:
1. Go to Command Center → New Campaign
2. Fill in job details, sourcing strategy
3. Activate campaign
4. Click "Source next batch" to test live sourcing

## Verification After Fix

After Tony sets provider keys and creates a campaign:

1. Login at https://aria-mantu-app.fly.dev/
2. Create a campaign via UI
3. Click "Source next batch"
4. Should call /api/sourcing-agent and return candidates (or error with specific code, not 500)
5. Open chat, send message
6. Should call /api/hermes/chat and return response (or fall back to mock)

Browser console: no 500 errors, only specific error codes (CAMPAIGN_NOT_FOUND, etc.).

## Next Steps After Ship 4

E2E is complete when:
1. Auth redirects work (ship 1)
2. Admin login works (ship 2)
3. Workspace loads (ship 3)
4. Sourcing and chat work (ship 4)

Remaining polish:
- Seed real integrations (Google Drive, Microsoft 365)
- Configure email seats for outbound
- Set up cron for daily outreach dispatch
- Monitor logs for production errors
