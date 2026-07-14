# Evidence Index — MSourcing production-readiness review

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Date:** 2026-06-27 · **Maintainer:** Release Manager. Indexes every deliverable under `production-readiness/` with a one-line purpose and the gate(s) it supports. All evidence is local (no deployed systems; no git remote; dirty working tree). Reproduce read-only commands from repo root.

## Reproducible quality-gate evidence (verified 2026-06-27)
| Evidence | Command | Result |
|---|---|---|
| Type safety | `npm run typecheck` | exit 0, no errors |
| Lint | `npm run lint` | "No ESLint warnings or errors" |
| Tests | `npm run test` (sandbox-bypassed: tsx IPC EPERM) | 22 suites, **705/705 assertions, 0 failed** |
| Build | `npm run build` | exit 0, 36 routes (2 Edge/cache warnings) |
| Dependency audit | `npm audit` | **4 high + 1 moderate + 0 critical** (next 14.2.35) |
| CI audit policy | `grep -n audit .github/workflows/ci.yml` | `ci.yml:40` `npm audit --audit-level=high \|\| true` (non-blocking) |
| Source integrity | `git remote -v` / `git status` / `git ls-files supabase/` | **no remote**; dirty tree (~70 files); migrations **0004/0005 + config.toml UNTRACKED** |

## Final synthesis deliverables (this phase)
| File | Description | Gate |
|---|---|---|
| `RELEASE_GATE_MATRIX.md` | 14-gate final matrix with status/evidence/owner + red-team overrides | All (1–14) |
| `PRODUCTION_READINESS_REPORT.md` | Exec verdict (NOT READY) + 8 required sections + 30/60/90 plan | All |
| `RISK_REGISTER.md` | De-duplicated ranked aggregate of all findings (44 rows) | All |
| `SECURITY_REVIEW.md` | Consolidated cross-cutting security findings + controls inventory | 2,3,4,5,6,8 |
| `EVIDENCE_INDEX.md` | This index | All |

## Foundation / inventory
| File | Description | Gate |
|---|---|---|
| `INVENTORY.md` | App/repo inventory (handlers, pages, tables, integrations, secrets) | 1 |
| `ASSET_REGISTER.md` | Asset + data-store + secret catalogue | 1 |
| `ARCHITECTURE.md` | System architecture overview | 1 |
| `DATA_FLOW.md` | Data-flow + PII trace through the system | 1,5,13 |
| `UNKNOWN_ITEMS.md` | Access-blocked items (A-series infra, B-series business decisions) | 1,6,12 |

## Phase 2 — Threat model
| File | Description | Gate |
|---|---|---|
| `THREAT_MODEL.md` | STRIDE/abuse-case threat model + trust boundaries | 2 |

## Phase 3 — Frontend / UX / Accessibility / Frontend-Sec / Frontend-Perf
| File | Description | Gate |
|---|---|---|
| `UX_REVIEW.md` | Core journeys, states, responsiveness, error-boundary gap | 3 |
| `ACCESSIBILITY_REPORT.md` | WCAG 2.2 AA static review + open AA/Level-A defects | 3 |
| `FRONTEND_SECURITY_REPORT.md` | XSS/CSP/token-handling/localStorage/header findings | 3,6 |
| `FRONTEND_PERFORMANCE_REPORT.md` | Bundle size, 3D, images, CWV (unmeasured) | 3,10 |

## Phase 4 — Backend / API / Authz / Business-logic
| File | Description | Gate |
|---|---|---|
| `BACKEND_REVIEW.md` | API auth/validation/concurrency/dependency/rate-limit | 4 |
| `API_SECURITY_REPORT.md` | OWASP API Top 10 per-endpoint review | 4 |
| `AUTHORIZATION_MATRIX.md` | role×action×object, BOLA/BFLA, tenant isolation, demo fail-open | 4 |
| `BUSINESS_LOGIC_REVIEW.md` | Guardrail/suppression/quotas/replay/state-manipulation | 4 |

## Phase 5 — Database / Data protection
| File | Description | Gate |
|---|---|---|
| `DATABASE_REVIEW.md` | RLS/migrations/secrets/constraints/audit-trail integrity | 5 |
| `DATA_PROTECTION_REPORT.md` | Encryption, KMS, masking, log redaction, export/erasure | 5 |
| `DATA_RETENTION_AND_DELETION.md` | Retention enforcement + erasure gaps | 5,13 |

## Phase 6 — Infrastructure / Network / IAM / TLS
| File | Description | Gate |
|---|---|---|
| `INFRASTRUCTURE_REVIEW.md` | Consolidated infra/network/IAM verdict | 6 |
| `NETWORK_SECURITY_REPORT.md` | Network exposure/segmentation/SSRF topology | 6 |
| `IAM_REVIEW.md` | IAM least-privilege / secrets / service-role | 6 |
| `TLS_AND_HEADERS_REPORT.md` | TLS/HSTS/redirects + security-header correctness | 6 |

## Phase 7 — Containers / Orchestration
| File | Description | Gate |
|---|---|---|
| `CONTAINER_SECURITY_REPORT.md` | Vendored Claw3D Dockerfile hardening review (planned) | 7 |
| `SBOM.md` | SBOM status (none generated/published) | 7,8 |

## Phase 8 — CI/CD + Supply chain
| File | Description | Gate |
|---|---|---|
| `CICD_REVIEW.md` | Pipeline, branch protection, approval-gate gaps | 8 |
| `SUPPLY_CHAIN_SECURITY_REPORT.md` | Dependency posture, SCA, provenance, SBOM | 8 |
| `RELEASE_AND_ROLLBACK_REPORT.md` | Release/rollback design + drill gaps | 8,12 |
| `DEPLOYMENT_RUNBOOK.md` | Deploy procedure | 8 |
| `DEPLOY_CHECKLIST.md` | Pre-deploy checklist | 8 |
| `LOCAL_SETUP.md` | Local dev setup | 8 |

## Phase 9 — QA
| File | Description | Gate |
|---|---|---|
| `QA_TEST_PLAN.md` | Test plan + coverage gap analysis | 9 |
| `QA_TEST_RESULTS.md` | Verbatim typecheck/test/lint/build results | 9 |
| `COVERAGE_REPORT.md` | Coverage (uninstrumented → UNKNOWN) | 9 |
| `FLAKY_TEST_REGISTER.md` | Flaky-risk register | 9 |

## Phase 10 — Performance / Reliability / Capacity
| File | Description | Gate |
|---|---|---|
| `PERFORMANCE_REPORT.md` | Latency/throughput/DB/cache findings | 10 |
| `RELIABILITY_REPORT.md` | Timeouts/retries/idempotency/failover | 10 |
| `CAPACITY_PLAN.md` | Proposed load profile + SLOs (unratified) | 10 |

## Phase 11 — Observability / Operations
| File | Description | Gate |
|---|---|---|
| `OBSERVABILITY_REPORT.md` | Error-tracking/metrics/traces/log-PII findings | 11 |
| `ALERTING_REPORT.md` | Alerting coverage (none implemented) | 11 |
| `OPERATIONS_RUNBOOK.md` | Operations procedures | 11 |
| `INCIDENT_RESPONSE_RUNBOOK.md` | Incident response (on-call placeholders) | 11 |

## Phase 12 — Backup / Restore / DR
| File | Description | Gate |
|---|---|---|
| `BACKUP_RESTORE_REPORT.md` | Backups/PITR/restore-drill findings | 12 |
| `DISASTER_RECOVERY_PLAN.md` | DR plan (RTO/RPO undefined) | 12 |
| `BUSINESS_CONTINUITY_PLAN.md` | BCP | 12 |
| `ROLLBACK_RUNBOOK.md` | Rollback procedure (undrilled) | 8,12 |

## Phase 13 — Privacy / Compliance / Governance
| File | Description | Gate |
|---|---|---|
| `PRIVACY_REVIEW.md` | GDPR/privacy findings + DSR + transparency gaps | 13 |
| `COMPLIANCE_MAPPING.md` | Regime mapping + EU AI Act classification | 13 |
| `VENDOR_AND_THIRD_PARTY_REVIEW.md` | Subprocessor/DPA register (absent) | 13 |
| `ACCESS_REVIEW.md` | Admin/support/audit access + JML | 13 |

## Phase 14 — Adversarial
| File | Description | Gate |
|---|---|---|
| `RED_TEAM_REVIEW.md` | Red-team challenge + override list (downgrade-only) | 14 (all) |

## NOT in evidence (not run / no access)
Live external TLS/exposure scan, Vercel/Supabase/OAuth IAM review, container image build+scan+SBOM, load/stress/soak test, DB restore drill, RLS cross-tenant negative test on a live DB, axe/SR/keyboard WCAG pass, E2E suite, coverage instrumentation, runtime cookie-flag capture, executed CI run. See `UNKNOWN_ITEMS.md`.
