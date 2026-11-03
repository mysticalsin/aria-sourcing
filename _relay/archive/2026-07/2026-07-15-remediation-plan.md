---
project: MSourcing / ARIA
doc: remediation plan
prepared: 2026-07-15
prepared_by: claude-sonnet-5 (relay reconciliation pass)
basis: read-only git facts (log/show/branch/merge-base) against deploy/fly-github-actions @ d2040b5 and local main @ 0a214a4
---

# 2026-07-15 Remediation Plan

Four tracks. Effort is S (hours), M (a day or two), L (multi-day / needs its own
plan). Every item below was checked against actual git history before being
listed here — see `_relay/HANDOFF.md`'s shift-42 (2026-07-14) entry, the last
one it contains, and the dated note at the top of `_relay/codex-findings.md`
for the verification method.

## TRACK A — DO-NOW CODE (on main, after reconciliation)

1. **[L] Reconcile `deploy/fly-github-actions` onto `main` (or vice versa).**
   Merge-base is `3ea0050`; neither branch is an ancestor of the other. `main`
   has migrations 0024-0033 and 11 absorbed Codex fix branches this branch
   lacks; this branch has the Apify sourcing work (`e431981`), the in-progress
   enrichment orchestrator, and its own supply-chain/login/auth commits
   (`f518572`, `b75f93c`, `b1fc503`, `9af93c0`, `8b460c8`, `ea2aea7`,
   `d2040b5`) on top of the shared `c6c7a0a` base. No deploy should ship from
   either branch alone. Do this first — every other Track A item is easier to
   land once there is one canonical tip.
2. **[M] Close main's NO-GO #1 — live calendar creation lacks durable booking
   authority.** `src/app/api/calendar/event/route.ts` creates a real
   provider-side calendar event but persists no durable booking
   receipt/idempotency record of its own; a timeout or duplicate call after
   the provider accepts has no reconciliation path. Port the same
   ambiguous-outcome doctrine already proven for email (migration 0022) and
   WhatsApp (migration 0023): a durable row written before the provider call,
   with a non-retryable "ambiguous" state on unknown outcomes.
3. **[M] Close main's NO-GO #2 — generated reports contain unverified fixed
   intelligence.** `src/lib/mock-ai.ts:1191` hardcodes `costPerHire: 4200`
   into what the UI presents as a real report. Either compute it from actual
   workspace data or clearly label it as a synthetic/estimated placeholder
   distinct from live metrics; audit `mock-ai.ts` for sibling hardcoded
   constants presented the same way.
4. **[S] Node version alignment.** `ci.yml` explicitly pins Node `"22"` twice
   (verified); `.github/workflows/codeql.yml` has **no** `actions/setup-node`
   step at all and runs Autobuild on whatever Node the `ubuntu-latest` runner
   ships by default — not guaranteed to match `package.json`'s
   `engines: "22.x"`. Add an explicit pinned `actions/setup-node@<sha>` with
   `node-version: "22"` before the Autobuild step. (`deploy-aria-mantu.yml`
   runs no npm/node steps directly — Docker-only — so it is not affected.)
5. **[S] Docs-truth reconciliation.** A `docs-truth` contract/concept exists
   on `main` (`CONTRIBUTING.md`, several `_relay/plans/*`); `STATUS.md` does
   not exist in this branch's tree at all (`git show d2040b5:STATUS.md` →
   not found). After the Track A1 merge, migration count (23→33), file count,
   and any command-count claims in README/STATUS/RUNBOOK will shift — re-run
   whichever `docs-truth` check is canonical once against the merged tree and
   fix any stale numbers in a single pass, not per-branch.
6. **[S] Admin-password-floor regression.** `ea2aea7` lowered
   `scripts/provision-first-admin.sh`'s `ADMIN_PASSWORD` minimum from 24 to 5
   characters (verified via `git show ea2aea7`). This is a real weakening,
   not a hardening — 5 characters is too low for a first-admin
   production-provisioning credential. Confirm with Tony whether 5 was
   intentional (e.g., deliberate for a non-network-exposed one-time bootstrap
   script) or raise it back to a defensible minimum (12+).
7. **[M] Stored AgentSpec does not control a run** (`src/app/api/agents/run/route.ts:32`,
   open in `codex-findings.md`). Require and authorize a stored spec in live
   mode; build graph state from it instead of caller-supplied JSON.
8. **[M] Agent ownership is workspace-wide, not per-user** (migration
   `0007_agent_runtime.sql:152`, open). Add owner-or-admin RLS plus API
   filters; add negative two-user/two-workspace tests.
9. **[M] Live backend failure silently becomes demo/empty state** (`src/lib/supabase/workspace.ts`,
   two related open findings). An earlier candidate (`1b0fac8`) was
   independently rejected: adversarial race gate 2/5, mutation/conflict gate
   0/6 (conflict+failed-reload clears the newest pending snapshot; null
   conflict rows fabricate empty state; stale in-flight saves override retry
   hydration; four side effects run before the central commit gate). Redo
   with those four concrete defects fixed, not from a clean slate.
10. **[M] UI seats cannot become live normalized seats** (`src/lib/store.ts:4274`,
    open). Make a role-checked server API and the normalized `agent_seats`
    table authoritative in live mode; keep local-only seats demo-scoped.
11. **[S] Repository hygiene.** A real commit (`66e96e8`, on a Codex branch
    not yet merged anywhere canonical) removes ~179MB of tracked machine
    binaries and `.rocket-fuel` logs. Port the equivalent change onto
    whichever branch becomes canonical after Track A1.

## TRACK B — OWNER-GATED OPS (exact action per item)

1. **[S] Rotate/revoke the exposed Fly deploy token**
   (`_relay/incidents/2026-07-11-fly-deploy-token-exposure.md` — still
   active/unrotated). `fly tokens list -a aria-mantu-app` to find it, then
   revoke via the Fly dashboard (Tokens) or `fly auth logout` on any session
   holding it; issue a new least-privilege deploy token with
   `fly tokens create deploy -a aria-mantu-app --json`; update the GitHub
   secret; review Fly activity/audit log for unauthorized use.
2. **[S] Delete `ARIA_DEPLOY_BUNDLE`; install per-secret Production env vars.**
   `gh secret delete ARIA_DEPLOY_BUNDLE --repo <org>/<repo>`, then
   `gh secret set <NAME> --env Production --repo <org>/<repo>` for each name
   in `production-readiness/.fly-secrets.example`.
3. **[M] Branch protection + workflow-on-default + `FLY_REGISTRY_TOKEN`.**
   Merge `.github/workflows/deploy-aria-mantu.yml` onto the repo's default
   branch (currently absent there); `gh api -X PUT repos/<org>/<repo>/branches/<default>/protection --input protection.json`
   requiring exact-SHA CI + CodeQL status checks and disallowing
   administrator bypass/self-review; `gh secret set FLY_REGISTRY_TOKEN --env Production`;
   re-enable the workflow (`gh workflow enable "Deploy Aria Mantu (Fly)"`).
4. **[M] `aria_db_data` recovery receipt.** `fly volumes list -a aria-mantu-db`
   → `fly volumes snapshots create <vol-id> -a aria-mantu-db`; restore the
   snapshot into a disposable machine/clone; run `scripts/restore-drill.sh`
   against it; record the resulting receipt hash as release evidence bound
   to the release SHA (per the already-built release-acceptance-binding
   logic in `c6c7a0a`).
5. **[S] `dev_fusion` Apify actor approval.** One-click "Rent actor" /
   approve action in the Apify Console under the `dev_fusion` actor listing
   — owner login required; unblocks only that lane of the enrichment
   orchestrator.
6. **[S] ElevenLabs key rotation** (open in `codex-findings.md` — key
   observed in an internal tool result during a prior audit). Rotate at the
   ElevenLabs dashboard; update `ELEVENLABS_API_KEY` in local `.env.local`
   and in GitHub/Fly secrets; confirm the old key is revoked.
7. **[L] Flip repo visibility to private** — `gh repo edit <org>/<repo> --visibility private`.
   Final gate only, after live acceptance passes (Tony's explicit 2026-07-11
   decision — do not do this early).

## TRACK C — BLOCKED

- **Repo-org plan (shift 40).** Plan already written:
  `_relay/2026-07-14-aria-senior-developer-organization-plan.md`
  (`status: ready-blocked-on-active-shift-40`). Explicitly targets "the clean
  local `main` tip only after shift 40 closes" — do not start until shift 40
  closes and Track A1's reconciliation lands.
- **Flowise sidecar.** No active-work evidence found in this reconciliation
  pass; remains a longer-term integration item, blocked behind the current
  campaign/deploy critical path.
- **Durable scheduler.** The enrichment-orchestrator design
  (`docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md`) explicitly
  names this as a v2 seam: a durable server job mirroring the existing
  `agent_runs` state machine, `claim_and_record` lease pattern, and
  `dispatchDue` drainer, for true background/batch scale. Not yet built;
  v1 batch enrichment is client-orchestrated by design.

## TRACK D — ALREADY DONE (reconciliation only)

| Item | Commit(s) | Note |
|---|---|---|
| Email daily-cap serialization | `d29cd40` (migration 0021) | per-seat `FOR UPDATE` lock |
| Email provider ambiguity | `aa60671` (migration 0022) | `send_attempt_id` + non-retryable `ambiguous` state |
| Inbound conversation identity | `318f552` (migration 0023) | `agent_conversations` + claim-bound resolver RPC |
| Recovery-hardening bundle (SSRF/DNS pinning, Databricks admin-only authority, RPC PUBLIC-execute revoke, MCP production denial, default-privilege reset, image-scan bound to deployed artifact, Fly volume mount fix, legacy-cluster remount guard, optional-role first-boot fix, shared-credential substitution fix, DB init log-secrecy, cross-owner migration split, 3-custom-image promotion chain, immutable-tag promotion bug, image-config-scanner flag, CycloneDX schema validation, Gitleaks false-positive scoping, aria-mantu-db first-boot secret trap, entrypoint dotfile guard, ambiguous admin-mutation compensation, Fly secret-rotation staging, release-acceptance evidence binding, workflow-rerun approval bypass, production-UI fabricated seed state) | `c6c7a0a` | one consolidated commit; verified via `git log -S` against ~18 individual findings |
| CI supply-chain gates green | `f518572` / `b75f93c` / `b1fc503` / `9af93c0` | exact-SHA CI + CodeQL green recorded in `3ea0050` |
| Recovery schema pins (0021-0023 invariants/fingerprint) | `8b460c8` | narrower than the full backup/restore-manifest finding — see below |
| Login brand + admin-password-floor change | `ea2aea7` | brand fix is done; password-floor change is a **regression**, tracked as Track A6, not "done" |
| Auth edge resilience (retrying fetch in browser Supabase client) | `d2040b5` | current branch HEAD |
| Apify LinkedIn sourcing shipped | `e431981` | pushed to `origin/feat/apify-linkedin-sourcing`, 5 real candidates verified live |

Findings fixed only on `main` (not yet on this branch — verified via
`git branch --contains`): agent-memory ownership (`166e752`, `a469aee`,
`8312111`), autopilot contract (`218f6cb`, `8312111`), SMS unknown-outcome
retry (`2171868`), cross-channel cap race (`adbc7fc`, `8312111`), and the
full backup/recovery-manifest allowlist fix (`8312111` — this branch's
`8b460c8` only updated the reviewed-schema invariants/fingerprint pin, not
`scripts/backup.sh` / `scripts/restore-drill.sh` /
`docker/bootstrap/run.fly.sh` / `scripts/test-db-privileges.sh`). These
become "done" on the canonical branch automatically once Track A1 lands.

## RECOMMENDED SEQUENCE

1. **Reconcile** `deploy/fly-github-actions` ↔ `main` (Track A1) — produces
   one canonical tip carrying migrations 0024-0033, the Apify/enrichment
   work, and every supply-chain/login/auth commit from both sides.
2. **Track A on the reconciled tip** — close both of main's NO-GO findings,
   fix the Node-version gap, reconcile docs-truth, resolve the
   admin-password-floor regression, and close the remaining genuinely-open
   product findings (7-11 above) until the canonical branch's own relay
   tree is fully GO.
3. **Track B ops** (token rotate, secret cleanup, branch protection,
   recovery receipt, `dev_fusion` approval) — owner-only; largely runs in
   parallel with step 2.
4. **Fly deploy dispatch** — exact-SHA release, receipt hash attached — only
   once steps 2 and 3 are both green.
5. **Live acceptance** — DB/Auth 200, two-restart survival, `/api/ready` 200,
   running-digest match, admin login, synthetic zero-send campaign.
6. **Flip repo to private** (Track B7) — final step, after live acceptance
   passes, not before.
