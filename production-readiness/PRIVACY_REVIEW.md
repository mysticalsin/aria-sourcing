# Privacy Review — Hermes Sourcing (MSourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Phase:** 13 — Privacy / Compliance / Governance
**Gate:** Gate 13 — Privacy / compliance
**Date:** 2026-06-27
**Reviewer:** Privacy / Compliance Reviewer (production-readiness review)
**Tree state:** git branch `main`, **WORKING TREE DIRTY** (audited as-is; ~50 modified + untracked files per `git status`). Evidence cites the current on-disk tree.
**Scope (this file):** data inventory & classification (privacy lens), purpose limitation / minimization, transparency & notices, consent, lawful basis, data-subject rights (access/erasure/objection/portability/automated-decisions), special-category data, retention/deletion (privacy view), regional residency, privacy-by-design/default, DPIA/ROPA posture. Companion files: `COMPLIANCE_MAPPING.md` (regime mapping + EU AI Act), `VENDOR_AND_THIRD_PARTY_REVIEW.md` (subprocessors), `ACCESS_REVIEW.md` (admin/support access + audit logging).
**Baselines:** GDPR (Arts. 5, 6, 9, 13, 14, 15–22, 25, 30, 32, 35, 44–49), UK GDPR, CCPA/CPRA, EU AI Act (Annex III §4), OWASP ASVS V9 (Data Protection), NIST CSF (GV/PR.DS), CIS Controls v8 §3.
**Compliance target: UNDEFINED** — see Finding PRIV-0 / `COMPLIANCE_MAPPING.md` COMP-1. This review produces **evidence for human/DPO review**; it does **not** assert legal compliance or certification.

> **Relationship to prior docs.** This is a NEW deliverable. It does **not** restate the storage/crypto mechanics already covered in `DATA_PROTECTION_REPORT.md` (DP-1..DP-11) and `DATA_RETENTION_AND_DELETION.md`; those remain authoritative for the *how*. This file adds the **privacy-governance** layer (notice, lawful basis, transparency, DSR channel, special-category, profiling/automated-decisions, residency, DPIA/ROPA) and cross-references DP-* where the mechanics overlap. Still-valid prior content is preserved by reference, not duplicated.

---

## Exec Summary

MSourcing processes **candidate personal data sourced without the candidate's involvement** (names, work/personal email, LinkedIn/GitHub URLs, employer, title, location, inferred tech stack, "recent activity", plus candidate-authored reply bodies that can contain special-category data), ranks candidates with a **scoring/match algorithm**, and uses it to drive recruiting outreach. That is squarely **high-risk personal-data processing** in a recruiting context, and the deploying entity (Mantu, EU) makes **GDPR + the EU AI Act the most likely applicable regimes**. The compliance target is, however, **formally undefined in the repo** — there is no privacy policy, no ROPA, no DPIA, no lawful-basis record, and no DPO sign-off artifact anywhere in the tree (`find ... -iname "*privacy*"/"*dpia*"/"*ropa*"` → none outside `production-readiness/`).

The application presents a **convincing compliance surface that is largely non-functional ("compliance theater")**: a Settings → Compliance panel with `gdprMode`, `ccpaDoNotSell`, `crmAuditLogs`, `unsubscribeEnforcement` toggles and retention-day inputs, plus a README claim "Compliance built in — GDPR export/anonymize, suppression, do-not-contact, unsubscribe enforcement, retention windows, CCPA do not sell." Verified by grep: **none of the four toggles has any consumer** in code (`grep -rn` shows them only in the panel, `seed.ts`, `types.ts`, and the store defaults), and the **retention windows are never enforced** (DP-2). The candidate-facing rights actions that *do* run (`exportCandidate`, `anonymizeCandidate`, `suppressCandidate`) are **operator-mediated, identity-unverified, and incomplete** (export omits replies/chats/ledger — DP-5; anonymize leaves ~9 fields + replies + ledger `candidate_email` + audit name — DP-4/DP-6).

Three structural privacy gaps stand out beyond the data-protection mechanics already filed: (1) **no transparency to data subjects** — candidates are sourced and profiled with **no Article 13/14 privacy notice** served anywhere (no `/privacy` route, no notice in outreach, no notice at collection), and the **`List-Unsubscribe` header points to a placeholder domain `unsubscribe@hermes.example`** that does not exist (`providers.ts:94`), so the one opt-out signal that is emitted is non-functional and the SendGrid path emits none; (2) **candidate PII is transferred to third-party cloud LLM providers** (Anthropic/OpenAI/Groq/xAI/Mistral — mostly US) for every live-mode draft and reply-classification with **no evidenced DPA, no transfer mechanism (SCC/adequacy), and no data-subject disclosure** (`provider.ts:103-109`, `DATA_FLOW.md` "Processing"); (3) **algorithmic candidate ranking** (`scoring.ts`) constitutes profiling under GDPR Art. 22 and an **Annex III §4 high-risk AI use** under the EU AI Act, with **no DPIA, no FRIA, no Art. 13 transparency, no human-oversight record** (the human-approval gate covers *outreach send*, not the *ranking* that precedes it).

**Gate 13 verdict: FAIL** — multiple HIGH privacy/governance gaps open (no notice/transparency, non-functional opt-out, undeclared cross-border LLM transfers, decorative compliance controls, missing DPIA/ROPA for high-risk processing, incomplete DSR), the compliance target is undefined (needs human decision), and several governance items (DPA execution, residency, support-plane access, breach-notification readiness) are **UNKNOWN — blocked on access/decision**. This is consistent with the app's "MVP demo / synthetic data" self-description, but the live path wires **real** candidate PII to **real** processors, so these must close before any real-subject deployment.

---

## Gate 13 Decision (privacy component)

| Check | Result | Evidence |
|---|---|---|
| Compliance target defined (which regimes) | **FAIL (needs decision)** | No policy/ROPA/DPIA artifact; `find` → none — PRIV-0 / COMP-1 |
| Data inventory & classification (privacy) | PASS | `DATA_FLOW.md`, `DATA_PROTECTION_REPORT.md §Data Classification`, this file §2 |
| Transparency / privacy notice to subjects (Art.13/14) | **FAIL** | No `/privacy`/`/terms` route; no notice at collection/outreach; `find` + route scan — PRIV-1 |
| Lawful basis recorded per purpose (Art.6) | **FAIL** | No lawful-basis register; `gdprMode` toggle inert — PRIV-2, PRIV-3 |
| Purpose limitation / data minimization (Art.5) | **FAIL** | Speculative sourcing + indefinite retention (DP-2); free-text replies stored verbatim — PRIV-4 |
| Special-category data handling (Art.9) | **FAIL** | Reply bodies stored verbatim with no Art.9 control/screen — PRIV-5 |
| Automated decision-making / profiling (Art.22 + AI Act) | **FAIL** | `scoring.ts` ranks candidates; no DPIA/FRIA/transparency/oversight record — PRIV-6 / COMP-2 |
| Data-subject rights channel (access/erasure/objection) | **FAIL** | Operator-mediated only; identity unverified; export/erasure incomplete (DP-4/DP-5) — PRIV-7 |
| Consent / e-Privacy / outreach opt-out | **FAIL** | `List-Unsubscribe` = placeholder `hermes.example`; SendGrid path none; no opt-out link in body — PRIV-8 |
| Retention & deletion enforced | **FAIL** | Retention unenforced; no account/workspace deletion (DP-2/DP-4/DP-7) — cross-ref |
| Compliance controls actually function (no "theater") | **FAIL** | 4 toggles have zero consumers; README over-claims — PRIV-2 |
| Regional data residency (EU) | **UNKNOWN / PARTIAL** | Vercel `cdg1` (EU) only; Supabase region + LLM/CDN egress unverified — PRIV-9 / `VENDOR...` VND-3 |
| Privacy-by-design / -default | **FAIL** | Confidentiality masking off by default; full PII in shared blob; render-only (DP-8/DP-10) — PRIV-10 |
| DPIA performed (high-risk) | **FAIL (needs decision)** | None in repo — PRIV-6 / COMP-2 |
| ROPA maintained (Art.30) | **FAIL** | None in repo — PRIV-4 |
| Breach-notification readiness (Art.33/34) | **UNKNOWN** | No monitoring/log-aggregation (`INVENTORY §7`); IR runbook exists but unproven — see `INCIDENT_RESPONSE_RUNBOOK.md` |

**Overall Gate 13 (privacy): FAIL** — open HIGH: PRIV-1, PRIV-2, PRIV-3, PRIV-6, PRIV-8; open MEDIUM: PRIV-4, PRIV-5, PRIV-7, PRIV-9, PRIV-10; PRIV-0 / COMP-1 (target undefined) requires a human decision; residency + breach-readiness UNKNOWN (blocked on access).

---

## 1. What makes this high-risk (context)

- **Subjects do not initiate contact.** Candidates are sourced (mock today; LinkedIn/GitHub/ATS in the intended design — `DATA_FLOW.md` Entry Points) and profiled before any relationship exists. GDPR **Art. 14** (data not obtained from the subject) therefore applies and requires a proactive privacy notice — which does not exist (PRIV-1).
- **Algorithmic ranking.** `src/lib/scoring.ts` + `matchScore` rank candidates and feed the pipeline. This is profiling (Art. 4(4)) and, in an employment/recruitment context, an **EU AI Act Annex III §4 high-risk use**.
- **Free-text candidate content.** `ClassifiedReply.body` (`types.ts:316`) stores the candidate's verbatim reply, which routinely contains special-category data (e.g. "I'm on parental/medical leave", health, religion-driven availability) — Art. 9.
- **Real third-party egress.** Live mode sends candidate PII to cloud LLMs and to email providers (`DATA_FLOW.md` Exit Points; `provider.ts:103-109`; `providers.ts`/`email-oauth.ts`).
- **EU deployer.** Mantu is EU-based → GDPR + EU AI Act are the realistic floor (see `COMPLIANCE_MAPPING.md`).

---

## 2. Privacy data inventory (subject-centric view)

Authoritative field/table inventory is in `DATA_FLOW.md` and `DATA_PROTECTION_REPORT.md §Data Classification`. Privacy-relevant summary:

| Subject | Data | Source | Lawful basis (candidate) | Notice given? |
|---|---|---|---|---|
| **Candidate** | name, email, LinkedIn/GitHub URL, company, title, location, techStack (inferred), recentActivity (inferred), yearsExperience, matchScore (derived/profiling), outreach+reply history, **reply body (free text, poss. Art.9)**, booking | sourced / operator-entered / inbound replies | **Not recorded** (likely "legitimate interest" intended; no LIA on file) | **No** (PRIV-1) |
| **Hiring manager** | name, email (`Campaign.hiringManagerEmail`) | intake parsing | not recorded | n/a internal |
| **Operator/recruiter** | email, full_name, operator_email, OAuth mailbox tokens | sign-up / OAuth | employment relationship | n/a internal |

Storage locations (privacy view): `workspace_state` JSONB (live) or `localStorage` (demo) hold the full candidate graph; `outreach_ledger` holds a **second copy of `candidate_email`** (immutable); LLM/email providers receive PII at egress. No data-classification *policy artifact* exists (DP report §"Data Classification" recommends codifying it).

---

## Findings (FINDING FORMAT)

## [HIGH] PRIV-0 — Compliance target is undefined; no privacy governance artifacts exist
- **Area / Affected:** Whole product / governance. No `/privacy`, ROPA, DPIA, LIA, lawful-basis register, DPA register, or DPO sign-off anywhere (`find . -iname "*privacy*" -o -iname "*dpia*" -o -iname "*ropa*"` → nothing outside `production-readiness/`).
- **Description:** The product ships GDPR/CCPA/EU-AI-Act-flavored UI and a README compliance claim, but **no decision has been recorded** on which regimes apply, who the controller/processor is, what the lawful bases are, or whether a DPIA is required. Without this anchor, every downstream control is unverifiable.
- **Impact:** Cannot determine adequacy of any control; cannot certify; high regulatory exposure if deployed with real candidates under EU jurisdiction.
- **Likelihood:** Certain (it is the current state).
- **Reproduction:** Repo search above; Settings panel shows toggles with no backing policy.
- **Evidence:** `find` output (none); `README.md:123`; `compliance-panel.tsx`.
- **Recommended fix:** Human/DPO decision (see `COMPLIANCE_MAPPING.md` COMP-1): name controller/processor + jurisdictions; declare in-scope regimes (GDPR/UK GDPR/CCPA/EU AI Act/e-Privacy); write ROPA (Art.30) and a DPIA (Art.35); record lawful bases + LIA; appoint/confirm DPO sign-off.
- **Tests to add:** N/A (governance) — add a CI doc-presence check for ROPA/DPIA/privacy-notice once authored.
- **Status:** OPEN (needs human decision). **Owner:** Tony / DPO. **Residual risk:** High until decided.

## [HIGH] PRIV-1 — No transparency / privacy notice served to candidates (GDPR Art. 13/14)
- **Area / Affected:** No `/privacy` or `/terms` route (route scan: none); no notice in outreach templates; no notice at collection. `src/app/login/page.tsx` has no consent/notice text (grep: none).
- **Description:** Candidates are sourced and profiled without their involvement, yet **no privacy information** (controller identity, purposes, lawful basis, recipients incl. LLM providers, retention, rights, source of data) is provided to them — directly or via the outreach message. Art. 14 makes this mandatory when data is not collected from the subject (typically within one month / at first communication).
- **Impact:** Core transparency breach; candidates cannot exercise rights they are unaware of; compounds PRIV-7 (no usable rights channel).
- **Likelihood:** Certain.
- **Reproduction:** `find src/app -type d | grep -iE 'privacy|terms|legal'` → none; inspect outreach body generation (`mock-ai.ts`/LLM) — no notice/footer.
- **Evidence:** route scan; `README.md:123`; absence in `login/page.tsx`, outreach generators.
- **Recommended fix:** Publish a candidate-facing privacy notice (hosted page) and include a link + source-of-data + objection path in every first outreach; serve at any collection point.
- **Tests to add:** Test that outreach output contains the privacy-notice link and a working opt-out; route test that `/privacy` exists and is reachable unauthenticated.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Medium after fix.

## [HIGH] PRIV-2 — "Compliance theater": Compliance panel toggles have zero consumers; README over-claims
- **Area / Affected:** `src/components/settings/compliance-panel.tsx` (`gdprMode`, `ccpaDoNotSell`, `crmAuditLogs`, `unsubscribeEnforcement`); `seed.ts:123-126`; `store.ts:2885`; `types.ts:507-510`; `README.md:123`.
- **Description:** Verified by grep that all four compliance toggles appear **only** in the panel, the seed/store defaults, and the type — **no code reads them to change behavior**. `gdprMode` does not gate export/erasure; `ccpaDoNotSell` does nothing; `crmAuditLogs` does not control whether auditing happens (the `activities[]` trail writes regardless); `unsubscribeEnforcement` does not gate sends (the per-candidate `unsubscribed`/`doNotContact` flags do, independent of this toggle). The retention inputs are likewise inert (DP-2). The UI tells operators "Records past their retention window are flagged for anonymization. Candidates can request data export or erasure at any time" (`compliance-panel.tsx:113-116`) and the README claims these are "built in" — both are misleading.
- **Impact:** Operators (and, by implication, customers/subjects) are given false compliance assurances; a control shown as ON does nothing; undermines accountability (Art. 5(2)).
- **Likelihood:** Certain.
- **Reproduction:** `grep -rn "gdprMode|ccpaDoNotSell|crmAuditLogs|unsubscribeEnforcement" src/` → definitions/defaults/panel only.
- **Evidence:** grep output (this review); `compliance-panel.tsx:113-116`; `README.md:123`.
- **Recommended fix:** Either wire each toggle to real behavior (e.g. `gdprMode` enables the lawful-basis + DSR workflow; `crmAuditLogs` toggles an immutable audit sink; `ccpaDoNotSell` enforces no-share for flagged subjects; `unsubscribeEnforcement` is the master switch over the per-candidate flags) **or remove the toggles and the README/UI claims** until implemented. Do not ship inert compliance controls.
- **Tests to add:** Behavioral test per toggle (ON vs OFF changes a verifiable outcome); a test that asserts no compliance setting is "display-only".
- **Status:** OPEN. **Owner:** Eng + Compliance. **Residual risk:** Low after fix.

## [HIGH] PRIV-3 — Candidate PII transferred to third-party LLM providers with no DPA / transfer mechanism / disclosure
- **Area / Affected:** `src/lib/ai/provider.ts:103-109` (Anthropic/OpenAI/Groq/xAI/Mistral endpoints); `src/app/api/hermes/chat/route.ts`; `DATA_FLOW.md` "Processing — Outreach Drafting / Reply Classification".
- **Description:** In live mode, candidate fields (name, title, company, techStack, recentActivity, yearsExperience) and **full candidate reply text** are sent to the configured cloud LLM as prompt content. These providers are external processors (mostly US-headquartered). There is **no evidenced DPA, no SCC/adequacy transfer mechanism, no zero-retention/no-train configuration, and no disclosure to the candidate** that their data is processed by an LLM provider. (See `VENDOR_AND_THIRD_PARTY_REVIEW.md` VND-2.)
- **Impact:** Unlawful processor engagement (Art. 28) and unlawful international transfer (Art. 44–49) absent the right paperwork; reply text may include Art. 9 data (PRIV-5) shipped to a US LLM; potential model-training on candidate data under default API terms.
- **Likelihood:** High in live mode (this is the default live path for drafting/classification).
- **Reproduction:** Live mode → draft outreach / classify a reply → request hits `api.anthropic.com`/`api.openai.com`/etc. with PII in the body.
- **Evidence:** `provider.ts:103-109,125-164`; `DATA_FLOW.md` lines 139-158, 183-185.
- **Recommended fix:** Execute DPAs + transfer mechanism (SCCs/DPF) with each enabled provider; enable zero-retention / no-train where offered; prefer the EU-region self-host (Aria) path for PII; disclose LLM processing in the privacy notice; consider redacting direct identifiers before the prompt.
- **Tests to add:** Test that a provider cannot be enabled without a recorded DPA flag; test that reply classification can run against the self-host path without egress to a cloud LLM.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Medium until DPAs/transfers + no-train are in place.

## [MEDIUM] PRIV-4 — Purpose limitation / minimization not implemented; no ROPA; indefinite retention
- **Area / Affected:** Sourcing pipeline (`DATA_FLOW.md` Entry Points); retention (DP-2); `outreach_ledger` (second PII copy); no ROPA artifact.
- **Description:** Candidates are sourced and stored speculatively with all enrichment fields retained indefinitely (retention windows inert — DP-2). There is no minimization step (e.g. dropping `recentActivity`/`techStack` once a decision is made), no purpose-tagging, and no Record of Processing Activities (Art. 30).
- **Impact:** Storage-limitation + minimization breach (Art. 5(1)(c)/(e)); larger breach blast radius; no Art. 30 record for accountability.
- **Likelihood:** High.
- **Reproduction:** DP-2 grep (retention unenforced); inspect stored candidate — all fields retained.
- **Evidence:** DP-2; `DATA_FLOW.md`; absence of ROPA.
- **Recommended fix:** Author the ROPA; implement the retention job (DP-2); define a minimal field set per purpose and drop the rest after the decision; document purposes.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Low-Medium.

## [MEDIUM] PRIV-5 — Special-category data (Art. 9) in reply bodies is stored verbatim with no control
- **Area / Affected:** `ClassifiedReply.body` (`types.ts:316`), `replyHistory.excerpt`; sent to LLM for classification (PRIV-3).
- **Description:** Candidate replies are stored in full and classified by an LLM. Such free text frequently contains special-category data (health/medical reasons for unavailability, parental status, religion). There is no Art. 9 condition recorded, no screening/redaction, and the text is both persisted and exported to a third-party LLM.
- **Impact:** Processing of special-category data without an Art. 9 basis; amplified by the cross-border LLM transfer (PRIV-3).
- **Likelihood:** Medium (depends on reply content; common in recruiting).
- **Reproduction:** Classify a reply containing a medical reason; inspect stored `replies[].body` and the LLM egress.
- **Evidence:** `types.ts:316`; `DATA_FLOW.md` lines 152-158.
- **Recommended fix:** Minimize stored reply text (store classification + short non-sensitive excerpt only); screen/redact before LLM; record an Art. 9 basis or avoid processing special-category content.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Medium.

## [HIGH] PRIV-6 — Algorithmic candidate ranking = profiling/automated-decision + EU AI Act high-risk, with no DPIA/FRIA/transparency
- **Area / Affected:** `src/lib/scoring.ts`, `matchScore` on `Candidate`; pipeline ordering by score. No DPIA/FRIA/transparency/human-oversight record.
- **Description:** Scoring ranks candidates and drives who gets contacted. Under GDPR this is profiling (Art. 4(4)) and triggers Art. 22 / Art. 13(2)(f) transparency and a DPIA (Art. 35) for systematic evaluation. Under the EU AI Act, candidate evaluation/filtering for recruitment is **Annex III §4 high-risk**, triggering conformity assessment, Art. 11 technical documentation, Art. 13 transparency, Art. 14 human oversight, and (for deployers) Art. 26/27 obligations incl. a Fundamental Rights Impact Assessment. None of these artifacts exist. The product's human-approval gate covers *outreach send*, not the *ranking* that selects candidates, so it does not by itself satisfy Art. 22 meaningful-human-involvement for the ranking decision.
- **Impact:** Non-compliant high-risk AI processing; discrimination/bias exposure with no bias evaluation on file; transparency + DPIA breach.
- **Likelihood:** High (ranking is core to the product).
- **Reproduction:** Inspect `scoring.ts`; candidates are ordered by `matchScore`.
- **Evidence:** `scoring.ts`; absence of DPIA/FRIA; `COMPLIANCE_MAPPING.md` COMP-2.
- **Recommended fix:** Run the AI Act classification + (if high-risk) conformity assessment, FRIA, Art. 11 tech docs, Art. 13 transparency, documented human oversight on the ranking; run a bias/fairness evaluation on the scoring; complete the GDPR DPIA. (Mantu skills `mantu-ai-act-compliance`, `mantu-dpia-writer`, `mantu-model-risk` apply.)
- **Tests to add:** Bias/fairness test fixtures on `scoring.ts`; a gate that blocks deploy without DPIA/FRIA sign-off.
- **Status:** OPEN (needs human/DPO decision on classification). **Owner:** DPO + AI governance. **Residual risk:** High until assessed.

## [MEDIUM] PRIV-7 — Data-subject-rights flow is operator-mediated, identity-unverified, and incomplete
- **Area / Affected:** `candidate-drawer.tsx:153-172,449-460` (Export/Anonymize/Suppress buttons); `store.ts` `exportCandidate` (DP-5), `anonymizeCandidate` (DP-4), `recordPiiReveal` (DP-6). No candidate-initiated channel.
- **Description:** All rights are exercised **by the operator on the candidate's behalf**, with no identity verification of the requester, no objection/restriction handling, no portability format guarantee, and no deletion (erasure is partial — DP-4; export under-discloses — DP-5; audit/ledger retain identifiers — DP-6). There is no candidate-facing request mechanism (compounds PRIV-1).
- **Impact:** Rights under Arts. 15–22 cannot be reliably fulfilled; risk of disclosing data to the wrong person (no verification); incomplete erasure.
- **Likelihood:** High when a real request is exercised.
- **Reproduction:** Exercise Export/Anonymize in the drawer; compare against persisted state (replies/ledger remain).
- **Evidence:** `candidate-drawer.tsx`; DP-4/DP-5/DP-6.
- **Recommended fix:** Build a verified DSR intake (linked from the privacy notice), complete the export (all sources) and erasure (all stores incl. ledger mask + audit scrub per DP-4..DP-6), and add objection/restriction handling.
- **Status:** OPEN. **Owner:** Eng + DPO. **Residual risk:** Low-Medium.

## [HIGH] PRIV-8 — Outreach opt-out is non-functional (placeholder `List-Unsubscribe`; SendGrid path has none; no opt-out link in body)
- **Area / Affected:** `src/lib/providers.ts:94` (`"List-Unsubscribe": "<mailto:unsubscribe@hermes.example>"`); SendGrid send path (`providers.ts:111-129`) sets no `List-Unsubscribe`; outreach body generation has no opt-out link.
- **Description:** The only opt-out signal emitted on the Resend path points to the **non-existent placeholder domain `hermes.example`**, so an unsubscribe attempt goes nowhere. The SendGrid path emits no `List-Unsubscribe` header at all, and the generated outreach body contains no unsubscribe link or physical postal address. This breaks both e-Privacy/PECR (EU/UK) and CAN-SPAM (US) outreach requirements and means a candidate cannot stop contact via the message itself (only the operator can, via the internal flags).
- **Impact:** Unlawful direct marketing/outreach mechanics; candidates cannot self-serve opt-out; reputational + regulatory exposure on first real send.
- **Likelihood:** Certain on any real send.
- **Reproduction:** `grep -n "List-Unsubscribe" src/lib/providers.ts` → placeholder; SendGrid branch has no such header; inspect generated body — no opt-out link.
- **Evidence:** `providers.ts:94`; `providers.ts:111-129`.
- **Recommended fix:** Set a real, monitored unsubscribe mailbox + `List-Unsubscribe` (mailto + one-click `https` per RFC 8058) on **all** send paths; include a working opt-out link and sender postal identity in the body; wire the opt-out to `unsubscribeCandidate`/suppression. (See `COMPLIANCE_MAPPING.md` COMP-3.)
- **Tests to add:** Test that every send path includes a non-placeholder `List-Unsubscribe` and the body contains an opt-out link; reject sends with a `*.example` unsubscribe target.
- **Status:** OPEN. **Owner:** Eng. **Residual risk:** Low after fix.

## [MEDIUM] PRIV-9 — Data residency only partially controlled (Vercel cdg1 EU; Supabase region + egress unverified)
- **Area / Affected:** `vercel.json:4` (`"regions": ["cdg1"]`); Supabase project region UNKNOWN (no repo evidence); LLM endpoints + `db.onlinewebfonts.com`/Google Fonts/CloudFront egress (US).
- **Description:** Only the Vercel **function** region is pinned to EU (cdg1/Paris). The Supabase database region (where all PII actually rests) is not evidenced and could be US; LLM and CDN/font egress is mostly US. So "EU residency" is not demonstrable end-to-end.
- **Impact:** Possible undeclared international transfer of the primary PII store; residency claims unverifiable.
- **Likelihood:** Medium.
- **Reproduction:** `vercel.json` shows cdg1 only; no Supabase region artifact; egress hosts in `provider.ts`/`next.config.mjs` CSP are US.
- **Evidence:** `vercel.json:4`; `INVENTORY §7`; `VENDOR_AND_THIRD_PARTY_REVIEW.md` VND-3.
- **Recommended fix:** Pin the Supabase project to an EU region; document end-to-end residency incl. egress; replace `db.onlinewebfonts.com` with self-hosted fonts; cover LLM egress under SCCs (PRIV-3).
- **Status:** OPEN / partially UNKNOWN — blocked on Supabase project access. **Owner:** Tony / platform. **Residual risk:** Medium.

## [MEDIUM] PRIV-10 — Privacy-by-default not met (confidentiality masking off by default; full PII in a domain-shared blob)
- **Area / Affected:** `settings.confidentialityMode` default off (DP-10); `applyConfidentiality` render-only; per-email-domain shared workspace exposes all PII to every authenticated user (`ACCESS_REVIEW.md` ACC-1; `DATA_FLOW.md` note).
- **Description:** By default every authenticated operator in a domain sees full, unmasked candidate PII (masking is opt-in, render-only, reversible — DP-10), and the entire PII graph lives in one shared `workspace_state` blob with no need-to-know segregation. This is the opposite of data-protection-by-default (Art. 25(2)).
- **Impact:** Over-exposure of PII to all internal users by default; no minimization at the access layer.
- **Likelihood:** High (default behavior).
- **Reproduction:** Default settings → all PII visible to any member.
- **Evidence:** DP-10; ACC-1.
- **Recommended fix:** Default confidentiality on for non-active views; add need-to-know segregation (per recruiter/campaign); see ACC-1.
- **Status:** OPEN. **Owner:** Eng. **Residual risk:** Low-Medium.

---

## What is verifiably good (preserve)

- Candidate rights *actions* exist in the UI (Export/Anonymize/Suppress/Do-not-contact/Unsubscribe) and are confirm-gated (`candidate-drawer.tsx`) — the scaffolding is there; it needs completion (PRIV-7) not invention.
- LinkedIn policy guardrail blocks scraping/automation and forces assisted-manual outreach (`src/lib/linkedin-policy.ts`) — a genuine platform-terms control.
- Per-candidate suppression / do-not-contact / re-contact-window are actually enforced at send (`claim_and_record` RPC; `DATA_RETENTION_AND_DELETION.md §1`).
- Strong tenant/RLS + least-privilege column grants withhold secrets/tokens from the client (`0005`; see `ACCESS_REVIEW.md`).
- Self-host (Aria) LLM path exists as a privacy-preserving alternative to cloud LLM egress.

## Blocked / UNKNOWN (need access or decision)
- **Compliance target** (regimes, controller/processor, lawful bases) — needs human/DPO decision (PRIV-0 / COMP-1).
- **EU AI Act classification** of the scoring/ranking — needs decision (PRIV-6 / COMP-2).
- **Supabase project region + backup region** — blocked on Supabase access (PRIV-9).
- **Breach-notification readiness** (detection → 72h) — no monitoring/log-aggregation (`INVENTORY §7`); IR runbook unproven.

## Cross-references
- `COMPLIANCE_MAPPING.md` — regime mapping (GDPR/CCPA/EU AI Act/e-Privacy), COMP-1..COMP-n.
- `VENDOR_AND_THIRD_PARTY_REVIEW.md` — subprocessors + DPAs + residency.
- `ACCESS_REVIEW.md` — admin/support access, service-role, audit logging.
- `DATA_PROTECTION_REPORT.md` / `DATA_RETENTION_AND_DELETION.md` — storage/crypto + retention/erasure mechanics (DP-1..DP-11).
- `DATA_FLOW.md` — PII entry/exit/lifecycle.
