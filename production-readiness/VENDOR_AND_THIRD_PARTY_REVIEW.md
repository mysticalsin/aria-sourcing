# Vendor & Third-Party (Subprocessor) Review — Hermes Sourcing (MSourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Phase:** 13 — Privacy / Compliance / Governance
**Gate:** Gate 13 — Privacy / compliance
**Date:** 2026-06-27
**Reviewer:** Privacy / Compliance Reviewer
**Tree state:** `main`, working tree DIRTY (audited as-is).
**Scope:** third-party processors/subprocessors that receive or store personal data at runtime, the DPA/contract posture, data shared per vendor, data residency, model-training exposure (LLMs), and the vendor-governance process. **No vendor portal / contract access authorized** → DPA execution status is **UNKNOWN** for every vendor and marked as such.
**Companion files:** `PRIVACY_REVIEW.md` (PRIV-*), `COMPLIANCE_MAPPING.md` (COMP-*), `ACCESS_REVIEW.md` (ACC-*).

---

## Exec Summary

MSourcing's live path sends personal data to **at least eight categories of external processor**: Supabase (DB/auth), Vercel (hosting/logs), Resend + SendGrid (email send), Google + Microsoft (OAuth mailbox send), the configured cloud LLM provider (Anthropic/OpenAI/Groq/xAI/Mistral), the self-hosted Aria/Hermes runtime, and third-party CDN/font origins (Google Fonts, `db.onlinewebfonts.com`, CloudFront). For **none** of these is there a DPA register, a transfer mechanism record, a residency confirmation, or a customer-facing subprocessor list in the repo (verified — `find` for DPA/subprocessor docs → none outside `production-readiness/`). The integration registry (`src/lib/integrations.ts`) lists 13 *configurable* integrations, several still mock (Apollo/Hunter/Clearbit enrichment, Twenty CRM, Cal.com, n8n, Slack/Telegram) — those become additional data processors the moment they are wired and must be reviewed before enabling.

The two highest-risk vendor relationships are **(1) the cloud LLM providers**, which receive candidate PII and verbatim reply text (possibly special-category) with no evidenced DPA, no SCC/adequacy transfer, and no confirmed zero-retention/no-train configuration (default API terms of several providers permit retention; training varies) — PRIV-3 / VND-2; and **(2) Supabase**, the system of record, whose **project region is unverified** (could be US) and which holds the entire PII graph plus plaintext secrets/OAuth tokens (DP-1) — VND-3.

**Gate 13 (vendor component): FAIL** — open HIGH (no DPA register VND-1; LLM PII transfer w/o DPA/no-train VND-2); open MEDIUM (residency unverified VND-3; no vendor-governance process VND-4); LOW (third-party CDN/font egress VND-5). DPA execution status for all vendors is **UNKNOWN — blocked on contract/portal access**.

---

## 1. Subprocessor / processor inventory (runtime, live mode)

| # | Vendor | Role | Personal data shared | Residency (evidence) | DPA on file? | Sub-processing / training risk | Source |
|---|---|---|---|---|---|---|---|
| 1 | **Supabase** | DB + Auth (system of record) | full candidate graph, replies, chats, memory, operator PII, **plaintext secrets + OAuth tokens** | **UNKNOWN** (project region not in repo) | **UNKNOWN** | hosts everything; backup region UNKNOWN | `INVENTORY §4`, DP-1 |
| 2 | **Vercel** | Hosting + function logs | request data; **PII in function logs** (candidate email — DP-3) | functions `cdg1`/EU (`vercel.json:4`); log storage region UNKNOWN | **UNKNOWN** | log retention/access UNKNOWN | `vercel.json:4`, DP-3 |
| 3 | **Resend** | Transactional email | candidate `to`, subject, body | **UNKNOWN** (US co.) | **UNKNOWN** | placeholder unsubscribe (PRIV-8) | `providers.ts:85-102` |
| 4 | **SendGrid (Twilio)** | Transactional email | candidate `to`, subject, body | **UNKNOWN** (US) | **UNKNOWN** | no List-Unsubscribe (PRIV-8) | `providers.ts:111-129` |
| 5 | **Google** | Gmail-send OAuth | candidate `to`, subject, body; operator mailbox token | US/global | **UNKNOWN** | scope minimal (`gmail.send`) — good | `email-oauth.ts`, `auth/google` |
| 6 | **Microsoft** | Graph mail-send OAuth | candidate `to`, subject, body; operator token | US/global | **UNKNOWN** | `/common` multi-tenant (IAM-MEDIUM) | `email-oauth.ts`, `auth/microsoft` |
| 7 | **Cloud LLM** (Anthropic / OpenAI / Groq / xAI / Mistral) | Drafting + reply classification | candidate name/title/company/tech/activity + **full reply text (poss. Art.9)** | **mostly US** (Mistral EU) | **UNKNOWN** | **training/retention per default terms — VND-2** | `provider.ts:103-109`, `DATA_FLOW.md` |
| 8 | **Aria / Hermes self-host** | LLM runtime (private) | same prompt content | self-host (operator-controlled) | n/a (1st-party) | SSRF-allow-listed; private host | `api/url.ts`, `hermes-proxy.ts` |
| 9 | **CDN/Fonts** (Google Fonts, `db.onlinewebfonts.com`, CloudFront) | Static assets / login video | end-user IP/UA (operator side) | US/global | **UNKNOWN** | 3rd-party font CDN leaks IP — VND-5 | `next.config.mjs` CSP |

**Mock today (become processors when wired — review before enabling):** Apollo/Hunter/Clearbit (enrichment — would receive/return candidate PII), Twenty CRM, Cal.com, n8n, GitHub/LinkedIn sourcing, Slack/Telegram (`integrations.ts`, `INVENTORY §8`).

---

## Findings (FINDING FORMAT)

## [HIGH] VND-1 — No subprocessor register, no DPAs evidenced, no customer-facing subprocessor list
- **Area / Affected:** All vendors in §1. No DPA/subprocessor artifact in repo (`find . -iname "*dpa*" -o -iname "*subprocessor*"` → none outside `production-readiness/`).
- **Description:** GDPR Art. 28 requires a written DPA with every processor, and customers typically require a published subprocessor list with change notice. Neither exists. There is also no record of which sub-processors each vendor uses.
- **Impact:** Unlawful processor engagement (Art. 28); no contractual transfer/retention/security commitments; cannot answer a customer DPA/subprocessor request.
- **Likelihood:** Certain (none exist).
- **Reproduction:** Repo search above.
- **Evidence:** absence; `INVENTORY §8`.
- **Recommended fix:** Maintain a DPA register (execute Supabase/Vercel/Resend/SendGrid/Google/Microsoft/LLM DPAs), publish a subprocessor list with change-notice, and gate enabling any new integration on a completed DPA + vendor security review (`mantu-vendor-security-review`, `mantu-vendor-onboarding`).
- **Status:** OPEN. **Owner:** DPO + Procurement. **Residual risk:** Medium after register + DPAs.

## [HIGH] VND-2 — Candidate PII (incl. reply text) sent to cloud LLMs with no DPA / transfer / no-train control
- **Area / Affected:** `src/lib/ai/provider.ts:103-109,125-164`; `api/hermes/chat/route.ts`; same root as PRIV-3.
- **Description:** Live-mode drafting and reply classification ship candidate fields and **verbatim reply bodies** to the configured LLM. No DPA, no SCC/adequacy transfer record, and no confirmed zero-retention/no-train setting. Under several providers' default API terms, data may be retained for abuse-monitoring and (depending on plan/provider) used to improve services. Reply text may carry Art. 9 data (PRIV-5).
- **Impact:** Unlawful transfer + processor engagement; potential model-training on candidate data; special-category data egress to US.
- **Likelihood:** High in live mode.
- **Reproduction:** Enable a cloud provider; draft/classify → PII in request to `api.anthropic.com`/`api.openai.com`/etc.
- **Evidence:** `provider.ts:103-109`; `DATA_FLOW.md` 139-158, 183-185.
- **Recommended fix:** Execute LLM DPAs + transfer mechanism; enable enterprise zero-retention / no-train; prefer the EU self-host Aria path for PII (and/or Mistral EU); redact direct identifiers pre-prompt; disclose in the privacy notice (PRIV-1).
- **Tests to add:** Block enabling a provider without a DPA+no-train flag; test reply classification can run on self-host with no cloud egress.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Medium after controls.

## [MEDIUM] VND-3 — Data residency unverified for the system of record and egress
- **Area / Affected:** Supabase project region (UNKNOWN), Vercel log region (UNKNOWN), LLM/CDN egress (US). Only Vercel functions pinned EU (`vercel.json:4`). Same root as PRIV-9.
- **Description:** "EU residency" is not demonstrable: the Supabase DB (all PII) region is unevidenced and may be US; Vercel log storage region is unknown; LLM/font/CDN egress is mostly US.
- **Impact:** Possible undeclared international transfer of the primary PII store; residency claims unverifiable.
- **Likelihood:** Medium.
- **Reproduction:** `vercel.json:4` (cdg1 only); no Supabase region artifact; egress hosts US.
- **Evidence:** `vercel.json:4`; `INVENTORY §7`; `provider.ts`; `next.config.mjs` CSP.
- **Recommended fix:** Pin Supabase to an EU region (confirm backups too); confirm Vercel EU log region; cover egress under SCCs; self-host fonts.
- **Status:** OPEN / partially UNKNOWN — blocked on Supabase + Vercel access. **Owner:** Tony / platform. **Residual risk:** Medium.

## [MEDIUM] VND-4 — No vendor-governance / onboarding-security process; mock integrations can be enabled without review
- **Area / Affected:** `src/lib/integrations.ts` (13 configurable integrations, several mock); no gating on DPA/security review before enabling.
- **Description:** Integrations (incl. enrichment vendors that would receive candidate PII) can be toggled on with no vendor security review, no DPA check, and no privacy-impact step. There is no documented vendor-governance process.
- **Impact:** New processors silently introduced; PII shared with unreviewed third parties (e.g. Apollo/Hunter/Clearbit enrichment).
- **Likelihood:** Medium.
- **Reproduction:** Inspect `integrations.ts`; enabling is a UI/config action with no compliance gate.
- **Evidence:** `integrations.ts`; `INVENTORY §8`.
- **Recommended fix:** Require a completed vendor security review + DPA before any integration is enabled; add a register; route through `mantu-vendor-security-review` / `mantu-vendor-onboarding`.
- **Status:** OPEN. **Owner:** DPO + Eng. **Residual risk:** Low-Medium.

## [LOW] VND-5 — Third-party CDN/font origins leak operator IP and widen the supply chain
- **Area / Affected:** `next.config.mjs` CSP allows `fonts.googleapis.com`, `db.onlinewebfonts.com`, CloudFront (login hero video).
- **Description:** Loading fonts/assets from third-party origins (especially `db.onlinewebfonts.com`) discloses the operator's IP/UA to those parties and adds supply-chain/availability exposure. (Operator-side data, not candidate PII, but still a processor relationship.)
- **Impact:** Minor privacy leakage + supply-chain surface.
- **Likelihood:** Low.
- **Evidence:** `next.config.mjs` CSP `font-src`/`media-src`.
- **Recommended fix:** Self-host fonts; host the login video on first-party/Vercel; tighten CSP accordingly.
- **Status:** OPEN. **Owner:** Eng (frontend). **Residual risk:** Low.

---

## Gate 13 (vendor component) verdict: **FAIL**
Open HIGH: VND-1 (no DPA register), VND-2 (LLM PII transfer w/o DPA/no-train). Open MEDIUM: VND-3 (residency), VND-4 (no vendor governance). LOW: VND-5. DPA execution status for every vendor is **UNKNOWN — blocked on contract/portal access**.

## Blocked / UNKNOWN (need access)
- Executed DPAs + sub-processor lists for all vendors (contract/portal access).
- Supabase project + backup region; Vercel log region (platform access).
- LLM enterprise terms (retention/no-train) per enabled provider.

## Cross-references
- `PRIVACY_REVIEW.md` PRIV-3/PRIV-9; `COMPLIANCE_MAPPING.md` COMP-1; `DATA_PROTECTION_REPORT.md` DP-1/DP-3; `IAM_REVIEW.md` (OAuth scopes/tenant); `INVENTORY.md §8`; `SUPPLY_CHAIN_SECURITY_REPORT.md` (dependency supply chain).
