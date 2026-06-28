# Local end-to-end setup (Supabase + backups + monitoring)

Runs the whole platform locally with a real Postgres backend (no cloud / no Vercel).

## One-time prerequisite (the only manual step)
1. **Open Docker Desktop** and accept the first-launch onboarding. Wait until the
   whale icon says **"Engine running"**. (Headless tooling cannot click this gate.)

The Supabase CLI is already vendored at `./.localbin/supabase` (v2.108.0).

## Bring it up (one command)
```bash
bash scripts/local-supabase-up.sh
```
This runs `supabase start` (pulls images on first run), applies **all migrations
0001–0005 including the RLS / tenant-isolation policy**, and writes `.env.local`
with the local URL + anon + service-role keys. Then:
```bash
npm run dev      # restart so .env.local is picked up → app now runs in LIVE mode
```
- App: http://localhost:3000  ·  Studio: http://127.0.0.1:54323
- The login CTA switches from "Enter the console" to **"Sign in with Microsoft"**
  when Supabase is configured. For local-only without Entra, use Supabase Studio
  → Authentication to create an email/password user, or keep demo mode (unset `.env.local`).

## Backups
```bash
bash scripts/backup.sh          # → backups/hermes_<ts>_schema.sql.gz + _data.sql.gz
```
Schedule locally with cron, e.g. hourly:
```
0 * * * * cd <repo> && bash scripts/backup.sh
```

## Restore drill (Gate 12 evidence)
```bash
bash scripts/restore-drill.sh   # restores the latest backup into a scratch DB,
                                # verifies tables + row counts, drops scratch, PASS/FAIL
```

## Monitoring
- **Health probe:** `GET /api/health` → `{ ok, status, checks }` (no secrets).
  Local uptime canary:
  ```bash
  watch -n 30 'curl -fs localhost:3000/api/health | jq .status'
  ```
- **Structured logs:** the Hermes proxy + send paths emit JSON log lines
  (`source: hermes-proxy`, audit events) to stdout — scrape `npm run dev` output
  or pipe to a file. See `OPERATIONS_RUNBOOK.md` for the alert thresholds.

## Status
- ✅ Login page, app, health endpoint, scripts — done + verified.
- ⏳ `supabase start` + migrations + first backup + restore drill — run automatically
  by the commands above the moment Docker Desktop is running.
