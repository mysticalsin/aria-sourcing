---
project: MSourcing / ARIA
shift: 107
agent: cursor-cloud
updated: 2026-09-07T17:55Z
status: openbot-e2e-green-fly-key-expired
---

# Handoff — Shift 107

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → https://github.com/mysticalsin/aria-sourcing/pull/70
- **E2E:** openbot-llm-auth 9/9, openbot-e2e 30/30, openbot-live-same-key 19/19 (Fly Kimi key bytes + mock upstream)
- **Evidence:** `_relay/evidence/2026-09-07-openbot-same-key-e2e.md`
- **Live Fly:** `/api/openbot/v1` not deployed yet (404); deployed `KIMI_API_KEY` returns 401 from Kimi upstream (needs rotation)

## Done this shift

1. End-to-end verified OpenBot same-key auth + LinkedIn Browser Computer send (LLM-assisted) 
2. Added `tests/openbot-live-same-key.mts` using real Fly `KIMI_API_KEY` bytes against mock upstream
3. Documented prod shape: Aria’s LLM secret is `KIMI_API_KEY`, not OpenAI

## Blockers

1. Fly `KIMI_API_KEY` invalid/expired at `https://api.kimi.com/coding/v1` → live LLM completions fail until rotated
2. OpenBot proxy not on Fly tip yet (merge/deploy PR #70)
3. No `COMPUTER_SUPERVISOR_*` secrets → live LinkedIn Chromium seats not wired
4. Docker unavailable in this agent VM → cannot boot live OpenBot Chromium here

## Next steps

1. Rotate Fly `KIMI_API_KEY`; re-probe `/chat/completions`
2. Merge/deploy PR #70; smoke `GET /api/openbot/v1/models` with Bearer = Kimi key
3. Configure OpenBot supervisor URL/tokens; Fleet Observe LinkedIn login
4. Point OpenBot `OPENAI_BASE_URL` at Aria `/api/openbot/v1` with same Kimi key

## Decisions made (don't relitigate)

- OpenBot must use Aria’s same PROVIDER_ENV API key (prod = Kimi)
- Contract E2E with mock upstream + real key bytes is the CI gate; live Chromium is operator smoke

## Watch out

- Never print Fly LLM secrets in logs/commits
- `/api/openbot/v1` 404 on current tip is expected until deploy
