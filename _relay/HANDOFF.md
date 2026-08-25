---
project: MSourcing / ARIA
shift: 75
agent: cursor-cloud
updated: 2026-08-25 UTC
status: blocked-live-promote-needs-secrets
---

# Handoff - Shift 75

## Current state

- User wants **LIVE** (no demo login). Online URL https://aria-sourcing-demo.vercel.app is still open-demo (`NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`, no Supabase).
- Tip `14af171` on `main` / `vercel-demo` / feature branch. Product code is LIVE-capable; Production env is not.
- Agent cannot set totosworld Vercel env; hobby MCP team lacks GitHub Login Connection for `create_git_project`; no Fly auth; no Supabase keys/PAT in environment; no Docker for local Supabase.

## Done this shift

- Added `scripts/promote-live.sh` — fail-closed LIVE promote (db push + Vercel Production env, refuses demo login).

## Blockers (owner must supply)

1. **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ACCESS_TOKEN` + project ref to create/link + `db push`).
2. **Vercel Production write access** for `aria-sourcing-demo` (totosworld): `VERCEL_TOKEN` + org/project ids, OR re-auth Vercel MCP to totosworld, OR paste keys in dashboard and remove demo login.
3. **DATA_ENCRYPTION_KEY** (`openssl rand -base64 32`).
4. Apply migrations through **0059** on that Supabase project.
5. Redeploy Production after env change (NEXT_PUBLIC_* must be in the build).

## Next steps

1. Owner pastes secrets (or dashboard-sets them) per `scripts/promote-live.sh` / `production-readiness/VERCEL_GOLIVE.md`.
2. Run `bash scripts/promote-live.sh` (or dashboard equivalent).
3. Create first real user in Supabase Auth → login (no admin/admin).
4. Prove: Connect LinkedIn seat → Simulate → `linkedin_channel_events` row + classify job.

## Decisions made (don't relitigate)

- Do **not** remove demo login from Production until Supabase is wired — would 503 the public URL.
- Prefer converting `aria-sourcing-demo` to LIVE or a separate LIVE project; keep demo only if explicitly wanted.

## Watch out

- `NEXT_PUBLIC_*` require redeploy after change.
- Public demo side-effect kill-switch is tied to demo login flag; LIVE outbound still needs provider creds.
