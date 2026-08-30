---
project: MSourcing / ARIA
shift: 80
agent: cursor-cloud
updated: 2026-08-26 UTC
status: recruiting-loop-e2e-green-on-fly
---

# Handoff - Shift 80

## Current state

- **Production:** https://aria-mantu-app.fly.dev · build **3080de4** (+ test-only 6dc102b) · migration **0060**.
- Full UI loop proven live: Consent Passport (lawful basis + fit endorse) → Draft LinkedIn → Approve → **Pending Manual Send** → **Confirm** → ledger/contacted.
- Dry-run must be **OFF** for LinkedIn to land in Pending Manual Send (not Scheduled dry-run).

## Done this shift

- Live SERP scoring: title/snippet/location evidence; channel-unavailable years/stage/industry → N/A for `provenance=live`.
- Consent Passport: record lawful basis + endorse role fit (warn-through below floor 70).
- Deployed + UI E2E: Michael Chimes LinkedIn → Confirmed send.
- Store action count 128 (contracts test updated).

## Blockers

- Pre-existing `infra-release-contract` fail: `fly-deploy-now.sh` / `fly-golive-linkedin.sh` alternate mutate surfaces.
- `/api/ready` agentFrameworks false (expected).
- Queued follow-up: improve candidate fit quality for JD (System Designer skills currently FDA/quality-ish → weak LinkedIn matches).

## Next steps

1. Improve intake/JD skill extraction + LinkedIn query so sourced profiles match System Designer (not quality/FDA adjacent).
2. Optional: default dry-run OFF for live tenant, or warn on Approve when dry-run would skip Pending Manual Send.
3. Optional: Anthropic/OpenAI vault key for nicer drafts (Kimi 401).

## Decisions made (don't relitigate)

- No LangChain rewrite; template drafts OK.
- LinkedIn assisted-manual only; Confirm writes ledger.
- Below-floor live leads: operator fit endorsement warn-through (score unchanged).
- Experience floors (`8 years +`) → Senior for readiness.

## Watch out

- Dry-run ON → LinkedIn Approve becomes Scheduled/nothing-sent-live (Confirm path unreachable).
- Approve disclosure still blocks department tokens like "Consulting" / salary figures in body.
