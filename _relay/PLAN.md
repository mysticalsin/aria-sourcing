# m3 Architecture Plan — ARIA sourcing agents + Flowise Studio (2026-07-09)

Fable-authored. Builds ON existing code — send pipeline, humanizer, guardrails, RLS stay as-is; we extend, never rewrite.

## What exists (audit findings, inline m1)
- `src/app/api/outreach/send/route.ts` — safe-by-construction: server approval gate (sha256 of exact message via `outreach_approvals` + `claim_and_record` RPC: suppression, re-contact window, daily caps, atomic dedupe), seat+domain verification, fail-closed prod, RBAC, rate limits. Channels: Email (Gmail/Graph), WhatsApp Cloud API + Twilio SMS (`src/lib/channels.ts`, env-gated dry-run).
- `src/lib/humanizer.ts` — deterministic AI-tell stripper, applied to outreach/reply drafts.
- `src/app/api/sourcing-agent/route.ts` — single-shot tool loop (Anthropic/OpenAI-style), real-platform search (`src/lib/sourcing/`: apollo, seamless, github, sillage, web-leads), anti-fabrication (only tool-returned candidateIds), never sends.
- `supabase/migrations/0005_rls_tenant_isolation.sql` (22K) — workspace tenancy pattern. `0006_outreach_approvals.sql`.
- `src/lib/rules.ts` — guardrails (score floor, dedupe window, approval checks, ReplyIntent). 40 tsx test suites. `store.ts` (249K) = client-side demo state.

## Gaps → build
1. No inbound replies (no webhooks). 2. No autopilot auto-answer. 3. No persistent on-demand agent runtime (state lives client-side). 4. No Flowise studio. 5. Admin metrics synthetic.

## A. Data (migration 0007_agent_runtime.sql, RLS per 0005 pattern)
- `agent_specs`: id, workspace_id, owner_id, name, role_brief jsonb, channels text[], guardrails jsonb {autopilot bool, topics_allow[], quiet_hours, max_per_day, canary_remaining int}, flowise_chatflow_id, status.
- `agent_runs`: id, spec_id, workspace_id, node text, state_json jsonb, step_count, status (running|awaiting_gate|done|failed).
- `agent_events`: run_id, at, type, payload jsonb — append-only. **NO send path from this table — human-likeness by architecture.**
- `messages_outbound`: workspace_id, candidate_id, channel, type ('candidate_reply'|'approved_template') — ONLY these two types can reach send, body, status (composed|gated|blocked|queued|sent), gate_result jsonb, dedupe_hash unique, scheduled_at.
- `messages_inbound`: workspace_id, candidate_id, channel, body, received_at, processed.

## B. Agent runtime (deer-flow pattern, TS-native — src/lib/agents/)
- `graph.ts`: state machine planner→sourcer→screener→outreach→reporter; nodes return `{update, nextNode}`; state persisted to `agent_runs` after EVERY node (resume = read row, re-invoke); step budget column; per-node tool injection reusing `sourcing-tools.ts`; planner = Zod Plan schema {steps[{title,description,step_type}], has_enough_context} + fence-strip/JSON-repair; reporter style enum.
- `/api/agents/run/route.ts`: drives loop, `maxDuration = 300`; persists per node so timeout = resumable, not fatal. (deer-flow verdict: skip LangGraph.js, DB-row resume.)

## C. Human-likeness gate + gated autopilot (src/lib/gate.ts)
Pipeline: compose → `humanize()` (existing) → AI-tell classifier (banned meta/status patterns: "as an AI", thinking/processing/status narration, bracketed actions, leaked JSON/markdown fences) → dedupe cache (sha256 vs messages_outbound.dedupe_hash) → pacing (quiet hours, min-gap per conversation, jittered delay) → verdict pass|blocked.
Autopilot path (per-spec opt-in): inbound reply + guardrails pass + within 24h WhatsApp window + canary spent ⇒ system records `outreach_approvals` row (scope-limited auto-approval) then existing `/api/outreach/send` — reuses the whole safe pipeline. Any fail ⇒ status blocked, queued in Replies UI for Tony. Never-auto-send stays default.

## D. Inbound
- `/api/webhooks/whatsapp/route.ts`: GET hub.challenge verify; POST → messages_inbound → autopilot trigger. (channels.ts already sends via graph.facebook.com — same creds.)
- Email: extend `email-sync.ts` to write messages_inbound. (ASSUMED: Cloud API version bump v18→current safe; verify at build.)

## E. Flowise Agent Studio
Sidecar (Docker: Railway/Fly, 2vCPU/4GB, own Postgres schema — NOT Vercel). `/studio` page embeds `@flowiseai/agentflow` (Apache-2.0 React canvas) via `/api/flowise/[...path]` proxy holding workspace API key server-side; ARIA DB maps spec↔chatflow_id; fallback iframe (IFRAME_ORIGINS) then new-tab. Flowise = editor; ARIA runtime = production execution.

## Build waves (each: code → test → refine; Sonnet-tested per Tony)
- W1 migration + gate lib + adversarial gate tests (50+ AI-tell fixtures, 100% blocked) → `tests/gate.mts`
- W2 agent graph + run route + synthetic-run test → `tests/agent-graph.mts`
- W3 WhatsApp webhook + autopilot loop + tests → `tests/autopilot.mts`
- W4 Studio page + proxy + spec CRUD
- W5 admin metrics from real tables
- W6 full `npm test` + typecheck + push `vercel-demo` (Vercel auto-deploy) — production per Tony 2026-07-09 instruction.

Verify each wave: suite passes + no regression in existing 40 suites (spot: outreach-guardrails, channels, sourcing-agent, rbac-negative).
