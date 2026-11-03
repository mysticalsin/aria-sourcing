# Codex audit findings

Codex writes findings here as it audits the codebase. Claude Code triages
every `open` entry at the start of each session/loop iteration. See
`AGENTS.md` for the full protocol.

## Template

```markdown
## <date> — <short title>
**Severity:** correctness | security | spec-mismatch | test-gap
**File:** path:line
**Issue:** what's wrong, concretely — not "could be cleaner"
**Repro/evidence:** the input/state that breaks, or the spec line violated
**Suggested fix:** optional, one line
**Status:** open | fixed (commit hash) | wontfix (reason)
```

Only open findings are kept here. Closed ones (fixed or wontfix, July to
November 2026) are in `_relay/archive/codex-findings-closed-2026-11-03.md`.

## 2026-07-09 — ElevenLabs key requires rotation
**Severity:** security
**File:** .env.local
**Issue:** The live `ELEVENLABS_API_KEY` appeared in an internal agent tool result during this audit. It is gitignored, but should be treated as compromised.
**Repro/evidence:** The incident was observed in the current session. No part of the key is reproduced in this finding.
**Suggested fix:** Revoke it, issue a least-privilege replacement, update local and deployment secrets, and record only rotation metadata.
**Status:** open
**Triage 2026-11-03:** Voice/TTS code was removed by the 2026-10-26 demo cleanup (no ElevenLabs reference left in src/), but an exposed key stays live until revoked. Owner action: revoke the key in the ElevenLabs account; no replacement is needed.

## 2026-07-11 - Fly deployment credential exposed in internal tool output
**Severity:** security
**File:** production-readiness/.fly-token.env
**Issue:** A diagnostic emitted part of the current Fly deployment credential into an internal tool result while trying to classify the ignored file format.
**Repro/evidence:** Incident record `_relay/archive/2026-07/incidents/2026-07-11-fly-deploy-token-exposure.md`; the credential is intentionally not reproduced.
**Suggested fix:** Replace with a short-lived least-privilege token, update GitHub deployment secrets, revoke the exposed token, review Fly activity, and ban content-derived secret-file diagnostics.
**Status:** open
**Triage 2026-11-03:** Fly deploy tooling and `production-readiness/` were removed by the 2026-10-26 demo cleanup, so no replacement token is needed, but the exposed token stays valid until revoked. Owner action: revoke it (and the Fly apps if they still run) in the Fly account.

## 2026-07-12 - GitHub CLI credential exposed through process arguments
**Severity:** security
**File:** _relay/HANDOFF.md
**Issue:** A read-only CI diagnostic interpolated the GitHub CLI credential into a curl Authorization argument, making the credential visible to local process inspection.
**Repro/evidence:** The process command line was observed during the release audit. Matching curl processes were terminated, authenticated GitHub access was stopped, and the credential is not reproduced in this finding.
**Suggested fix:** Revoke and rotate the credential, review GitHub account and repository access history, use least privilege, and keep credentials out of argv and diagnostic output.
**Status:** open
**Triage 2026-11-03:** Not a tree defect, so the demo cleanup does not close it: the GitHub CLI token stays valid until revoked. Owner action: run `gh auth refresh`/re-login (or revoke the token under GitHub settings) and review account access history.

## 2026-07-14 - Provider erasure evidence is manual and not independently verified
**Severity:** security
**File:** src/app/api/admin/candidates/erasure/route.ts:36; supabase/migrations/0033_candidate_erasure_authority.sql:1839
**Issue:** ARIA exposes a manual provider-reference workflow and accepts a case reference plus syntactically valid SHA-256, but it neither executes provider deletion nor verifies that the evidence artifact exists and proves deletion.
**Repro/evidence:** The completion request validates the hash format and expected attempt count. The database records that assertion; no approved evidence store or provider adapter is queried.
**Suggested fix:** Bind completion to an approved evidence-store object and provider account, or add provider-specific deletion and receipt adapters with replay-safe reconciliation.
**Status:** open; provider-held candidate data remains a production NO-GO
**Triage 2026-11-03:** Still applies: `src/app/api/admin/candidates/erasure/route.ts` still accepts `evidenceSha256` + `caseReference` with no evidence-store check.

## 2026-07-14 - Large provider-obligation sets have no safe completion path
**Severity:** correctness
**File:** supabase/migrations/0033_candidate_erasure_authority.sql:201
**Issue:** The 100-obligation guard prevents partial local scrubbing, but candidates with more than 100 linked provider records cannot enter the application erasure workflow.
**Repro/evidence:** The before-insert trigger raises SQLSTATE 54000 at the 101st obligation, and the route returns a typed 409 before destructive data changes. There is no paginated bulk workflow that can complete the request.
**Suggested fix:** Replace the fixed durable-obligation cap with paginated response authority while preserving atomic request creation and bounded API pages.
**Status:** open; documented Security and DPO escalation is required
**Triage 2026-11-03:** Still applies: `enforce_candidate_erasure_obligation_limit()` with SQLSTATE 54000 is carried into `supabase/migrations/0001_baseline.sql:2181`.

## 2026-07-19 - Direct sourcing adapters can bypass the central recruiting policy
**Severity:** security
**File:** src/app/api/source/apify/start/route.ts:21; src/app/api/source/apollo/search/route.ts:107; src/lib/sourcing/query-policy.ts:5
**Issue:** The central query policy rejects protected traits and proxy criteria, but the direct Apify route accepts raw queries, schools, first names, and last names without invoking it; Apollo search is not bound to a verified approved requisition.
**Repro/evidence:** Static route tracing found no call from either direct adapter to the canonical policy/requisition authority. The Apify UI exposes the same name filters. A user can therefore reach provider side effects through a path with weaker policy controls than the canonical agent.
**Suggested fix:** Enforce one server-side prohibited-criteria and approved-requisition check before every provider call, with an immutable policy receipt.
**Status:** open; real sourcing remains NO-GO
**Triage 2026-11-03:** Partly addressed, needs re-audit before closing: the Apollo route was removed by the demo cleanup (c79dcaa8), and `src/app/api/source/apify/start/route.ts` now loads the campaign and calls `clearDiscoveryCriteria` (`src/lib/sourcing/provider-egress.ts`, f5f1e47f) before `begin_provider_run`. Confirm that clearance applies the prohibited-criteria policy to `schools`/`firstNames`/`lastNames`.

## 2026-07-19 - Enrichment spend authority is defined but not used by application calls
**Severity:** correctness
**File:** supabase/migrations/0044_sourcing_enrichment_authority.sql:138; src/app/api/source/enrich/route.ts:42
**Issue:** Migration 0044 defines database claim, settle, and release authority, but no application source calls those RPCs. The enrichment route treats the client budget as a hint and caps only one request, not total workspace spend.
**Repro/evidence:** `rg` found no `claim_enrichment_budget`, `settle_enrichment_spend`, or `release_enrichment_claim` call under `src`. Repeated or parallel requests across app instances can exceed a tenant budget while each individual request remains within ten units.
**Suggested fix:** Wrap every paid enrichment/provider call in durable database claim, settle, and release operations and test concurrent multi-instance replays against a hard ceiling.
**Status:** open; paid enrichment remains NO-GO
**Triage 2026-11-03:** Possibly fixed, needs re-audit before closing: `src/app/api/source/enrich/route.ts` now goes through `orchestrateEnrichment`, and `src/lib/enrichment/orchestrator.ts` calls `claim_enrichment_budget`, `settle_enrichment_spend` and `release_enrichment_claim` (8bda0689, 29967509). The concurrent multi-instance ceiling test has not been confirmed.

## 2026-10-27 - Azure managed PostgreSQL is not a drop-in target for the current bootstrap
**Severity:** spec-mismatch
**File:** docker/bootstrap/supabase-admin-reconciliation.sql:18; docs/adr/0001-local-runtime-and-azure-target.md
**Issue:** The bootstrap explicitly requires supabase_admin with rolsuper=true. Azure PostgreSQL Flexible Server administrators are not true PostgreSQL superusers. Copying this bootstrap into a managed-database Terraform target would not work.
**Repro/evidence:** Compared the direct-superuser SQL guard with Microsoft's access-control documentation. ADR records a compatible initial VM/Compose pilot, an image reusable on Azure, and the authorization work required before a managed-service migration.
**Status:** open; managed-database migration intentionally deferred, no Azure resources deployed
**Triage 2026-11-03:** Deliberately deferred. The owner dropped Vercel on 2026-11-03 and will self-host later; the hosting target is not chosen yet.
