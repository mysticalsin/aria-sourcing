# Rocket Fuel Engagement — MSourcing production/enterprise hardening

Method: co-founder (V: claude · I: codex gpt-5.5) · Mode: audit · Opened: 2026-07-09 22:31 EDT

## Accountability Chart
| Seat | Who | This engagement |
|---|---|---|
| Visionary | Claude (this session, de6de54d) | Wrote PLAN.md; owns standards + Level 10 review; runs proofs by own hands |
| Integrator | Codex CLI (gpt-5.5, ChatGPT auth) | Attacks PLAN.md read-only; builds approved rocks in workspace-write sandbox; reports with proof |
| Owner | Tony | Answered the 4 scoping decisions; breaks deadlocks; approves commits/ship |

## Owner's locked decisions (2026-07-09)
1. GitHub sourcing: use gh token now → GITHUB_TOKEN set in .env.local (DONE, authorized).
2. Tavily/web SERP: build a SAFE in-app surface to add the key → encrypted backend (api_keys), workspace-scoped.
3. LinkedIn "with the API": BOTH tracks — compliant web-discovery now + official RSC partnership application drafted.
4. Mailbox OAuth (Google/MS): set up now — setup guide + env wiring so a real mailbox connects on the live app.

## Owner's acceptance criterion (the company rock)
Tony pastes a real need (copy-pasted email) → the sourcing loop starts → agents return REAL candidates fitting the request. Zero mock in the core sourcing path.

## Standards bar (Visionary-owned, non-negotiable)
- No spaghetti: each new module one responsibility; reuse existing patterns (api_keys encryption, resolveStored* helpers, SSRF guard) — do not reinvent.
- No new fake data paths. No status posing as real. Honesty over demo-theater.
- Every provider secret encrypted at rest (AES-256-GCM via existing crypto-secrets), admin-RLS, never round-trips to browser.
- Gate stays green: `npx tsc --noEmit && npm test` (67 suites) + `npm run lint` 0 errors.
- Compliance intact: LinkedIn wire-enforcement (18 tests) and outreach guardrails must still pass — never weakened to make a rock go green.
- Owner approves every commit; nothing auto-sends; nothing pushed without G6.

## Degraded periods (loud)
- 2026-07-09 22:31–22:40 EDT: ⚠️ DEGRADED solo-visionary (codex usage-limit). Plan authored solo; Same Page Meeting deferred to 22:40 reset. No rocks built while degraded.
