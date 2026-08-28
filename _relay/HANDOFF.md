---
project: MSourcing / ARIA
shift: 291
agent: cursor-cloud
updated: 2026-08-28T17:20Z
status: omogen-compete-hub-ship
---

# Handoff — Shift 291

## Current state

- **Live Fly:** reminting after Candidate Hub ship (was `42a005f` / **0071**)
- **PR #36** (draft; supersedes closed-without-merge #29–#35)
- **Scope change (Tony):** skip M365/Entra + Vercel — compete with Omogen **except calling**
- **New public surfaces:** `/hub`, `/hub/developpeur-java`, `/hub/report/[token]`, `/product`, `/pricing`, `/docs`, `/docs/api` + `/api/hub/*`
- **M365:** still owner-blocked (ignored this shift per instruction)

## Done this shift

1. Reverse-engineered Omogen gaps (hub, diagnostic, API docs, pricing) — no voice calling
2. Built Candidate Hub (FR/EN/ES) with AI compatibility scorecard + self-serve next step
3. Featured hub: **Développeur Java** (`/hub/developpeur-java`) with LinkedIn search hint
4. Public product ADN + Starter/Optimize/Scale pricing + API docs pages
5. Tests: `tests/candidate-hub.mts` registered in application manifest

## Blockers

None for hub ship. M365 remains optional/out-of-scope for this compete track.

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/hub/catalog?locale=fr | jq
curl -fsS https://aria-mantu-app.fly.dev/hub/developpeur-java -o /dev/null -w '%{http_code}\n'
# optional later: CAREERS_WORKSPACE_ID to re-enable /careers chatbox
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI
- Skip M365/Entra until owner resumes; compete track does not wait on Graph
- No candidate phone calling (Omogen Mio parity deliberately excluded)
- Tony HOLD: do not open another PR; keep #36
- Manual mailbox labels ≠ Graph OAuth; Live send needs mode=live

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
curl -fsS 'https://aria-mantu-app.fly.dev/api/hub/catalog?locale=fr' | jq '.hubs[0].slug'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
```

## Watch out

- Hub apply requires `DATA_ENCRYPTION_KEY` or `CANDIDATE_HUB_SECRET` (≥16 chars) — already on Fly
- `/careers` still 503 without `CAREERS_WORKSPACE_ID` — hub catalog is independent
- GHA CI fails instantly with 0 steps — ignore
