# Path to Production — the complete remaining plan

Written 2026-07-26 at `5a6e09e`, while the Integrator is on usage limit until **2026-08-01 15:19**.
This document is the full map from the current tree to a production-ready, enterprise-ready app.
It does not change the approved rock plan (PLAN rev 3.5, approved at `meet-r31`); it organizes the
rocks plus everything around them — owner actions, operational work, the deploy path, and the
acceptance test that defines "done".

---

## 0. Definition of done — measurable, not vibes

**Production ready** means all of the following are true and each is proved by a command:

| # | Statement | Proof |
|---|---|---|
| P1 | A fresh clone builds | `npm ci && npm run build` → exit 0 on a machine with no prior `node_modules` |
| P2 | The full gate is green at the deployed SHA | `typecheck && typecheck:tests && lint && test:all && test:database && test:manifest` all exit 0 |
| P3 | A protected release completes end to end | `deploy-fly.sh` runs through `verify_apollo_cleanup_release` without aborting |
| P4 | `/api/ready` returns 200 on the deployed app | `curl` against the live host |
| P5 | The loop runs unattended | ignition cron fires → `email_sync → inbound_classify` advances → shortlist appears, with no browser session involved |
| P6 | An operator can stop it | flipping `kill_switch` halts enqueue, claim, in-flight execution and dispatch — observable via `stage_disabled` outcomes |
| P7 | A crashed worker loses nothing | lease expiry + reaper reclaim, already proved in `loop-jobs-db` |

**Enterprise ready** adds:

| # | Statement | Proof |
|---|---|---|
| E1 | Tenant isolation holds everywhere | RLS + force-RLS on workspace tables; every route resolves workspace server-side (pattern: `swarm/missions/route.ts:122-129`) |
| E2 | No discovery query reaches a provider without the discrimination-proxy policy | shipped at `f5f1e47`+`fdd20cb`; scanner + call-count proofs |
| E3 | Spend cannot run away | per-workspace caps, row-locked, proved un-raceable (shipped `d4ca9af`); sequence send cap same shape (Rock 6) |
| E4 | Nothing sends without a human | hash-keyed `outreach_approvals` + `sequences_enabled` FALSE + shortlist approval door (shipped `1f8dd39`) |
| E5 | GDPR holds for provider-sourced candidates | Rock 5: lawful basis for the Art. 14 population, erasure reaching every store, erasable loop events |
| E6 | Erasure is complete and provable | Rock 5 erasure suite, all identity dimensions, not candidate-id substring |
| E7 | An operator at 3am can see and act | minimum observability package (Phase C) |
| E8 | Restore is proven, not assumed | already enforced per release: receipt-bound snapshot-restore drill in the deploy workflow |

Everything below drives at these fifteen statements.

---

## 1. Where we are — verified, not claimed

Seven commits today, each green (full gate + `next build`) at its own SHA:

| SHA | Delivered |
|---|---|
| `f5f1e47` | Provider-egress chokepoint: every provider call carries a policy-minted clearance; the paid Apify route can no longer skip the discrimination filter |
| `fdd20cb` | Chokepoint hardening: transport-import scan, probe-minting allowlist, honest compliance doc |
| `453301e` | Release verifier admits the `loop` process group — deploys stop aborting AFTER mutating production |
| `886df40` | Loop ignition (machine credential), switchboard enforced at enqueue/claim/pre-handler/dispatch, model client threaded |
| `d4ca9af` | Apify runs persisted server-side, both spend caps row-locked and proved un-raceable |
| `1f8dd39` | Shortlist approval door; 7/7 declared stage transitions have producers (was 2/7) |
| `5a6e09e` | Owner-decision ledger, phantom-dependency finding, Rocks 5+6 briefs validated |

Test counts at `1f8dd39`: 151 suites, 315 tests, 0 failed; `loop-jobs-db` 68 assertions + per-kind
SKIP LOCKED races + cap races; `test:database` green; `next build` green.

**Nothing is pushed or deployed. All of it is local-only.** That fact makes Rock 0 the critical path.

---

## 2. The phases

### Phase A — unblock the pipeline to production (Owner + first Integrator hour)

**A1. Rock 0 — reconcile branch topology.** *Owner-owned. Blocks every deploy.*
`integration/sourcing-enrichment-on-main`: 23 remote-only vs 62 local-only commits, no upstream,
not a fast-forward either way. Options, with my recommendation first:
1. **(Recommended)** From a hydrated checkout off CloudStorage: fetch, `git merge origin/...` (or
   rebase local onto remote if history cleanliness matters more than merge truth), re-run the full
   gate on the merged tree, force-with-lease push. The 23 remote commits end with the shift-43
   baton (2026-07-19) — older than everything local — so conflicts should be limited to relay docs.
2. Force-push local over remote and cherry-pick anything the remote uniquely holds. Simpler, but
   requires positively confirming the 23 commits contain nothing unique first.
Proof: `git status -sb` shows an upstream with 0/0 ahead-behind, and the full gate is green at the
reconciled SHA.
Hazard: git on the OneDrive mount times out on object-heavy operations — do this from a hydrated
clone on local disk (`~/`), as the 2026-07-17 push had to be.

**A2. Phantom dependency.** One line + one guard. Add `three-stdlib` to `package.json`
(`RetroOfficeScene.tsx` imports it; today it resolves only through `@react-three/drei`'s lockfile
entry — upgrade drei and the build dies). Then the durable half: a test asserting every external
import in `src/` and `scripts/` resolves to a DECLARED dependency, so the class dies. The checker
I ran today (value-import walk vs `package.json`) is the shape; it found exactly one hit repo-wide.
Proof: the new assertion fails when `three-stdlib` is removed from `package.json`, passes with it.

**A3. CI budget.** GitHub Actions has not executed since the budget exhausted. Hosted CI is the
only place `npm run build` runs automatically (`ci.yml:75-76`) and the only fresh-`npm ci`
environment — the exact class A2 belongs to. Owner action: restore the budget or point the
existing `.github/workflows/ci.yml` at a runner that has one. Proof: one green hosted run on the
reconciled branch.

### Phase B — the remaining rocks (Integrator lane, briefs ready)

**B1. Rock 5 — the five data-protection blockers.** Brief validated at
`.rocket-fuel/brief-rock-5-dataprotection.md`. Launch first on Aug 1.
1. `aria_jobs` no-PII payload contract made true and enforced at the enqueue boundary
   (handlers read by id via `read_inbound_email_for_loop` / `read_provider_run_for_loop`)
2. Lawful basis enforced for provider-sourced candidates (`rules.ts:84-97` currently gates on
   `provenance === "manual"` only) — **this will block outreach that works today; that is correct**
3. Erasure proceeds from the request binding, not the `workspace_state` blob (`0033:1441-1453`
   returns `not_found` for blob-absent candidates today)
4. `loop_events` erasable via a narrow erasure-only path while staying append-only for everyone
   else (trigger currently raises 42501 unconditionally, owner included)
5. Scrub by the full identity set (email, phone, linkedinUrl, githubUrl, sourceUrl — built at
   `0033:1585-1616`, ignored by the `agent_runs` substring match at `:1861-1880`)
Proofs: full gate + build; structural payload assertion; separate TS test for lawful basis;
disposable-Postgres erasure suite for 3/4/5. New migration = both reviewed-schema controls
re-earned by delta diff (the Visionary's job, procedure proven twice this engagement).

**B2. Rock 6 — sequence engine.** Brief validated at `.rocket-fuel/brief-rock-6-sequences.md`.
- Suppression gate currently matches a column that does not exist (`0045:274-281`) — decide the
  key (candidate-id vs identity), honour `expires_at`, prove a suppressed candidate is refused
- Replace the permanent de-dupe index (`0002:55-58`) with a real 90-day window — index cannot
  express time (`now()` not IMMUTABLE), so the mechanism moves to the scheduling authority
- `max_sequence_sends_per_day` enforced with the `claim_enrichment_budget` row-lock shape,
  concurrency-proved
- Per-seat limits, warmup, exclusions, credits, unified inbox — channel-agnostic, built DARK
- `sequences_enabled` stays FALSE throughout; enabling is a G6 Owner decision

**B3. Rock 7 — LinkedIn channel adapter.** Brief to be written after B2 lands (its surface depends
on B2's engine shape). Scope already locked in the plan: assisted-manual now (draft → human
copy/paste/send, the existing 409 manual-required flow) + a pluggable vendor delivery backend.
OUT, per the standing constraint: own account fleet, proxies, captured member sessions,
detection-avoiding pacing. A vendor backend replaces the fleet without architectural change.
Owner decision feeding this rock: which vendor, if any, to contract.

### Phase C — operational readiness (parallel with B, one bounded brief each)

These are the surviving audit findings that no rock owns. Each is small; none needs a meeting
(they are defects, not scope).

| # | Item | Evidence | Proof when done |
|---|---|---|---|
| C1 | Minimum observability package: structured logs with request ids at the chokepoints (dispatch, loop tick, provider calls), `/api/ready` reasons instead of bare booleans, error counts on `loop_events` | audit: "no metrics/tracing/error reporting; /api/health is a constant" | an operator can answer "what failed and when" from logs alone; readiness names its failing component |
| C2 | Dead-letter visibility: reaper writes a `job.dead` event + an authenticated admin read surface + `requeue_dead_aria_job` reachable from it | reaper dead-letters silently (`0038:605-640` writes nothing) | dead job appears in the surface; requeue works; both asserted |
| C3 | Privilege-gate completeness: the ~35 public routines missing from the allowlist get entries | `legacy-baseline-invariants.sql:15` omissions | `test:db-privileges` enumerates live routines vs allowlist and fails on any gap — mechanical, not hand-maintained |
| C4 | Swarm plane proof: `tests/swarm-orchestration-db.sh` (task #7, spec exists) | 0046's 5 tables/16 routines have zero executed DB proof | suite runs in the database group, green |
| C5 | Producer-map hardening: `assertDeclaredTransitionProducers` verifies the named handler body actually enqueues the kind | shipped assertion reads a hand-maintained map; would not have caught the defect it was written for | assertion fails when a producer's enqueue is removed, without touching the map |
| C6 | Graph refresh-token rotation: persist the rotated `refresh_token` Microsoft returns | `email-oauth.ts:230-235` discards it in memory; connection dies on rotation | refresh cycle test persists the new token |
| C8 | Direct coverage for the provider→candidate mapping path: `candidateRecordsFromProviderResult`, `handleSourcingBatch`, `handleProviderPoll`, `candidatesForShortlist`, `handleEnrichCandidate` | code-review-graph flagged 17 test gaps across three runs; verified 2026-07-28 that all five are unexported and referenced by NO test file, so they are reachable only through the worker tick. `candidateRecordsFromProviderResult` maps untrusted provider JSON into candidate records — a mapping bug there yields silently wrong candidate data, i.e. contacting the wrong person | each function has direct assertions over a realistic provider payload, including malformed/missing fields; export them or test through a seam, do not weaken the module boundary |
| C7 | Job-kind parity: mechanical comparison of `PIPELINE_STAGE_TRANSITIONS` vs the `0038`/`0050` kind whitelist | Rock 1 residual — sets match today by hand | drift in either direction fails a test |

### Phase D — deploy and prove (after A + B1 minimum; full set after B2)

1. **Migrations to prod DB, deliberately.** `0049`, `0050`, `0051`, plus Rock 5/6 migrations —
   applied via the existing staged procedure (owner runs the prod-stage script), never by a deploy
   side effect. The migration-ledger check in `backup.sh:86-90` must pass before and after.
2. **Deploy at the reconciled SHA** through `deploy-fly.sh` — the release now survives the verifier
   thanks to `453301e`. Watch the three-step order: deploy `:1050`, readiness `:1056-1057`,
   verification `:1071`.
3. **Prove P1–P7 live.** Login, ignite one workspace's loop with controls enabled, watch
   `email_sync → inbound_classify → shortlist`, approve the shortlist, see drafts, confirm
   `messages_outbound` stays 0 (sequences dark), flip `kill_switch` and watch it halt.
4. **Owner env decisions at deploy time:** `ARIA_LOOP_KILL_SWITCH=false` for the loop machine (it
   ships dark otherwise), a tool-calling model key for classification (today's machine falls back
   to the deterministic classifier), Apify/provider keys per workspace, `CRON_SECRET` rotation
   policy given the tenant-scoping residual.

### Phase E — G6 and go-live

1. G6 presentation: scorecard, proof outputs, diff stats, meeting trend, residual deductions —
   then the one question, "Ship it?". The Owner's standing consent covers the work, not this gate.
2. Enable sends for ONE pilot workspace: `sequences_enabled=true` via
   `set_sourcing_loop_controls` with a named admin, small caps
   (`max_sequence_sends_per_day` low), warmup on.
3. First real campaign end to end with a human approving shortlist and every send.
4. Widen only after the pilot's outcome data (delivery, bounce, reply) is visible via C1/C2.

---

## 3. Sequencing and dependencies

```
A1 Rock 0 (Owner) ─────────────────────────────┐
A2 phantom dep ── needs Integrator (Aug 1) ─┐   │
A3 CI budget (Owner) ── independent ─┐      │   │
                                     ▼      ▼   ▼
Aug 1: B1 Rock 5 ──► B2 Rock 6 ──► B3 Rock 7    │
              │            │                    │
              └── C1..C7 interleave (one brief each, parallel-safe:
                  different files; NOT parallel with a rock touching
                  the same worker/migration surface)
                                     │
                                     ▼
                       D. migrate + deploy + live proof  (needs A1 done)
                                     │
                                     ▼
                       E. G6 → pilot workspace → widen
```

- A1 and A3 are Owner actions available **now**, before Aug 1. A1 is the critical path to any deploy.
- B1 before B2: Rock 6 schedules contact with candidates; lawful basis must gate first.
- C-items interleave between rocks; each is a bounded 5-part-contract brief.
- Cost note: rocks so far have each taken 1 build + ≤1 fix cycle + 1–2 gate runs (~1 session each).
  B1/B2 are similar-sized; B3 smaller if a vendor is chosen, larger if the vendor abstraction needs
  design rounds.

## 4. Risk register — what bites, and the mitigation already in place

| Risk | Mitigation |
|---|---|
| First-run proof failures (5 of 5 rocks so far) | budgeted: every rock plans for a fix cycle; Level 10 runs every proof under Visionary hands |
| Migration immutability violated again | brief template now front-loads the rule with its history; `backup.sh` check is the backstop; violation this engagement was caught and reverted pre-commit |
| OneDrive resurrections / stale artifacts / Docker pool exhaustion / wrapper exit codes | all four documented with tells in `_relay/2026-07-26-owner-decisions-and-next-shift.md` §hazards |
| Lawful-basis enforcement surprises the Owner mid-campaign | called out here and in the decision ledger — it WILL block today's provider-sourced outreach until bases are recorded |
| Codex usage limit recurs mid-rock | briefs are self-contained; aborted launches consume no round; degraded mode = prep only |
| Schema drift between fingerprint re-earns | the delta procedure (throwaway PG, dump-diff, expect zero removals) is documented in receipts 036/038 and reproven twice |

## 5. The final acceptance test — one script, the whole claim

When D3 passes, encode it as `e2e-production-acceptance.sh` against a workspace in the live app:

1. machine ignition with valid credential → job row; 4 invalid variants → no row
2. loop advances to shortlist with no browser open
3. human approves shortlist → drafts exist; `messages_outbound` = 0
4. kill switch flips → in-flight job fails `stage_disabled`, dispatch drains nothing
5. provider caps: at-cap start refused; N concurrent starts one-below-cap → exactly 1 success
6. erasure request for a provider-sourced candidate → every store scrubbed, `loop_events` redacted,
   ordinary mutation still 42501
7. suppressed candidate refused scheduling; 91-day-old contact schedulable, 89-day not

That script passing on the deployed app **is** the definition of "fully working, production and
enterprise ready". Everything in this plan exists to make each line of it true.

---

*Plan lives with the relay docs so clones see it. The rock ledger (`.rocket-fuel/ROCKS.md`) stays
authoritative for rock status; this document is the map around it. Next action available today:
Owner starts A1 (branch reconciliation) and A3 (CI budget). Next action Aug 1 15:19: launch
`brief-rock-5-dataprotection.md`.*
