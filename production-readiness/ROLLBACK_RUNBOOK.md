# Rollback Runbook — Hermes Sourcing

**App:** Hermes Sourcing (MSourcing)
**Stack:** Next.js 14 App Router · Supabase · Vercel
**Last updated:** 2026-06-27

---

## Decision tree: should you roll back?

```
Is production broken or degraded?
  └─ Yes → Is it a code/config/env-var issue?
               └─ Yes → Vercel instant rollback (Step 1)
               └─ No, it's a data/migration issue → DB rollback (Step 2) + Vercel rollback
  └─ No, issue is isolated to one user → Investigate before rolling back
```

Target time-to-rollback: **< 5 minutes** for Vercel-only. DB rollback adds ~15 minutes.

---

## Step 1 — Vercel instant rollback (code/config)

Vercel retains every production deployment. Rolling back means promoting a previous deployment to production — no rebuild required.

### Via Vercel dashboard (fastest)

1. Open **Vercel → hermes-sourcing → Deployments**.
2. Find the last known-good deployment (the one before the current broken deploy).
3. Click the three-dot menu → **Promote to Production**.
4. Confirm the dialog.
5. The previous build is live within ~30 seconds.

### Via Vercel CLI

```bash
# List recent deployments
vercel ls --prod hermes-sourcing

# Output shows deployment IDs, e.g.:
# dpl_AbcXyz  https://hermes-sourcing-abc.vercel.app  2026-06-27T10:00Z  ● Ready
# dpl_PrevOk  https://hermes-sourcing-def.vercel.app  2026-06-26T09:00Z  ● Ready

# Promote the last good deployment:
vercel promote dpl_PrevOk --scope <team-slug>
```

### Verify rollback

Run the smoke check sequence from DEPLOYMENT_RUNBOOK.md §5. All checks must pass before declaring the rollback complete.

```bash
# Quick health check (no auth required):
curl -sI https://<app>/login | head -n1
# Expect: HTTP/2 200 or HTTP/2 307

curl -sI https://<app>/ | grep -i content-security-policy
# Expect: non-empty CSP header
```

---

## Step 2 — Database migration rollback

Supabase does not support automatic migration down. Each migration must be reversed manually via the SQL Editor or the Supabase CLI's `db reset` (destructive — staging only).

**IMPORTANT:** Only roll back a migration if the current schema version is incompatible with the code version you are rolling back to. In most cases, Vercel rollback alone is sufficient.

### Determine whether a DB rollback is needed

1. Open the Vercel dashboard and note the Git SHA of the deployment you are rolling back **to**.
2. Run `git log --oneline` and identify whether any migration files changed between that SHA and the current `HEAD`.
3. If no migrations changed → DB rollback is NOT needed. Proceed with Vercel rollback only.

### Rollback order (reverse of apply order)

Always reverse migrations in **reverse numeric order**: `0004` → `0003` → `0002` → `0001`.

#### Undo 0004_email_connections.sql

```sql
-- In Supabase SQL Editor:
DROP TABLE IF EXISTS public.email_connections;
```

#### Undo 0003_api_keys.sql

```sql
DROP TABLE IF EXISTS public.api_keys;
```

**WARNING:** This deletes all stored API keys (provider tokens). Notify all admins before executing. Re-entering keys is required after re-applying the migration.

#### Undo 0002_fleet.sql

```sql
DROP TABLE IF EXISTS public.outreach_ledger;
DROP TABLE IF EXISTS public.suppression_list;
DROP TABLE IF EXISTS public.agent_seats;
DROP FUNCTION IF EXISTS public.claim_and_record(uuid, text, text, text, int, int);
```

**WARNING:** Dropping `outreach_ledger` erases the deduplication and suppression history. Do NOT do this if real outreach has been sent — you will lose the audit trail and the re-contact window protections will be gone.

#### Undo 0001_init.sql

```sql
DROP TABLE IF EXISTS public.workspace_state;
DROP TABLE IF EXISTS public.profiles;
DROP TABLE IF EXISTS public.workspaces;
DROP FUNCTION IF EXISTS public.ensure_workspace();
DROP FUNCTION IF EXISTS public.current_workspace_id();
DROP FUNCTION IF EXISTS public.current_profile_role();
```

**WARNING:** This destroys all workspace data, user profiles, and persisted state. Only do this if you are intentionally resetting to a blank state (e.g. on a staging environment).

### After DB rollback: verify integrity

```sql
-- Check table list matches target schema:
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Confirm RLS is still enabled on remaining tables:
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
-- Must return 0 rows (all tables have RLS on)
```

---

## Step 3 — Env var rollback

If the issue was caused by a changed environment variable:

1. Go to **Vercel → Project → Settings → Environment Variables**.
2. Locate the changed variable.
3. Click **Edit** and restore the previous value.
4. **Redeploy** (Vercel env var changes require a redeploy to take effect).

```bash
# Or via CLI:
vercel env rm VARIABLE_NAME production
vercel env add VARIABLE_NAME production   # prompts for new value
vercel --prod
```

---

## Post-rollback checklist

- [ ] Vercel deployment promoted to last known-good SHA
- [ ] Smoke checks pass (auth, critical routes, CSP, approval gate)
- [ ] DB migrations confirmed at correct version (if applicable)
- [ ] No outreach_ledger data lost (if real outreach was in flight)
- [ ] RLS still enabled on all public tables
- [ ] Incident log updated with: what failed, time of rollback, who approved
- [ ] Root cause identified before re-deploying the broken code

---

## Communication during rollback

Post an update in the team channel as soon as the rollback starts:

```
[ROLLBACK STARTED] Hermes Sourcing — rolling back to dpl_PrevOk
Reason: <one-line description>
ETA: ~5 min
On-call: <name>
```

Post again when complete:

```
[ROLLBACK COMPLETE] Hermes Sourcing is on dpl_PrevOk
Smoke checks: PASS
Root cause investigation: IN PROGRESS / <brief finding>
```

---

## Supabase PITR (Point-in-Time Recovery)

If data corruption occurred and a migration rollback is insufficient, use Supabase's PITR:

1. Go to **Supabase → Project → Database → Backups**.
2. Select **Point in Time Recovery**.
3. Choose the timestamp just before the corruption event.
4. Supabase restores to a new project — you must update `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel to point to the restored project.

PITR requires the **Pro** plan or above and has an RTO of ~15–30 minutes depending on database size. Confirm PITR is enabled on the Supabase project dashboard before you need it.
