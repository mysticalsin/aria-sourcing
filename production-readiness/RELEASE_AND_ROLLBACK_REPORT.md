# Release & Rollback Report — MSourcing (hermes-sourcing)

**Area:** Phase 8 — Release process, deploy approval, environment-scoped secrets, rollback / canary, emergency patch
**Reviewer role:** DevSecOps / Pipeline Engineer
**Date:** 2026-06-27
**Repo:** `/Users/tony/.../TEST/MSourcing` — branch `main`, working tree DIRTY (audited as-is)
**Gate mapped:** Gate 8 — CI/CD / supply chain
**Companion files:** `CICD_REVIEW.md`, `SUPPLY_CHAIN_SECURITY_REPORT.md`
**Builds on (still valid):** `DEPLOYMENT_RUNBOOK.md`, `ROLLBACK_RUNBOOK.md`, `DEPLOY_CHECKLIST.md`, `INCIDENT_RESPONSE_RUNBOOK.md`

> This report assesses the **release/rollback controls from a pipeline-governance angle**.
> The step-by-step operational procedures already documented in `DEPLOYMENT_RUNBOOK.md`,
> `ROLLBACK_RUNBOOK.md` and `DEPLOY_CHECKLIST.md` are **reviewed and largely sound** — they
> are referenced here, not duplicated. What's missing is the *enforcement* layer
> (approval gates, environment protection, verified rollback drill).

---

## Executive summary

The **rollback story is the strongest part of Gate 8**: because the target platform is
Vercel, every production deployment is retained and a previous one can be promoted in
~30 seconds with no rebuild — and this is correctly documented (`ROLLBACK_RUNBOOK.md`
Step 1). The DB-migration reverse procedure, env-var rollback, and Supabase PITR path are
all written down. That gives a credible **code-rollback RTO of < 5 minutes** *on paper*.

The **release story is weak on governance**:
- **No prod-deploy approval gate** — deploy is implicit via Vercel git integration or
  `vercel --prod`; there is no GitHub Environment, required reviewer, or four-eyes control.
- **No canary / staged rollout** — Vercel promotes a full production deployment at once
  (no traffic-split / progressive delivery configured in-repo).
- **The deploy path itself is currently inert** — there is **no git remote**, so
  `git push origin main → Vercel auto-build` (the documented primary path) cannot fire
  today, and CI cannot gate it (see `CICD_REVIEW.md`).
- **Environment-scoped secrets are UNKNOWN** — secrets live in the Vercel project dashboard
  (not in repo); their environment scoping, encryption, and least-privilege cannot be
  verified without Vercel access. No repo evidence either way.
- **No rollback/restore drill evidence** — runbooks exist; there is **no record any rollback
  or PITR restore was ever rehearsed** (`UNKNOWN_ITEMS.md` confirms). Untested = not PASS.
- **Emergency-patch path exists but is uncontrolled** — `vercel --prod` hotfix bypasses CI
  entirely with no compensating review/post-hoc check documented.

Positive on secret hygiene: **CI injects no application secrets into PR build/test steps**
(only `GITHUB_TOKEN` for gitleaks), so there is no secret-in-PR-build / fork-exfiltration
exposure in the current workflow.

**Release & rollback verdict: FAIL** — open HIGH (no prod-deploy approval gate; deploy path
inert with no remote) plus rollback drill UNVERIFIED. Environment-secret scoping and
Vercel deploy-protection are **UNKNOWN — blocked on Vercel/GitHub access**.

---

## 1. Release / deploy pipeline

| Control | Status | Evidence |
|---|---|---|
| Automated deploy on merge | Inert | `DEPLOYMENT_RUNBOOK.md:117` (`git push origin main`); **no git remote** → cannot fire |
| CI green required before deploy | **FAIL** | no remote → CI never runs; no required status check |
| Prod-deploy approval / four-eyes | **FAIL** | no GitHub Environment, no deploy workflow (`grep -ril deploy .github/workflows` → none) |
| Manual deploy path | Documented | `vercel --prod` (`DEPLOYMENT_RUNBOOK.md:128`) |
| Staged / canary rollout | **MISSING** | no traffic-split config; Vercel full-promote |
| Post-deploy smoke check | Documented (manual) | `DEPLOYMENT_RUNBOOK.md` §5 (auth, routes, CSP, key vault, outreach gate) |
| DB migration ordering | Documented | `DEPLOYMENT_RUNBOOK.md` §2; `DEPLOY_CHECKLIST.md` Phase 2 |
| Deploy notification | Documented | `DEPLOYMENT_RUNBOOK.md` §6 |

## 2. Rollback

| Control | Status | Evidence |
|---|---|---|
| Code rollback (instant) | Documented & credible | `ROLLBACK_RUNBOOK.md` Step 1 — Vercel promote previous deploy (~30s) |
| Code rollback RTO target | < 5 min (claimed) | `ROLLBACK_RUNBOOK.md:19` — **unverified by drill** |
| DB migration rollback | Documented (manual, destructive) | `ROLLBACK_RUNBOOK.md` Step 2 (reverse 0004→0001) |
| Env-var rollback | Documented | `ROLLBACK_RUNBOOK.md` Step 3 |
| PITR restore | Documented (requires Supabase Pro) | `ROLLBACK_RUNBOOK.md` §PITR |
| Rollback drill performed | **UNKNOWN/FAIL** | no evidence; `UNKNOWN_ITEMS.md` lists restore/rollback drill as not run |
| Backup/restore scripts | Present (DR area) | `scripts/backup.sh`, `scripts/restore-drill.sh` (assessed under Gate 12) |

## 3. Secrets in the release pipeline

| Control | Status | Evidence |
|---|---|---|
| Secrets absent from CI PR builds/logs | **PASS** | `ci.yml` injects no app secrets; only `GITHUB_TOKEN` for gitleaks |
| Fork-PR secret exposure | Low | default GitHub behavior; no secrets referenced in build/test steps |
| Env-scoped secrets (prod vs preview) | **UNKNOWN** | secrets in Vercel dashboard, not in repo — blocked on Vercel access |
| Service-role key server-only | Documented | `DEPLOY_CHECKLIST.md` Phase 6 (must be Vercel "Secret", absent from `NEXT_PUBLIC_*`) — not tool-verified |
| Secret rotation process | **MISSING** | no documented rotation cadence for `SUPABASE_SERVICE_ROLE_KEY`/`HERMES_API_KEY`/OAuth secrets |

---

## Findings

## [HIGH] No production-deploy approval gate or environment protection
- **Area / Affected:** no deploy/release workflow; no GitHub Environment; `DEPLOYMENT_RUNBOOK.md` §4
- **Description:** Production releases happen via Vercel git integration or a direct `vercel --prod`. There is no required reviewer, no GitHub `production` Environment with protection rules, no manual approval step, and no audit record of who authorized a given deploy.
- **Impact:** Single-actor (or compromised-credential) path to a prod environment processing candidate PII and OAuth mailbox tokens; no four-eyes; no approval audit trail.
- **Likelihood:** Medium-High.
- **Reproduction:** `grep -ril deploy .github/workflows` → none; no environment config in repo.
- **Evidence:** filesystem; `DEPLOYMENT_RUNBOOK.md:115-131`.
- **Recommended fix:** Add a GitHub `production` Environment with required reviewers + branch restriction (or Vercel deployment protection requiring a green GitHub check + manual promote). Record approver + commit SHA in the deploy log.
- **Tests to add:** Release-gate check that each prod deploy has an approval record + the source CI run was green.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** High until an approval gate exists.

## [HIGH] Deploy path is inert — no git remote, CI cannot gate releases
- **Area / Affected:** git config (no remote); `DEPLOYMENT_RUNBOOK.md` Option A
- **Description:** The documented primary deploy flow (`git push origin main` → Vercel auto-build) and all GitHub-side gates depend on a remote that does not exist. Today, releases can only happen via local `vercel --prod`, which bypasses CI/CodeQL/gitleaks/audit entirely.
- **Impact:** No automated gate can stand between code and production; the only working deploy path is the ungated CLI one.
- **Likelihood:** Certain (current state).
- **Reproduction:** `git remote -v` → empty.
- **Evidence:** command output; cross-ref `CICD_REVIEW.md` finding 1.
- **Recommended fix:** Provision the remote + Vercel git integration; require green CI before the production promote; deprecate ungated `vercel --prod` except as a documented break-glass (see emergency-patch finding).
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** High.

## [HIGH] Rollback and restore procedures are documented but never drilled
- **Area / Affected:** `ROLLBACK_RUNBOOK.md` (all steps); `scripts/restore-drill.sh`; `UNKNOWN_ITEMS.md`
- **Description:** The Vercel rollback, DB reverse-migration, env-var rollback, and Supabase PITR procedures are written down and plausible, but there is **no evidence any of them has been executed**. The < 5-minute RTO and the PITR RTO (~15-30 min) are claims, not measured results. A `restore-drill.sh` exists but no drill output/log is recorded.
- **Impact:** Under a real incident the procedures may fail or be slower than claimed (destructive DB steps, PITR project-swap requiring env updates). Per operating rules, untested = not PASS.
- **Likelihood:** Medium.
- **Reproduction:** no drill log in repo; `UNKNOWN_ITEMS.md` lists restore/rollback drill as not run.
- **Evidence:** `ROLLBACK_RUNBOOK.md`; `UNKNOWN_ITEMS.md`; `scripts/restore-drill.sh` present, no output captured.
- **Recommended fix:** Execute a rollback drill (promote a prior Vercel deploy on a staging project) and a Supabase PITR restore drill; record timings and capture evidence; convert the claimed RTO/RPO into measured numbers.
- **Tests to add:** Scheduled quarterly drill with a captured timing log.
- **Status:** UNKNOWN — blocked on a deployed environment + Vercel/Supabase access
- **Owner:** Tony
- **Residual risk:** High (DR/rollback also tracked under Gate 12).

## [MEDIUM] No canary / progressive rollout
- **Area / Affected:** Vercel deploy model; `vercel.json`
- **Description:** Production promotes a full deployment at once; there is no traffic-split, canary percentage, or progressive delivery. A bad deploy reaches 100% of users immediately, relying entirely on fast rollback to recover.
- **Impact:** Larger blast radius for a defective release; no automated bake/auto-rollback on error-rate.
- **Likelihood:** Medium.
- **Reproduction:** `vercel.json` has no rollout config.
- **Evidence:** `vercel.json:1-39`.
- **Recommended fix:** Use Vercel preview/staging promotion + a short bake window with monitored error rates before full promote; or adopt staged rollout where supported.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] Environment-scoped secrets and rotation unverifiable
- **Area / Affected:** Vercel project env vars (not in repo); `.env.production.example`; `DEPLOY_CHECKLIST.md` Phase 6
- **Description:** Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `HERMES_API_KEY`, OAuth client secrets, RESEND/SENDGRID) live in the Vercel dashboard. Whether they are scoped per environment (production vs preview), stored encrypted, kept out of `NEXT_PUBLIC_*`, and rotated on a cadence cannot be verified from the repo. The checklist instructs correct handling, but instruction ≠ verification. No rotation process is documented.
- **Impact:** Possible secret over-exposure across preview/prod; stale long-lived secrets; service-role key leakage if mis-scoped.
- **Likelihood:** Medium.
- **Reproduction:** no repo evidence; requires `vercel env ls` access.
- **Evidence:** `DEPLOY_CHECKLIST.md` Phase 6; `.env.production.example`.
- **Recommended fix:** With Vercel access, verify per-environment scoping + that no secret is `NEXT_PUBLIC_*`; define and document a rotation cadence; consider an external secrets manager for the service-role key.
- **Status:** UNKNOWN — blocked on Vercel access
- **Owner:** Tony
- **Residual risk:** Medium.

## [MEDIUM] Emergency-patch path bypasses all gates with no compensating control
- **Area / Affected:** `DEPLOYMENT_RUNBOOK.md:125-131` (`vercel --prod` hotfix); `INCIDENT_RESPONSE_RUNBOOK.md`
- **Description:** The documented hotfix path (`vercel --prod`) ships straight to production with no CI, no review, and no SAST/secret-scan. There is no documented break-glass procedure (who can authorize, mandatory post-hoc CI run, retroactive review, incident log entry).
- **Impact:** Under time pressure, unreviewed/unscanned code reaches prod; no record links the hotfix to an approval or a follow-up verification.
- **Likelihood:** Medium (emergencies happen).
- **Reproduction:** runbook documents the bypass with no compensating control.
- **Evidence:** `DEPLOYMENT_RUNBOOK.md` §4 Option B.
- **Recommended fix:** Define a break-glass policy: who may invoke, mandatory incident-log entry, a required post-hoc PR + CI run within N hours, and a retro. Keep `vercel --prod` for emergencies only.
- **Status:** OPEN
- **Owner:** Tony
- **Residual risk:** Medium.

---

## Sub-gate scorecard (release & rollback)

| Sub-check | Status | Evidence |
|---|---|---|
| Prod-deploy approval gate | **FAIL** | none |
| CI green required before deploy | **FAIL** | no remote / no required check |
| Working automated deploy path | FAIL | no remote → inert |
| Canary / staged rollout | **FAIL** | full promote only |
| Rollback procedure documented | **PASS** | `ROLLBACK_RUNBOOK.md` |
| Rollback drilled / RTO measured | UNKNOWN | no drill evidence |
| Secrets absent from PR builds/logs | **PASS** | `ci.yml` no app secrets |
| Env-scoped secrets verified | UNKNOWN | Vercel access needed |
| Secret rotation process | FAIL | undocumented |
| Emergency-patch controlled | FAIL/MEDIUM | bypass, no compensating control |

**Release & rollback verdict: FAIL.** Rollback *design* is the bright spot (Vercel instant
promote, documented), but governance (approval gate), the inert deploy path, the unverified
rollback drill, and an uncontrolled break-glass path keep this below the bar.
