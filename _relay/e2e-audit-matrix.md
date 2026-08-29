# Enterprise E2E Audit Matrix

**Date:** 2026-08-28  
**Branch:** `cursor/enterprise-autopilot-b91d`  
**PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35)  
**Production host:** `https://aria-mantu-app.fly.dev` (Fly only)  
**Automated pin:** `tests/enterprise-e2e-audit-matrix.mts` — **58/58 pass**  
**Live Fly:** **`33130a8`** · migration **0071** · `deploy_status=tip_live`  
**Fly E2E:** **38 pass, 0 fail, 4 warn** (PARTIAL — M365 secrets + sourcing quota)

Format: `| Section | Check | Status | Evidence | Fix owner |`

---

## Operate routes (14)

| Section | Check | Status | Evidence | Fix owner |
|---|---|---|---|---|
| Operate | `/` Command Center loads, metrics honest | pass | `src/app/page.tsx`, store metrics recompute | — |
| Operate | `/funnel` TAnIA stage transitions | pass | funnel components, `metrics.ts` stage ranks | — |
| Operate | `/intake` email + JD parser | pass | `src/app/api/intake`, Outlook panel, webhook path | — |
| Operate | `/launch` multi-role batch | pass | `src/app/launch/page.tsx` | — |
| Operate | `/campaigns` readiness gate + source batch | pass | campaign authority 409 on ad-hoc, `sourceNextBatch` | — |
| Operate | `/applicants` Chatbox inbox | pass | `src/app/applicants/page.tsx`, `rel=noopener noreferrer` | — |
| Operate | `/candidates` drawer, enrichment, scoring | pass | `candidate-drawer.tsx`, enrichment ledger | — |
| Operate | `/vivier` talent pool / recontact | pass | vivier page + store actions | — |
| Operate | `/outreach` approval queue, send policy | pass | LinkedIn 409 manual-required, dry-run default | — |
| Operate | `/replies` classify + draft follow-up | pass | `replies-inbox-shell.tsx`, inbound_classify chain | — |
| Operate | `/calendar` bookings + prep preview | pass | `booking-report-actions.ts`, prep templates | — |
| Operate | `/fleet` seat cards, allocation | pass | fleet components, seat store | — |
| Operate | `/floor`, `/chat` agent floor + chat | pass | Floor3D, per-agent chat routes | — |

---

## Analyze + System routes (16)

| Section | Check | Status | Evidence | Fix owner |
|---|---|---|---|---|
| Analyze | `/replay` day scrub | pass | replay route + store | — |
| Analyze | `/exec` leadership KPIs | pass | exec dashboard | — |
| Analyze | `/winlog` booked-win records | pass | winlog derive + page | — |
| Analyze | `/reports` learning loop | pass | reports + skill updates | — |
| Analyze | `/sessions` history | pass | sessions page | — |
| Analyze | `/trust` ROI + compliance | pass | trust page, policy pins | — |
| System | `/studio` agent studio | pass | studio + agent framework | — |
| System | `/architecture` org + guardrails | pass | architecture page | — |
| System | `/skills` playbooks | pass | skills page + learning | — |
| System | `/memory` long-term memory | pass | encrypted memory path | — |
| System | `/curator` files | pass | curator route | — |
| System | `/soul` personas | pass | soul page | — |
| System | `/settings` integrations stack | pass | email, MCP, observability panels | — |

---

## Backend loop & webhooks

| Section | Check | Status | Evidence | Fix owner |
|---|---|---|---|---|
| Loop | `email-inbound` → `requisition_parse` (hiring need) | pass | `inbound-email-router.ts`, webhook route | — |
| Loop | `email-inbound` → `inbound_classify` (reply) | pass | step 2c E2E + `decideInboundClassifyEnqueue` | — |
| Loop | `requisition_parse` → campaign → source → shortlist | pass | worker handlers + mig 0062 inboundId | — |
| Loop | `draft_generate` → approval-gated outreach | pass | append_outreach, Needs Approval + dryRun | — |
| Loop | Positive reply → `pre_call_propose` | pass | worker inbound_classify successors | — |
| Loop | `pre_call_propose` → `first_interview_book` | pass | mig 0069/0070, propose-calendar-book cron | — |
| Loop | Live book → `interview_prep_send` | pass | mig 0071, `/api/booking/interview-prep`, worker handler | — |
| Loop | Prep drafts → approval → dispatch-outbound | pass | `interview-prep-dispatch` cron, dispatch spine | — |
| Loop | Autopilot kill switch default inert | pass | `ARIA_LOOP_KILL_SWITCH` !== false | Tony (A-1) |
| Loop | DB migrations 0053–0071 on Fly Postgres | partial | 0070 live; 0071 on tip pending golive | eng golive |

---

## Sourcing & compliance

| Section | Check | Status | Evidence | Fix owner |
|---|---|---|---|---|
| Compliance | No LinkedIn session scrape / auto-DM | pass | `linkedin-policy.ts`, send 409 manual-required | — |
| Compliance | Campaign authority blocks ad-hoc search | pass | E2E step 3b 409 CAMPAIGN_AUTHORITY | — |
| Compliance | Compliant channels: GitHub, Tavily, Apify, Apollo | pass | sourcing-actions, provider keys | — |
| Compliance | HeyReach MCP optional funnel | pass | allowlist 0056, E2E step 2e on Fly | admin enablement |
| Sourcing | Top shortlist capped at 10 | pass | `TOP_CANDIDATE_SHORTLIST_SIZE`, approve route | — |
| Sourcing | Mantu outreach quality validation | pass | `validateOutreachQuality`, brand voice | — |

---

## Security & enterprise posture

| Section | Check | Status | Evidence | Fix owner |
|---|---|---|---|---|
| Security | Calendar claim-before-effect | pass | mig 0034, `calendar-booking-authority.mts` | — |
| Security | RLS + service-role RPC boundaries | pass | function-privileges contract | — |
| Security | MCP production allowlist | pass | mig 0056, admin API | admin rows |
| Enterprise | Entra SSO | ops-blocker | `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false` | Tony (E-2) |
| Enterprise | Verified email domain (P-7) | ops-blocker | Resend/SendGrid not wired on Fly | Tony |
| Enterprise | M365 secrets (6) | ops-blocker | [`M365-OWNER-UNBLOCK.md`](M365-OWNER-UNBLOCK.md) + `print-m365-owner-portal-checklist.sh` | Tony |
| Enterprise | `/api/ready` agentFrameworks | warn | non-blocker per vision; documented | — |
| Enterprise | Dependabot high alerts | open | E-11 triage | eng |

---

## E2E script coverage

| Section | Check | Status | Evidence | Fix owner |
|---|---|---|---|---|
| E2E | Intake webhook → campaign materialization | pass | step 2a/2b, `materialize-intake-campaign.mts` | — |
| E2E | Reply webhook → classify enqueue | pass | step 2c | — |
| E2E | Sourcing-agent live provenance | partial | step 3c; quota warn on Fly | quota / campaign seed |
| E2E | Outreach dry-run + LinkedIn 409 | pass | steps 4–5 | — |
| E2E | Calendar dry-run + Teams flags | pass | step 6 | — |
| E2E | Live Teams book (confirmLive) | partial | step 6b; skipped PARTIAL M365 | Tony M365 secrets |
| E2E | Interview prep wiring pins | pass | step 2c static pins + mig 0071 | — |

---

## Ops enablement commands (owner — Fly production only)

```bash
# Status: tip vs live Fly
bash scripts/print-fly-golive-status.sh

# M365 — portal app + configure (when account cannot create registrations)
export ARIA_AZURE_APP_ID=<entra-app-id>
bash scripts/az-configure-existing-graph-app.sh --apply
bash scripts/fly-apply-owner-microsoft-secrets.sh   # if /tmp/owner-microsoft.env provided

# Golive tip to Fly (includes migration 0071)
# Owner must remint deploy confirm for tip SHA first — see production-readiness/FLY_GOLIVE.md
bash scripts/fly-golive-mantu-e2e.sh $(git rev-parse HEAD)
bash scripts/fly-deploy-now.sh                       # after confirm

# Full Fly E2E (requires secrets + live Graph seat)
APP_URL=https://aria-mantu-app.fly.dev bash e2e-workflow-test.sh

# Partial honest run (M365 deferred; live drafts + critics/approve)
bash scripts/run-enterprise-e2e-partial.sh
```

---

## Explicitly out of scope (settled)

- LinkedIn session scraping, cookie bots, PhantomBuster-style automation
- Silent auto-DM from Aria
- Bypassing human approval for outbound
- LangChain rewrite of worker spine
