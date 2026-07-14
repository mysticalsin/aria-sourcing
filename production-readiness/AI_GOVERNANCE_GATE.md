# ARIA AI governance pre-production gate

Updated: 2026-07-14
Scope: ARIA candidate sourcing, ranking, outreach drafting, adaptive sourcing lessons, DeerFlow orchestration, and Flowise workflow authoring/import.

## Gate decision

**NO-GO for production AI execution. Restrict to disabled/shadow mode.**

This is an engineering governance record, not legal advice or a completed legal classification. It intentionally leaves names, approvals, registration identifiers, and contractual roles unknown until the accountable Mantu functions provide evidence.

## Preliminary classification

| Item | Current record |
|---|---|
| Intended use | Source, screen, rank, and draft outreach to employment candidates |
| Mantu role | **Unknown** — provider, deployer, or both must be fixed from contractual and operating evidence |
| Preliminary AI Act tier | **High-risk candidate** under the internal Annex III employment/recruitment rule; Legal and AI Compliance sign-off missing |
| GPAI dependencies | Configurable third-party cloud LLMs; exact production providers/models and downstream documentation are not fixed |
| Article 50 trigger | Candidate-facing AI-assisted text and agent interaction require an approved disclosure posture; product behavior alone is not sign-off |
| Banned-practice review | Code review found no intended biometric categorisation, emotion recognition, social scoring, or facial-image collection; independent scope review is still required |

## Regulatory artefacts

| Required evidence | Status | Production condition |
|---|---:|---|
| Written provider/deployer role | Missing | Contractual owner and rationale signed |
| Classification decision tree | Draft only | AI Compliance + Legal approve exact scope |
| DPIA and, where applicable, FRIA | Missing | DPO-approved records on file |
| Article 11 / Annex IV technical file | Partial engineering documents only | Complete controlled technical file |
| Risk and data-governance system | Partial | Bias, representativeness, limitations, redress, and change controls approved |
| Human oversight over ranking | Partial | Named reviewer can understand, challenge, override, and record the decision—not only approve message delivery |
| Automatic logging and retention | Partial | Retention, access, erasure, and ≥6-month operating evidence approved |
| Instructions for use / transparency | Missing sign-off | Candidate and operator disclosures tested and approved |
| Conformity route / declaration / marking | Unknown | Legal determines applicability and records evidence |
| EU database registration | Unknown | Registration proof exists if required before placement/use |
| Post-market monitoring and incident plan | Missing | Dashboards, thresholds, owners, escalation, and reporting clock tested |
| DPO, Legal, AI Compliance, CTO sign-off | Missing | All required signatures recorded |

## Model-risk five-artefact gate

Risk tier: **HIGH candidate** because the system influences employment sourcing and ranking.

| Artefact | Status | Evidence still required |
|---|---:|---|
| Independent validation report | Missing | Frozen benchmark, real-provider grounding, hallucination/fabrication rate, prompt-injection battery, tool-boundary tests, subgroup/fairness analysis, limitations, and independent sign-off |
| Monitoring plan | Missing | Production quality, grounding, cost, latency, refusal, tool-call, fairness, drift, and incident alerts routed to named owners |
| Challenger | Missing | Deterministic reviewed-query baseline or another approved model running in shadow, with promotion/retirement thresholds |
| Kill criteria | Partial | Technical framework kill switch exists in source and defaults active; thresholds, drill, fallback, and production receipt are missing |
| Named ownership | Missing | One owner and one deputy, handoff procedure, validation cadence, and retirement authority |

## Mandatory kill criteria before activation

The accountable model owner must approve numeric thresholds. At minimum, activation must stop immediately on:

1. Any candidate without a real provider-evidence receipt.
2. Any unauthorized tool, provider, memory, flow, workspace, campaign, or message-delivery attempt.
3. Any cross-tenant or cross-owner data observation.
4. Any upstream framework/model revision not present in the accepted release manifest.
5. Any material grounding, fairness, hallucination, cost, latency, or error threshold breach.
6. Missing model owner/deputy, expired validation, or required regulatory sign-off.

Fallback is deterministic reviewed-query sourcing plus human review, or complete AI execution shutdown. It is never an unreviewed model or a floating upstream release.

## Re-open conditions

Production AI execution may be reconsidered only when:

- the regulatory and five model-risk artefacts above are complete and independently signed;
- exact DeerFlow and Flowise images are lockfile-built, scanned, SBOM-attested, signed, and deployed by digest;
- Flowise tenant isolation and commercial entitlement, if relied upon, are proven;
- at least 50 frozen evaluation cases plus adversarial, fairness, reliability, and two-tenant suites pass on the exact release;
- dashboards, alerts, kill-switch drill, backup/restore, rollback, erasure, and incident response have durable receipts;
- one controlled real campaign proves reviewed need → real source evidence → persisted candidates → feedback → independently promoted lesson → later exact-role reuse → human-approved outreach, with no autonomous delivery.
