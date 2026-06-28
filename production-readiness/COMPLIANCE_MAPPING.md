# Compliance Mapping — Hermes Sourcing (MSourcing)

**Phase:** 13 — Privacy / Compliance / Governance
**Gate:** Gate 13 — Privacy / compliance
**Date:** 2026-06-27
**Reviewer:** Privacy / Compliance Reviewer
**Tree state:** `main`, working tree DIRTY (audited as-is).
**Purpose:** Map MSourcing's controls/gaps to the candidate compliance regimes and security baselines, as **evidence for human/DPO review**. The compliance target is **UNDEFINED** in the repo (COMP-1) — this document does **not** assert compliance or certification; it states what would be required under each plausible regime and whether repo evidence supports it.
**Companion files:** `PRIVACY_REVIEW.md` (PRIV-*), `VENDOR_AND_THIRD_PARTY_REVIEW.md` (VND-*), `ACCESS_REVIEW.md` (ACC-*), `DATA_PROTECTION_REPORT.md` (DP-*).

---

## Exec Summary

The deploying entity is **Mantu (EU)** and the data subjects are **EU/global job candidates**, so the realistic compliance floor is **GDPR + UK GDPR + the EU AI Act + e-Privacy/PECR (outreach)**, with **CCPA/CPRA** in scope whenever California residents are sourced. Yet **no regime is formally declared** in the repo and **no governing artifacts exist** (privacy notice, ROPA, DPIA, FRIA, LIA, DPA register, retention schedule). The product surfaces GDPR/CCPA/AI-flavored toggles that are **non-functional** (PRIV-2) and a README claim ("Compliance built in …") that **overstates** the implemented controls.

Mapping the code to the regimes shows a small set of **genuinely-implemented** obligations (suppression / do-not-contact / re-contact windows enforced at send; LinkedIn-terms guardrail; strong tenant RLS) sitting under a large set of **missing or decorative** obligations (transparency, lawful basis, DSR completeness, retention enforcement, opt-out mechanics, processor DPAs, international transfers, DPIA/FRIA, audit integrity, breach detection).

**Gate 13 (compliance-mapping component): FAIL** — the target is undefined (COMP-1, needs decision), the EU AI Act high-risk path is unassessed (COMP-2), outreach opt-out mechanics are unlawful as built (COMP-3 / PRIV-8), and the GDPR obligation map has multiple HIGH gaps. No certification can be claimed.

---

## COMP-1 — Headline decision required: which regimes apply

## [HIGH] COMP-1 — Compliance target undefined (human decision required)
- **Area / Affected:** Whole product / governance. No declared scope; `find` for policy/ROPA/DPIA → none (see `PRIVACY_REVIEW.md` PRIV-0).
- **Description:** The team must record: (a) **controller vs processor** role and the **legal entity/entities** + jurisdictions; (b) the **in-scope regimes**; (c) **lawful bases** per purpose; (d) whether a **DPIA/FRIA** is required. Until set, no gate item in this area can PASS.
- **Decision needed (pick + record):**
  - **GDPR / UK GDPR** — almost certainly in scope (EU deployer, EU candidates).
  - **EU AI Act** — likely **High-Risk** (recruitment/candidate evaluation, Annex III §4) → COMP-2.
  - **e-Privacy / PECR + national rules + CAN-SPAM** — in scope for email/LinkedIn outreach → COMP-3.
  - **CCPA/CPRA** — in scope if California candidates sourced (the `ccpaDoNotSell` toggle implies intent, but it is inert) → COMP-4.
  - **Sector/employment law** (e.g. NYC Local Law 144 bias-audit for automated employment decision tools) — assess if US hiring.
- **Recommended fix:** DPO-led scoping memo + ROPA + DPIA; then re-run this mapping with the target fixed.
- **Status:** OPEN (needs human decision). **Owner:** Tony / DPO. **Residual risk:** High until decided.

---

## 1. GDPR / UK GDPR obligation map

| Obligation | Article | Repo evidence | Status |
|---|---|---|---|
| Lawful basis recorded per purpose | 6 | none; `gdprMode` inert (PRIV-2) | **FAIL** |
| Special-category condition | 9 | reply bodies stored verbatim, no Art.9 control (PRIV-5) | **FAIL** |
| Transparency to subject (collected from subject) | 13 | no notice; login has none | **FAIL** |
| Transparency (not collected from subject) | 14 | sourcing w/o notice (PRIV-1) | **FAIL** |
| Right of access | 15 | `exportCandidate` (Candidate only; omits replies/chats/ledger — DP-5); no verified channel (PRIV-7) | **FAIL** |
| Rectification | 16 | editable in UI | PARTIAL |
| Erasure | 17 | `anonymizeCandidate` partial; no hard delete; ledger/audit retain PII (DP-4/DP-6) | **FAIL** |
| Restriction | 18 | none | **FAIL** |
| Portability | 20 | JSON export (Candidate only) | PARTIAL |
| Objection (incl. direct marketing) | 21 | suppression/do-not-contact enforced at send (good) but no subject-facing objection channel + opt-out broken (PRIV-8) | PARTIAL → FAIL |
| Automated decisions / profiling | 22 | `scoring.ts` ranks; no Art.22 safeguards/transparency (PRIV-6) | **FAIL** |
| Data protection by design & default | 25 | masking off by default; shared full-PII blob (PRIV-10, ACC-1) | **FAIL** |
| Records of processing (ROPA) | 30 | none (PRIV-4) | **FAIL** |
| Security of processing | 32 | strong RLS/grants (good) but plaintext secrets/tokens at rest (DP-1), PII in logs (DP-3) | PARTIAL |
| Breach notification (72h) | 33/34 | no monitoring/log-aggregation (`INVENTORY §7`); IR runbook unproven | **UNKNOWN→FAIL** |
| DPIA for high-risk | 35 | none (PRIV-6) | **FAIL** |
| Processor contracts | 28 | no DPA register (VND-1) | **FAIL** |
| International transfers | 44–49 | LLM/CDN egress to US, no SCC/adequacy evidence (PRIV-3, VND-3) | **FAIL** |
| Retention / storage limitation | 5(1)(e) | retention inert (DP-2) | **FAIL** |

**GDPR sub-verdict: FAIL** (multiple HIGH). Enforced positives to preserve: suppression/do-not-contact/re-contact at send, RLS tenant isolation, LinkedIn-terms guardrail.

---

## 2. EU AI Act

## [HIGH] COMP-2 — Likely Annex III §4 high-risk AI (recruitment), unassessed
- **Area / Affected:** `src/lib/scoring.ts` + `matchScore` ranking; LLM-generated outreach/classification (`provider.ts`).
- **Description:** AI systems for **recruitment/selection — to filter applications and evaluate candidates** — are **high-risk under Annex III §4**. MSourcing ranks/evaluates candidates and uses LLMs in the recruiting workflow. As a **provider** (if Mantu builds/markets it) Mantu owes conformity assessment, Art. 11 technical documentation, Art. 9 risk management, Art. 10 data-governance, Art. 13 transparency, Art. 14 human oversight, Art. 15 accuracy/robustness, and EU-database registration. As a **deployer**, Art. 26/27 obligations incl. a **Fundamental Rights Impact Assessment (FRIA)** and Art. 50 transparency to affected persons. Additionally, **Art. 50 transparency** applies to the LLM-generated outreach (subjects should know they are interacting with/receiving AI-generated content). **None of these artifacts exist.**
- **Impact:** Non-compliant high-risk AI deployment; significant penalties; discrimination exposure with no bias evaluation.
- **Recommended fix:** Run `mantu-ai-act-compliance` (classification → FRIA → conformity → registration → Art. 13/26/27); produce Art. 11 tech docs and a bias/fairness evaluation of `scoring.ts`; document human oversight over the **ranking** (the existing send-approval gate is not sufficient for the ranking decision).
- **Status:** OPEN (needs human decision on classification). **Owner:** DPO + AI governance. **Residual risk:** High.

| AI Act obligation | Evidence | Status |
|---|---|---|
| Risk classification recorded | none | **FAIL** |
| Conformity assessment | none | **FAIL** |
| Art. 11 technical documentation | none | **FAIL** |
| Art. 13 transparency / Art. 50 AI-content disclosure | no notice; outreach not marked AI | **FAIL** |
| Art. 14 human oversight (over ranking) | send-approval gate only (not ranking) | PARTIAL |
| Art. 10 data governance / bias mitigation | no bias evaluation on `scoring.ts` | **FAIL** |
| FRIA (deployer) | none | **FAIL** |

---

## 3. e-Privacy / PECR / CAN-SPAM (outreach)

## [HIGH] COMP-3 — Outreach opt-out & sender-identity requirements not met
- **Area / Affected:** `src/lib/providers.ts:94` (placeholder `List-Unsubscribe: <mailto:unsubscribe@hermes.example>`); SendGrid path no header; no opt-out link / postal identity in body. (Same root as PRIV-8.)
- **Description:** Cold recruiting outreach must offer a functioning opt-out and clear sender identity (e-Privacy/PECR in EU/UK; CAN-SPAM in US — opt-out + physical postal address + honored within 10 business days). The emitted `List-Unsubscribe` targets a **non-existent placeholder domain**, the SendGrid path emits none, and bodies carry no opt-out link or postal address.
- **Recommended fix:** See PRIV-8 — real monitored unsubscribe (mailto + RFC 8058 one-click `https`) on all paths; opt-out link + sender postal identity in body; wire to suppression.
- **Status:** OPEN. **Owner:** Eng. **Residual risk:** Low after fix.

| Outreach requirement | Evidence | Status |
|---|---|---|
| Functioning unsubscribe (List-Unsubscribe) | placeholder/absent (PRIV-8) | **FAIL** |
| Opt-out link + sender identity in body | absent | **FAIL** |
| Honor opt-out across channels | per-candidate flags enforced at send (good) — but no inbound opt-out capture | PARTIAL |
| LinkedIn terms (no automation/scraping) | `linkedin-policy.ts` guardrail | **PASS** |
| Rate caps (anti-spam hygiene) | daily caps enforced (`rules.ts`, `claim_and_record`) | PASS |

---

## 4. CCPA / CPRA

## [MEDIUM] COMP-4 — CCPA "do-not-sell"/opt-out toggle is decorative; no consumer-rights flow
- **Area / Affected:** `ccpaDoNotSell` (inert — PRIV-2); no CCPA notice, no "Do Not Sell/Share" link, no consumer DSR for California candidates.
- **Description:** The toggle implies CCPA intent but does nothing. If California candidates are sourced, CCPA/CPRA requires notice at collection, a "Do Not Sell or Share My Personal Information" mechanism, and consumer rights (access/delete/correct/opt-out). None implemented.
- **Recommended fix:** Decide CCPA scope (COMP-1); if in scope, implement notice + opt-out + consumer DSR, or remove the toggle/claim.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Low-Medium.

---

## 5. Security baselines (cross-reference; owned by other phases)

| Baseline | Area | Status | Owning doc |
|---|---|---|---|
| OWASP ASVS V9 (Data protection) | masking/erasure/retention | PARTIAL/FAIL | `DATA_PROTECTION_REPORT.md` |
| OWASP API Security Top 10 | authz/BOLA/secrets | see report | `API_SECURITY_REPORT.md` |
| NIST CSF (GV/PR.DS/DE/RS) | governance/detect/respond | gaps (no detect) | `INCIDENT_RESPONSE_RUNBOOK.md`, `INVENTORY` |
| CIS Controls v8 §3 (Data) | classification/retention/crypto | FAIL (DP-1/DP-2) | `DATA_PROTECTION_REPORT.md` |
| NIST SSDF | secure SDLC | see CI review | `CICD_REVIEW.md`, `SUPPLY_CHAIN_SECURITY_REPORT.md` |

---

## Gate 13 (compliance-mapping) verdict: **FAIL**
Open HIGH: COMP-1 (target undefined — decision), COMP-2 (AI Act high-risk unassessed), COMP-3 (outreach opt-out unlawful as built). Open MEDIUM: COMP-4 (CCPA decorative). GDPR map shows multiple HIGH gaps. Breach-notification readiness UNKNOWN. **No certification claimed.**

## Required human decisions (blockers)
1. Declare controller/processor + jurisdictions + in-scope regimes (COMP-1).
2. Confirm EU AI Act classification of the ranking/LLM use; if high-risk, commission conformity + FRIA (COMP-2).
3. Confirm CCPA scope (COMP-4).
4. Approve a privacy-notice + DSR + retention program (see `PRIVACY_REVIEW.md`).

## Cross-references
- `PRIVACY_REVIEW.md`, `VENDOR_AND_THIRD_PARTY_REVIEW.md`, `ACCESS_REVIEW.md`, `DATA_PROTECTION_REPORT.md`, `DATA_RETENTION_AND_DELETION.md`, `DATA_FLOW.md`, `INCIDENT_RESPONSE_RUNBOOK.md`.
