# Engagement report — Swarm orchestration + channel hardening (2026-07-17 → 18)

Authoritative record of what was built, upgraded, adversarially verified, and
deployed. Companion to the fix-by-fix ledger in
[docs/lessons/2026-07-18-swarm-engagement-lessons.md](lessons/2026-07-18-swarm-engagement-lessons.md).

> **Historical record, not current production evidence.** The deployment and
> provider-boundary statements below describe the 2026-07-18 engagement. They
> do not prove the current Fly release, live inbox delivery, or autonomous
> sourcing activation. Production mutation is now restricted to the protected
> [`Deploy Aria Mantu (Fly)` workflow](../.github/workflows/deploy-aria-mantu.yml)
> on protected `main`, following the
> [canonical deployment runbook](../production-readiness/DEPLOYMENT_RUNBOOK.md).

---

## 1. Executive summary

ARIA gained a **multi-agent sourcing swarm** (the orchestration layer it lacked),
modelled on `outsourc-e/hermes-workspace` but rebuilt on ARIA's enforcement
substrate — every safety property hermes only *declares* is now *enforced in
Postgres*. The build was then put through **five rounds of adversarial review by
Codex**, which found real defects across the swarm and the existing WhatsApp/email
channels; all P0/P1 were closed and re-proven. The hardened stack was deployed to
prod (Fly + self-hosted Supabase), and the outreach send path was proven
end-to-end with the real application code.

**Historical status recorded on 2026-07-18:** built · hardened (Codex verdict
SHIP) · deployed (DB + app reported live) · send exercised to a mock provider
boundary. Current release and delivery status must be re-proven through the
protected workflow and current runbooks; a provider credential alone is not
sufficient.

---

## 2. What was built — the swarm (migration 0046 + worker + routes)

The hermes loop — roster → mission brief → assignments → proof-bearing
checkpoints → orchestrator loop → review lane → human escalation inbox — rebuilt
as in-DB authority (force-RLS tables, postgres-only policies, SECURITY DEFINER
RPCs owned by postgres, the 0038 pattern):

- `swarm_agents` (roster, seed = 6 agents, all disabled), `swarm_missions`
  (SwarmBrief status machine, requisition link, source_ref idempotency),
  `swarm_assignments` (ordinal DAG, review + greenlight columns),
  `swarm_checkpoints` (append-only, **lease-bound** — only the live aria_jobs
  lease holder can record, anti-spoofing), `swarm_escalations` (durable
  admin-answered inbox).
- `scripts/swarm-orchestrator-worker.mjs` — the tick scheduler hermes never had
  (kill-switched, stale sweep, review routing, dispatch, execute via a pluggable
  HTTP executor, checkpoint under the same lease, transactional continuation).
- `scripts/swarm-executor-server.mjs` — reference executor: envelope in,
  six-field checkpoint out; any OpenAI-compatible endpoint as the brain.
- `/api/swarm/{roster,missions,escalations,runtime}` — admin/session-gated.
- **Proven end-to-end on a local Supabase stack:** a real mission (scout
  strategy → mechanical review → outreach draft → review) ran the entire state
  machine to COMPLETE with an approved verdict, exercising dispatch, lease-bound
  checkpoints, auto review routing, needs_input escalation + admin answers,
  changes_requested rework, DAG release, retry/backoff, and executor-down
  fail-closed.

Everything ships **DARK**: `sourcing_loop_controls.swarm_enabled` DEFAULT FALSE
in a fail-closed CHECK, roster agents disabled, worker kill-switched, executor
unset fails closed.

---

## 3. What was upgraded — hermes gaps closed + channel hardening

### hermes defects fixed in-DB (declared-but-unenforced → enforced)
- **greenlight** — gated categories are mechanically undispatchable until a
  workspace admin answers the escalation; `external-send` is REJECTED at plan
  time (agents draft only; the outreach approval authority stays the ONLY send
  path — no new send path is minted anywhere).
- **dependsOn DAG** and **maxConcurrentTasks** — enforced at dispatch (hermes
  computed both and enforced neither).
- **checkpoint trust** — lease-bound recording; a checkpoint can't be spoofed.
- **scheduler** — a real tick worker (hermes only looped when a UI called it).
- **notifications** — durable admin-answered escalation rows, not fire-and-forget.

### channel hardening (from an adversarial per-channel audit)
- **WhatsApp go-live blocker:** `enqueue_whatsapp_outbound` required
  `seat.domain_verified` — an email SPF/DKIM flag no WhatsApp seat can set, so
  every WhatsApp send failed `sender-unavailable`. Dropped; sender legitimacy is
  the Meta phone registration on a live Cloud seat. First-contact send proven.
- **Email bounce/complaint suppression (compliance):** synchronous sends live on
  `outreach_ledger`, but the delivery webhook resolved only via
  `messages_outbound` — so a bounce on a sync-sent email never suppressed the
  address. Added an `outreach_ledger` fallback + a durable dedup receipt table.
- **GDPR erased-candidate hardening:** `correlate_inbound_email` and
  `record_candidate_outcome` fail closed on the exact `erased:<uuid>:<uuid>`
  scrub-token structure — no outcome row, no re-materialization.
- **Replay idempotency:** suppression only fires on a genuinely-new delivery
  event (row-count gate + a receipt keyed including `is_permanent`), so a
  replayed webhook can't reverse an admin's suppression expiry, and a
  soft→permanent bounce correction correctly suppresses.
- **Security nits:** cron bearer uses `crypto.timingSafeEqual`; the delivery
  webhook rejects events older than 60 days and future-dated beyond 5-minute
  skew (replay horizon < the 90-day receipt floor); constraint migrations match
  exact column sets so they can't drop an unrelated key.
- **Send testability:** `RESEND_BASE_URL` override lets the full send chain run
  against a mock/staging endpoint.

### deliberate non-changes (owner decisions, documented)
- The per-candidate contact cap (90-day recently-contacted + one-active-ledger
  UNIQUE) blocks free-form replies. This is intentional anti-double-contact
  policy (0022). Whether replies-in-window are exempt is an owner decision that
  needs both layers changed coherently — left as-is (first-contact works;
  conversations are capped).

---

## 4. Adversarial verification — 5 Codex rounds → SHIP

Codex (gpt-5.6-sol) attacked the artifacts read-only, round after round. Every
round found real defects; all P0/P1 closed and re-proven:

1. **0042-0046 swarm authority (22 findings, verdict BLOCK → fixed):** generic
   queue bypassed all dispatch gates (P0); kill-switch not rechecked; lease
   expiry; atomic checkpoint+continuation; forward-only DAG; per-agent
   concurrency lock; checkpoint CAS; review-reject recovery; greenlight
   approve/reject; budget idempotency; sequence activation gate; the missing
   `claim_sequence_step_for_schedule`.
2-5. **Channel fixes (BLOCK → BLOCK → BLOCK → SHIP):** expired-suppression
   reactivation, erased scrub-token fail-closed, exact scrub-token structure,
   suppression replay idempotency via a receipt table, `is_permanent` in the
   dedup key, precise constraint migration, webhook replay horizon (old +
   future). **Final verdict: SHIP.**

Re-proof each round on real Docker Postgres: db-privileges FULL PASS, loop-jobs
41/41 + race, cross-channel-cap, conversation-authority, candidate-erasure; all
contract suites green.

---

## 5. Production deployment (Fly + self-hosted Supabase)

- **DB:** all six hardened migrations applied to `aria-mantu-db` and the
  immutable migration ledger reconciled (the `supabase migration repair`
  pattern — fixes to already-applied migrations either become new migrations or
  a deliberate ledger reconcile). New functions verified live via PostgREST.
- **App:** redeployed from a local mirror (the OneDrive working-tree upload
  hung; a 29 MB app-only mirror deploys cleanly). New routes confirmed serving.
- **Auth root cause:** the deploy driver connected as `postgres` with
  `FLY_PG_PASSWORD`, but the bootstrap owner phase had rotated credentials to the
  `*_TARGET_PASSWORD` values; the driver now discovers a working (role, password).
- **Retired historical mechanism:** the engagement used
  `scripts/prod-apply-swarm-fixes.sh` and `scripts/prod-deploy-app.sh`. Those
  direct-mutation scripts have been removed. Do not restore or run them.
- **Current mechanism:** merge the reviewed release to protected `main`, prove
  CI and CodeQL for that exact SHA, obtain independent recovery and
  `Production` approvals, then dispatch
  [`.github/workflows/deploy-aria-mantu.yml`](../.github/workflows/deploy-aria-mantu.yml)
  with the exact `release_sha`, reviewed `recovery_receipt_sha256`, and
  `activate_sourcing=false` for a dark release. Autonomous sourcing requires
  `activate_sourcing=true`, a separate `Production-Sourcing-Activation`
  approval, the no-contact canary, and the terminal `SOURCING_ACTIVATED`
  receipt. The workflow itself rejects any ref other than protected `main`.

---

## 6. Proof the send works

The **real application send code** (`sendViaProvider`) delivered a correctly
structured email request to a mock provider — 11/11 assertions: status
`sent`/`accepted`,
Bearer key, recipient, subject, plain+HTML body, one-click unsubscribe with the
exact token, RFC Message-ID (bounce key), send-attempt header. Combined with the
proven bounce→suppression, the human-approval gate, and the route returning
`sent` on acceptance, this verifies the source behavior to the provider
boundary. It does not prove a real provider accepted or delivered a message.
The provider endpoint was a mock via `RESEND_BASE_URL`.

The current protected Fly secret contract does not admit the outbound provider
credentials. Do not install one out of band. The reviewed stop condition and
protected release steps are in
[`docs/runbooks/resend-live-send-quickstart.md`](runbooks/resend-live-send-quickstart.md).

---

## 7. Top lessons (full set in the ledger)

- **A migration ledger is immutable by hash — never edit an applied migration.**
  Fixes are new migrations or a deliberate ledger reconcile. Editing applied
  files in place is what forced the reconcile-based deploy.
- **Idempotency must cover side effects, not just the primary write** — gate a
  suppression mutation on the event being genuinely new.
- **A reserved prefix isn't reserved unless enforced** — match the exact
  structure, not the prefix, or a legit value collides.
- **Time-window guards need both bounds** — an age check that only rejects old
  events lets a future-dated one through with negative age.
- **When an agent says it can't see something, believe it** — the swarm's
  reviewers refusing to rubber-stamp exposed real envelope gaps; that was the
  design working.
- **Adversarial review compounds** — five rounds turned "looks fine" into
  correct-by-construction, at low cost.
- **Re-test environment walls every session** — "Docker denied" was a sandbox
  artifact; the DB proof suites ran fine once retested.

---

## 8. Historical closeout and current authority

The 2026-07-18 closeout identified a provider credential as the next step. That
statement is now superseded: production credentials and deployment must pass
the protected secret allowlist, exact-SHA workflow, independent approvals, and
current release gates. The never-auto-send design still keeps the approval and
send action human-controlled.

Use the current
[Resend runbook](runbooks/resend-live-send-quickstart.md) and
[one-candidate proof](runbooks/one-candidate-live-proof.md). Neither document
claims a current live send until the protected release and inbox evidence both
exist for the same exact SHA.
