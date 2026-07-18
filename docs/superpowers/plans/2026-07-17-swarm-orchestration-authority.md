# Swarm Orchestration Authority — hermes-workspace gaps → ARIA (Rock 8)

Date: 2026-07-17. Owner request: study `outsourc-e/hermes-workspace`, implement its
multi-agent orchestration gaps in ARIA, matching ARIA's design and upgrading on it.

## Source analysis (hermes-workspace @ default branch, shallow clone)

Hermes "Swarm Mode": file-backed multi-agent control plane. Roster (`swarm.yaml`),
missions ledger (`.runtime/swarm-missions.json`), per-worker `runtime.json`,
six-field checkpoint contract (STATE / FILES_CHANGED / COMMANDS_RUN / RESULT /
BLOCKER / NEXT_ACTION), dispatch envelope, orchestrator loop route with stale
detection + auto-continue + reviewer-lane routing, notification routing
(checkpoints → orchestrator; only NEEDS_INPUT escalates to the human), greenlight
gate for external actions, context-budget lifecycle.

**Hermes's own defects (verified in its server code):**
- `greenlightRequiredFor` declared in roster schema, never enforced anywhere.
- `dependsOn` DAG helper exists but dispatch runs all assignments in `Promise.all`.
- `maxConcurrentTasks` stored, never checked.
- Checkpoints trusted from any assistant message; `POST /api/swarm-checkpoint`
  lets any authenticated caller write any worker's runtime.
- No server-side scheduler — the loop only runs when the UI calls it.
- Mission ledger has no live GC; reviewer completion helper imported but unused.
- Notifications are fire-and-forget tmux send-keys.

## What ARIA already has (stronger substrate)

- 0038 `aria_jobs` durable queue (lease / retry / backoff / dead-letter /
  idempotency / SKIP LOCKED), `loop_events` append-only, `sourcing_loop_controls`
  fail-closed switchboard (kill_switch TRUE default, admin-only enables, in-DB
  CHECK), `loop_worker_heartbeats`; sourcing-loop-worker tick conventions.
- 0029/0030/0032 framework run authority (pinned identities, receipts, leases).
- Outreach approval authority — never-auto-send enforced in-DB (0006/0011/0013…).
- 0042 `apply_workspace_patch`, 0043 requisitions, 0044 budgets, 0045 sequences.

**ARIA's gap = the entire orchestration layer:** no roster, no missions, no
assignments, no checkpoint contract, no orchestrator loop, no human escalation
inbox, no review-gate lane, no standing missions.

## Build (migration 0046 + worker + routes), ARIA idioms throughout

All tables: RLS enabled + forced, every direct grant revoked, postgres-only
policy, SECURITY DEFINER RPCs owned by postgres (0038 pattern). Payloads carry
ids only — never candidate PII (0038 contract).

### Tables
1. `swarm_agents` — roster: slug, name, role, specialty, standing persona
   mission, capabilities, preferred_task_types, greenlight_categories,
   max_concurrent (ENFORCED), review_required, standing_mission, enabled
   DEFAULT FALSE (dark).
2. `swarm_missions` — the SwarmBrief: goal, why_now, scope, deliverables,
   proof_contract, constraints, budget, source_ref idempotency, status machine
   planning → dispatching/executing/reviewing → blocked/complete/cancelled,
   optional requisition_id link (0043).
3. `swarm_assignments` — per-agent task: rationale, expected_output, depends_on
   (ENFORCED DAG gate), review_required, greenlight_category (ENFORCED gate),
   kind task|review, attempt bookkeeping, aria_job_id link.
4. `swarm_checkpoints` — append-only six-field proof ledger, **lease-bound**:
   recording requires the live aria_jobs lease for the assignment's job — a
   checkpoint cannot be spoofed by an arbitrary caller (upgrade over hermes).
5. `swarm_escalations` — durable human inbox rows (needs_input | blocked |
   greenlight | review | stale), answered only by an authenticated workspace
   admin. Replaces hermes's fire-and-forget tmux notification.

### Switchboard + queue extensions (0038 evolution)
- `sourcing_loop_controls.swarm_enabled` DEFAULT FALSE, folded into the
  fail-closed CHECK (recreated as a named constraint) and into
  `set_sourcing_loop_controls` (old signature dropped; no callers exist yet).
- `aria_jobs.kind` gains `swarm_assignment` (CHECK + `enqueue_aria_job`
  whitelist recreated).

### RPCs
Service-role: `seed_swarm_roster` wrapper (admin-gated), `create_swarm_mission`,
`plan_swarm_assignments` (≤12, validates slugs + DAG), `dispatch_ready_swarm_assignments`
(THE mechanical gate: kill_switch off + swarm_enabled + agent enabled + DAG
satisfied + max_concurrent respected + greenlight answered; `external-send`
category is **never dispatchable** — outreach always terminates at a draft and
the existing approval authority remains the only send path),
`record_swarm_checkpoint` (lease-verified, drives assignment/mission state,
opens escalations, auto-resolves reviews), `route_swarm_reviews`,
`mark_stale_swarm_assignments` (bounded auto-repair: requeue once, then
escalate), `get_swarm_runtime`.
Authenticated (admin): `answer_swarm_escalation`, `cancel_swarm_mission`.
Authenticated (member read): `list_swarm_missions`, `list_swarm_escalations`.

### Worker
`scripts/swarm-orchestrator-worker.mjs` — sourcing-loop-worker conventions
(env kill switch exact-"false", heartbeat, JSON-line logs, exit 78, pure
exported functions). Tick: heartbeat → reap → stale sweep → review routing →
dispatch ready → claim `swarm_assignment` jobs → execute via
`ARIA_SWARM_EXECUTOR_URL` (six-field checkpoint JSON contract; unset ⇒ jobs
fail closed with `executor_not_configured`) → record checkpoint with job lease.
The server-side scheduler hermes never had.

### Routes (requireAdmin/session + zod + rate-limit + prodFailClosed pattern)
`/api/swarm/roster` (GET list, POST seed/update), `/api/swarm/missions`
(GET list, POST create+plan), `/api/swarm/escalations` (GET open, POST answer),
`/api/swarm/runtime` (GET).

### Registration
`tests/db/function-privileges.sql` rows for every new/changed function;
`tests/test-manifest.mjs` digests recomputed; structural plain-node checks
(Docker suites owner-gated as with 0042-0045).

## Non-goals (explicit)
- No LLM decomposition endpoint (assignments supplied by caller/orchestrator).
- No UI. No sequence activation. No new send path of any kind.
- Everything ships DARK: `swarm_enabled` FALSE, roster agents disabled,
  worker kill-switched, executor unset.

## Verification here
Plain-node structural assertions over the SQL + worker + routes (Docker/tsc
unavailable in this sandbox — same degraded banner as Rocks 4-7; Codex
adversarial pass owed 2026-07-23).
