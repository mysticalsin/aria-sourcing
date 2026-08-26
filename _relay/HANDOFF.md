---
project: MSourcing / ARIA
shift: 78
agent: cursor-cloud
updated: 2026-08-26 UTC
status: fly-sourcing-e2e-green
---

# Handoff - Shift 78

## Current state

- **Production:** https://aria-mantu-app.fly.dev
- Build `9ee01ce` live; migration `0059_linkedin_heyreach_parity.sql`.
- `/api/ready`: db/auth/queue/migration/releaseIdentity/hermesRuntime true; agentFrameworks false (expected).
- **Autosource E2E proven on Fly** for System Designer (Magnit / Montreal):
  - `POST /api/intake` → mantu-need, Senior/Contract/On-site, ready (no critical warnings)
  - `POST /api/sourcing-agent` → HTTP 200, mode=deterministic, 3 LinkedIn candidates with profile URLs
  - `POST /api/outreach/approve` → 200; `POST /api/outreach/send` LinkedIn → **409 manual-required** (assisted-manual by design)

## Done this shift

- Root cause of "invalid response" + blocked autosource:
  1. Earlier: static `playwright-core` import crashed standalone image (fixed in `dce0d4c`).
  2. Blocking after that: Fly `req.nextUrl.origin` is `http://0.0.0.0:3000`, so browser Origin always got `CROSS_ORIGIN_REQUEST` (`42a44f8`).
- Intake: years floors (`8 years +`, `5+ years`, `at least 6 years`) → Senior (`9ee01ce`).
- LinkedIn-first deterministic search + Tavily env fallback already deployed.

## Blockers

- `KIMI_API_KEY` returns upstream 401 → Hermes chat drafts fail; **sourcing does not depend on Kimi** (deterministic path).
- `/api/ready` `ok:false` until agent frameworks (Flowise/Deerflow) ship — unrelated to sourcing.
- Pre-existing red: `tests/infra-release-contract.mts` flags `scripts/fly-deploy-now.sh` + `fly-golive-linkedin.sh` as unsafe alternate deploy surfaces (not introduced this shift).

## Next steps

1. Optional: rotate/fix `KIMI_API_KEY` or set workspace default sourcing/outreach to Anthropic/OpenAI vault keys for LLM drafts.
2. Do **not** rewrite Hermes with LangChain for this tenant — deterministic search + assisted-manual LinkedIn already completes the recruiting loop. LangChain would be a parallel experiment, not a blocker.
3. Connect a real LinkedIn seat (HeyReach) when ready for operator-assisted send UX.
4. Keep owner-run `flyctl deploy --config fly.app.toml --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=…` until protected GH release path is the only mutate surface.

## Decisions made (don't relitigate)

- Fly is production; Vercel stays open-demo.
- Browser CSRF trusts canonical `https://aria-mantu-app.fly.dev` (+ `NEXT_PUBLIC_SITE_URL`), never `0.0.0.0` bind origin or client `x-forwarded-host`.
- LinkedIn delivery stays assisted-manual (409) — no session bots / password scrape.
- Kimi is blocked for the sourcing task provider; deterministic LinkedIn/Tavily/GitHub is the authority path when no tool-calling cloud key is configured.
- Experience floors ≥5 years (incl. `N years +`) authorize Senior for readiness.

## Watch out

- Do not commit passwords/tokens into `_relay/` or git.
- Sourcing-agent body is `{campaignId,count}` + Idempotency-Key only — campaign must already be in `workspace_state` and pass readiness.
- Boolean LinkedIn queries >256 chars fall back to keyword slice in deterministic mode.
