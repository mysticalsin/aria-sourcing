---
project: MSourcing / ARIA
shift: 1
agent: claude-code
updated: 2026-07-09
status: in-progress
---

# Handoff — ARIA enterprise-ready (sourcing agents + Flowise Studio)

## Current state
- Branch `vercel-demo`. Goal re-scoped and persisted: `_agent_state/mantu-goal/goal-2026-07-08-aria-enterprise-ready.json` (12 milestones, deadline 2026-07-31 23:59 CET).
- Phase 1-3 of mantu-goal complete (Socratic capture, decomposition, premortem 9 risks). Status READY → execution starting.
- m1 (codebase audit) + m2 (deer-flow/Flowise deep-dive) launched as parallel Sonnet subagents.

## Done this shift
- Goal merged + re-scoped x2 (deer-flow agents, Flowise studio, WhatsApp + human-likeness gate). Deadline Jul 31.
- m1 audit (inline), m2 research done: `_relay/research/2026-07-09-deer-flow-patterns.md`, `_relay/research/2026-07-09-flowise-integration-spec.md`. m3 plan: `_relay/PLAN.md`.
- W1 BUILT+TESTED: `supabase/migrations/0007_agent_runtime.sql` (agent_specs/agent_runs/agent_events/messages_outbound/messages_inbound + RLS); `src/lib/gate.ts` human-likeness gate (94/94 adversarial tests, `tests/gate.mts`); gate wired into `/api/outreach/send` (block-only, preserves approval hash).
- W3 BUILT+TESTED: `src/lib/autopilot.ts` (Meta sig verify, webhook parse, reply composer, decision matrix — 32/32 `tests/autopilot.mts`); `/api/webhooks/whatsapp` (inbound + gated autopilot + canary + system approval rows); `/api/cron/dispatch-outbound` (re-gate + claim_and_record before wire); vercel.json cron each minute (needs Vercel Pro). Typecheck clean.

## Blockers
- none (subagent infra flaky tonight — 3 stalls; built inline instead)

## Next steps (in order)
1. W2: `src/lib/agents/graph.ts` (planner→sourcer→screener→outreach→reporter state machine, per-node persist to agent_runs) + `/api/agents/run` + `tests/agent-graph.mts`.
2. W4: Flowise studio — `/studio` page + `/api/flowise/[...path]` proxy + agent_specs CRUD route.
3. W5: admin metrics from messages_outbound/agent_runs real data.
4. W6: full `npm test` + typecheck + commit + push `vercel-demo` (Vercel auto-deploy). Env needed in Vercel: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_WORKSPACE_ID, CRON_SECRET (+ existing WHATSAPP_TOKEN/PHONE_NUMBER_ID for live sends).

## Decisions made (don't relitigate)
- Merge into goal-2026-07-08-aria-enterprise-ready — one source of truth.
- "SANA" = Sonnet — audits run on Sonnet, Fable plans/synthesizes/reviews.
- Flowise = sidecar service + embedded UI in ARIA "Agent Studio" section (NOT native React Flow rebuild; NOT Vercel-hosted — needs persistent Node host).
- deer-flow = steal architecture, build TS-native runtime (Python sidecar authorized as fallback if TS quality falls short).
- Autopilot = GATED: drafts instantly; auto-send ONLY within approved-template/topic/rate guardrails; rest queues for Tony. Never-auto-send stays platform default; autopilot is per-agent opt-in.
- LinkedIn always policy-engine-governed (src/lib/linkedin-policy.ts), draft-gated; email is the auto-send channel.
- Out of scope: real candidate PII in tests, native mobile apps, billing.
- Prior 6 external repos (OmniRoute, Agent-Reach, orca, shepherd, agency-agents, obscura) DEPRIORITIZED.
- WhatsApp channel IN scope (re-scope #2): official API only (Meta Cloud API / Twilio); templates for business-initiated, free-form only in 24h service window. Unofficial libs forbidden (ban risk).
- Human-likeness gate on ALL outbound: default-deny pipeline — only 'candidate_reply' / 'approved_template' message types can enter send queue; agent status/narration lives in events table with NO send path; AI-tell filter + dedupe cache + human pacing (delays, quiet hours); adversarial fixture suite must prove 0% leak.

## Watch out
- Repo is OneDrive-synced — build artifacts must stay gitignored; deploy from git.
- vercel-demo branch runs on mock/synthetic data; tenancy retrofit can break demo flows — regression at every gate.
- Flowise embed auth is the riskiest unknown (premortem risk #2).
