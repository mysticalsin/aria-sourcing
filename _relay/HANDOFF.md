---
project: MSourcing / ARIA
shift: 76
agent: cursor-cloud
updated: 2026-08-25 UTC
status: blocked-fly-auth-awaiting-owner-signin
---

# Handoff - Shift 76

## Current state

- **Real production URL:** https://aria-mantu-app.fly.dev/login?redirect=%2F (Fly, not Vercel).
- Live Fly build `3ff4852`, migration `0046_swarm_orchestration_authority.sql` (`/api/ready`).
- Login 200, `/api/health` 200, demo login disabled (`POST /api/auth/demo-login` → disabled).
- GoTrue redirects to `aria-mantu-app.fly.dev` (not 0.0.0.0:3000).
- LinkedIn routes **404** on Fly — code/migrations not deployed (`0047`–`0059` missing).
- Feature branch tip `8e42dc2` (`cursor/enterprise-autopilot-b91d`), PR #27 open.
- Local gate green; GitHub Actions budget blocks CI on PR #27.
- Fly CLI login opened in cloud-agent browser; `flyctl auth whoami` still fails (no token yet).
- Agent cannot read GitHub Actions secrets or dispatch protected workflow (403).
- Deploy blocked until owner completes Fly sign-in OR provides `FLY_API_TOKEN` + `.fly-secrets.env`.

## Done this shift

- Confirmed Fly is the real tenant target (user pivot from Vercel demo).
- Added `scripts/fly-golive-linkedin.sh` — read-only preflight + owner dispatch checklist.
- Added `production-readiness/FLY_GOLIVE.md` — Fly production runbook.
- Added `scripts/fly-deploy-now.sh` — migrations + app deploy once auth/secrets available.
- Opened Fly CLI browser login (`flyctl auth login` in tmux `fly-auth-login`).

## Blockers (owner must supply)

1. **Fly deploy:** run `Deploy Aria Mantu (Fly)` workflow_dispatch from `deploy/fly-github-actions` with green CI/CodeQL SHA + recovery receipt SHA256.
2. **Or** local `.fly-token.env` + `.fly-secrets.env` and `prod-deploy-app.sh` after migrations are at 0059.
3. **GitHub Actions budget** — CI must pass on release SHA before protected deploy accepts it.
4. **Admin creds** for `e2e-workflow-test.sh` post-deploy proof.

## Next steps

1. Owner: `bash scripts/fly-golive-linkedin.sh 8e42dc2` (preflight).
2. Fast-forward `deploy/fly-github-actions` to include LinkedIn + migrations 0047–0059.
3. Restore Actions budget → green CI + CodeQL on release SHA.
4. Dispatch protected Fly deploy workflow.
5. Optional: `fly secrets set LINKEDIN_INBOUND_WEBHOOK_SECRET=… -a aria-mantu-app`.
6. Prove: login → Connect LinkedIn → Simulate → row in `linkedin_channel_events` + classify job.

## Decisions made (don't relitigate)

- **Fly** (`aria-mantu-app.fly.dev`) is production; Vercel demo stays open-demo for sales.
- Do **not** enable demo login on Fly.
- Full protected deploy applies migrations; app-only deploy assumes DB already at 0059.

## Watch out

- Live Fly is **13 migrations behind** source (0046 vs 0059) — deploy app without migrations will break RPC calls.
- `/api/linkedin/*` returning **404** means old build; **401** means routes shipped.
- `NEXT_PUBLIC_*` on Fly are baked at image build time via `fly.app.toml` + deploy `--build-arg`.
