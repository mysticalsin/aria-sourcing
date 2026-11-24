---
project: ARIA / MSourcing
agent: claude-code (Opus 5, 1M)
updated: 2026-07-25
status: plan-awaiting-owner-approval
scope: the blockers PLAN.md rev 7 does not cover
depends_on: _relay/2026-07-24-state-of-the-union.md
---

# Next engagement — the gaps the approved plan does not cover

`.rocket-fuel/PLAN.md` rev 7 is APPROVED and its seven rocks stand. This document covers only
what rev 7 **cannot** absorb: two rocks whose premise the audit falsified, and a whole subsystem
that rev 7 never mentions because it was built after the plan was written.

Nothing here is a scope change to rev 7. It is the list of things that must be planned
separately, with the reason each one is outside it.

---

## A. Rock 4 has a defective premise — reopen it before building

Rock 4 says: remove the 5-character password floor, mailer auto-confirm, email-domain auto-join
and first-user auto-admin.

Two of those four are **positively asserted as correct** by a currently-green database contract:
`tests/db/ensure-workspace-authority.sql:117-259` proves domain auto-join and first-user
auto-admin behave exactly as `supabase/migrations/0018_first_admin.sql:34-56` implements them.
`fly.auth.toml:15,22` carries the other two.

So Rock 4 as written cannot be satisfied without amending a green contract, and its Proof clause
("a new test asserting each of the four defaults is rejected or gated when the deployment is
live-mode") would sit directly opposite an existing passing assertion. That is a plan defect, and
it is exactly the class `IMPROVE.md` records three prior recurrences of: a rock whose proof does
not cover, or actively contradicts, what the code asserts.

**Required before any build:** decide whether `0018`'s behaviour is the intended contract or a
production-unsafe default. If the latter, the contract is amended in the same rock and the plan
must say so. If the former, the rock shrinks to the two `fly.auth.toml` settings and the
readiness domain stays open with a named reason. Either way, rev 7 reopens.

Mitigation meanwhile: `GOTRUE_DISABLE_SIGNUP=true` is the only thing standing between these
defaults and an open tenant. That is one env var, and nothing asserts it.

## B. The swarm plane — 2122 lines of authority outside every gate

Rev 7 does not mention the swarm plane at all. It was built as Rock 8 of the previous engagement
and shipped DARK. The audit's finding is blunt: **it has zero tests and no scheduler.**

- No `tests/swarm-*.mts` exists. No swarm id appears in `tests/test-manifest.mjs`. So migration
  `0046` — roster, missions, assignments, lease-bound checkpoints, escalations, 18 RPCs — plus
  `scripts/swarm-orchestrator-worker.mjs`, `scripts/swarm-executor-server.mjs` and four
  `/api/swarm` routes are entirely outside the gate that is otherwise green.
- `fly.app.toml:9-13` declares `web`, `cleanup`, `framework_heartbeat` and `loop`. There is no
  swarm process and no npm script, so nothing can ever tick it in production.
- `0042`–`0046` authority is proven only by regex over migration text
  (`tests/loop-authority-contract.mts`), never by executed SQL.

The in-DB safety design is genuinely strong — greenlight gates, DAG readiness, per-agent
concurrency, append-only proof ledger, and plan-time rejection of the `external-send` category so
agent output always terminates at a draft. That is the reason this is worth finishing rather than
deleting. But three defects make it unsafe to schedule as-is:

1. **A cancelled dependency deadlocks its dependents silently** — no escalation, mission stuck in
   `executing` forever.
2. **`in_progress`/handoff continuations are unbounded** — one stuck agent burns LLM spend
   forever, with no cap and no escalation.
3. **All four `/api/swarm` mutation handlers bypass the repo's own same-origin/content-type
   request boundary.**

**Order matters and it is the opposite of the obvious one: tests before scheduler.** Enabling a
scheduler on untested authority converts a dormant subsystem into an active one that can deadlock
and spend without bound. Sequence: DB suite for `0046` executed against real Postgres → the three
defects fixed → registration in the test manifest → *then* a Fly process group.

## C. The sourcing plane cannot go headless without moving code out of the browser

Rock 2 says "make the sourcing product work headless" and its Proof asks for a worker that claims
and completes a sourcing job kind end to end. The audit found the obstacle is deeper than wiring:

- `scripts/sourcing-loop-worker.mjs:35` — `HANDLER_KINDS = Object.freeze([])`. The queue has no
  consumer at all.
- The only live sourcing authority route is **browser-bound**; a service-role caller cannot reach
  it.
- **Scoring, dedupe and the candidate commit all execute in the browser store.** The pipeline's
  decision-making lives client-side.

So Rock 2 is not "register a handler". It is "move scoring, dedupe and commit server-side, then
register a handler". That is a materially larger rock than rev 7 scoped, and it should be split
before anyone starts, or it will close PARTIAL.

Related and independently shippable:
- The prohibited-criteria gate is bypassed by **both** vendor-API adapters (Apify, Apollo). The
  direct Apify adapter reaches a paid provider with raw queries, schools and names. A test must
  assert the provider mock is **never invoked** — a 422 status assertion does not prove the call
  was not made.
- `0044`'s enrichment budget claim/settle/release RPCs have **no caller**; tenant spend is still
  clamped per request from a client-supplied hint. Rock 3 covers this, and its premise holds.
- An activated outreach sequence can never advance past its first touch.

## D. Readiness can never go green — an owner decision, not a code task

`/api/ready` unconditionally requires `agentFrameworks` in production
(`src/app/api/ready/route.ts:23-24`, `src/lib/readiness.ts:55,64`), and that flag demands two
private DeerFlow/Flowise adapters proving pinned source commits and image digests that exist only
as source under `infra/agent-frameworks/`. **Nothing in this repo can satisfy it.**

Meanwhile Fly routes traffic on shallow `/api/health` by explicit decision
(`fly.app.toml:51-67`), so the deep gate is advisory and cannot block a bad release.

Two coherent options, and this is the owner's call:
- **Deploy the sidecars.** Readiness becomes meaningful and can gate traffic.
- **Descope the flag for v1.** `agentFrameworksRequired` becomes false in production, readiness
  can reach 200, and Fly's health check moves to `/api/ready` so a bad release actually fails.

The current state is the worst of both: a deep probe that always fails, wired to nothing.

## E. Release topology must be reconciled before anything ships

Local and remote integration histories are **different commit graphs**. Roughly 21 commits,
including all of the release hardening, exist only locally — earlier pushes went through the
GitHub REST API rather than `git push`, because the git object store is mmap-unreadable on the
OneDrive mount. The default branch is `vercel-demo`; `main` and the integration branch are
separate histories.

Nothing was pushed this session, deliberately. Reconciling this is a deliberate act with a real
chance of losing history, and it needs to happen from a hydrated checkout off CloudStorage, not
from here.

Also open: `supabase/rollbacks/` holds exactly one file against 47 applied migrations.

---

## Sequencing recommendation

1. **A** (reopen Rock 4) — costs a decision, unblocks a rock, no code.
2. **D** (readiness decision) — costs a decision, makes the deep gate mean something.
3. **H1–H3** from the Hermes plan — already landed H1 and the H3 bearer half; H2 remains.
4. **B** (swarm tests, then the three defects, then a scheduler).
5. **C** split into "move scoring/dedupe/commit server-side" and "register the handler".
6. **E** (topology) before any deploy.

## Non-goals

Unchanged from `PLAN.md` rev 7's staged list — HA Postgres, SSO/SCIM/MFA, KMS/HSM, SIEM,
penetration test, `workspace_state` normalization, API versioning across ~60 routes, and the
observability *operations* layer. All still owner-gated on procurement or multi-week refactors.
