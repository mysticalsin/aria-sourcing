# R8 — Swarm Orchestration Authority (hermes-workspace gaps → ARIA)

Date: 2026-07-17. Status: BUILT, DARK, DEGRADED (same banner as 0042-0045 —
Codex adversarial pass owed 2026-07-23 before anything is enabled).

## What this is

Owner asked: study `outsourc-e/hermes-workspace` (multi-agent "Swarm Mode"),
implement its gaps in ARIA as an upgrade. Mapped both sides with an 8-reader
workflow (659k tokens), then rebuilt hermes's orchestration shape on ARIA's
enforcement substrate.

Hermes's loop: roster → mission brief → per-agent assignments → six-field
proof checkpoints (STATE/FILES_CHANGED/COMMANDS_RUN/RESULT/BLOCKER/NEXT_ACTION)
→ orchestrator auto-continue → review lane → greenlight gate → human sees only
judgment-worthy items.

Hermes's defects (verified in its server code): greenlight declared but never
enforced; dependsOn DAG computed but dispatch is parallel Promise.all;
maxConcurrentTasks ignored; checkpoints trusted from any caller; no server-side
scheduler; mission ledger without GC; fire-and-forget tmux notifications.

## What shipped (every hermes defect fixed in-DB)

* `supabase/migrations/0046_swarm_orchestration_authority.sql`
  - `swarm_agents` roster (seed = 6 agents: orchestrator/scout/enricher/
    drafter/reviewer/ops, ALL disabled), `swarm_missions` (SwarmBrief status
    machine, requisition link, source_ref idempotency), `swarm_assignments`
    (ordinal-DAG, review + greenlight columns), `swarm_checkpoints`
    (append-only, LEASE-BOUND: only the live aria_jobs lease holder can
    record — anti-spoofing), `swarm_escalations` (durable human inbox; one
    open row per assignment×kind).
  - `sourcing_loop_controls.swarm_enabled` DEFAULT FALSE folded into the
    fail-closed CHECK (recreated named: sourcing_loop_controls_fail_closed);
    `set_sourcing_loop_controls` now 9-param (old 8-param dropped; zero app
    callers existed; tests/loop-jobs-db.sh call sites updated).
  - `aria_jobs` kind CHECK + `enqueue_aria_job` gain 'swarm_assignment'.
  - RPCs: seed_swarm_roster / set_swarm_agent / answer_swarm_escalation /
    cancel_swarm_mission / list_* (authenticated, in-DB admin gates);
    create_swarm_mission / plan_swarm_assignments /
    dispatch_ready_swarm_assignments / record_swarm_checkpoint /
    route_swarm_reviews / mark_stale_swarm_assignments / get_swarm_runtime /
    get_swarm_assignment_envelope (service_role); swarm_recompute_mission_status
    (postgres-only internal).
  - NEVER-AUTO-SEND: plan_swarm_assignments RAISES on greenlight_category
    'external-send' — outreach is planned as a drafting task only; the
    outreach approval authority stays the only send path. No new send path.
  - Bounded auto-repair: stale assignments requeue ≤3 dispatch attempts,
    then block + escalate. Greenlit categories (sequence-activate,
    budget-change, erasure, destructive, credential-change) undispatchable
    until an admin answers the escalation row.
* `scripts/swarm-orchestrator-worker.mjs` — the server-side scheduler hermes
  lacked. sourcing-loop-worker conventions (env kill switch exact-"false",
  heartbeat, JSON-line logs, exit 78). Tick: reap → stale sweep → review
  routing → dispatch → claim swarm_assignment jobs → execute via
  ARIA_SWARM_EXECUTOR_URL (pluggable HTTP executor: envelope in, checkpoint
  out; unset ⇒ jobs fail closed 'executor_not_configured') → checkpoint under
  the SAME lease → complete with transactional continuation enqueue.
* Routes: `/api/swarm/roster` `/api/swarm/missions` `/api/swarm/escalations`
  `/api/swarm/runtime` (requireAdmin / session-JWT RPCs, zod, rate limits,
  503-fail-closed without Supabase).
* Registration: tests/db/function-privileges.sql (+17 entries, controls
  signature updated); manifest untouched (no new suites) — contract 7/7,
  function-privileges-contract 21/21, docs-truth 45/45 all pass here.
* Plan: docs/superpowers/plans/2026-07-17-swarm-orchestration-authority.md.

## Verification here (sandbox: no Docker, no tsc)

- Migration: 73/73 comment-stripped structural assertions (lockdown per table,
  lease-bound checkpoint, dispatch gates, grant matrix, external-send raise).
- Worker: node --check + 12/12 pure-function + 6-scenario behavioral harness
  (fake RPC client: fail-closed executor, lease-bound record, deterministic
  continuation idempotency keys, kill-switch tick makes ZERO calls).
- Runnable repo gates: test-manifest-contract, function-privileges-contract,
  docs-truth — all green.

## Owner gates (unchanged discipline)

1. Codex adversarial pass (2026-07-23) over 0042-0046 + this worker.
2. Docker proof-run: loop-jobs-db.sh (now 9-param) + a swarm-db suite to be
   written under Codex; typecheck in a hydrated checkout.
3. Apply migrations deliberately; only then consider enabling: seed roster →
   enable agents → swarm_enabled → executor URL. Every step admin-attributed.
4. Executor endpoint choice (Dust / Flowise / Claude runner) is an owner
   decision — the worker only speaks the checkpoint contract to a URL you set.
