---
project: MSourcing / ARIA
shift: 446
agent: codex
updated: 2026-10-27
status: qualification-implemented-local-and-ci-green
---

# Handoff - Shift 446

## Current state

- Branch mbe-branch. Product commit 29967509 is pushed and matches the remote.
- The existing candidate list/drawer now guides evidence review, verified facts
  and contact, explicit processing-basis recording, enrichment and draft review.
  Operator guide: docs/CANDIDATE-REVIEW.md, linked from SOURCING and the other-
  machine setup checklist. Spec: .scratch/candidate-qualification/spec.md.
- Local typecheck, typecheck:tests, complete npm test lifecycle, lint and production
  build passed. Lint has only the two pre-existing topbar/seat-card navigation
  warnings. Final focused regressions also passed after batch-save serialization
  and workspace-change guards. No dependency, schema or infra change.
- Edge browser fixture journey passed at 1280x720: fit review, full enrichment
  arrays, honest unknown years, manual verified experience, assisted LinkedIn
  draft without email, verified email, explicit basis, draft review and refresh.
  No force clicks, real provider starts or outbound messages. The fixture starts
  a temporary local backend/app; both were stopped after the check.
- CI 40540178013 completed SUCCESS for exact product commit 29967509: Quality,
  Database security, Local Docker demo, dependency audit, secret scan and Release
  gate. CodeQL 40540177843 also completed SUCCESS.
  https://github.com/mysticalsin/aria-sourcing/actions/runs/40540178013
- Real Apify retrieval remains blocked by the earlier actor allowance refusal.
  The application/key vault still runs on the owner's OTHER local machine;
  nothing has been deployed to Azure or configured into that remote workspace.

## Done this shift

1. Added shared candidate-review next actions with observed/missing requirements
   and explicit unknown experience. Added the list column and drawer guidance.
2. Added persisted operator evidence editing for contact, observed skills and
   verified numeric experience, with source notes, validation, duplicate identity
   refusal and score/metrics recomputation. No automatic parsing of work dates.
3. Found/fixed the dead-end contact-basis journey: live candidates could not record
   the receipt required by approval, while the passport inferred a basis from
   provenance. The passport now reflects only complete operator receipts, and a
   separate explicit selection/reference action saves the decision.
4. Hardened /api/source/enrich: accepts candidateId/want/budget hint only; loads
   candidate/campaign from the authenticated workspace; checks source role,
   origin, active reviewed brief, exclusions and evidence again after the call.
   Unknown years remain unknown. Scores use the saved brief/weights.
5. Preserved experience/education/languages in the patch. Store saves before
   provider access and verifies result persistence before success. Concurrent
   evidence/identity edits, erasure and session switches cannot overwrite newer
   state. Batch enrichment serializes saves within the current store; it is not
   cross-process paid-request idempotency.
6. Added explicit paid enrichment review and actionable missing-key/identity and
   provider-failure outcomes. Drafting selects assisted LinkedIn when no email;
   draft functions honor role, active campaign, exclusions and channel details.
   Missing personalization evidence is shown as missing, not invented fit text.
7. Recorded findings in _relay/codex-findings.md, added route/domain/store/SSR
   regressions to the canonical manifest, updated the action contract fixture,
   and documented the remaining synchronous recovery limit in issue 02.
8. Exact supplied account/token scans of the Git index passed. Gitleaks found no
   leaks in introduced content. A raw full-patch stdin scan flagged only a
   REMOVED synthetic provider-ID fixture; no scanner exception/rule was added.
9. Archived shift 445 before replacing the baton. The final documentation-only commit
   follows the product commit; any docs-tip CI is a separate run.

## Blockers

- External live acceptance: the previous Apify actor returned SUCCEEDED with
  "free user run limit reached" and zero profiles. Authentication alone passed.
  Check actor/account allowance before any new paid start. No new provider test
  was attempted in this shift; raw private receipt remains outside Git.
- Other-machine setup and real profile import/restart/dedupe acceptance remain
  owner actions in docs/LOCAL-SOURCING-TEST.md.

## Next steps

1. Product CI and CodeQL are verified green above. The final documentation-only
   wrap-up commit triggers separate runs; do not present those as checked.
2. On the other machine, update mbe-branch normally, preserve db_data/app_config
   and the existing encryption key. Follow LOCAL-SOURCING-TEST.md, then
   CANDIDATE-REVIEW.md for the actual candidate journey.
3. Resolve discovery actor allowance before a paid start. Enrichment uses the
   separate dev_fusion/linkedin-profile-scraper actor and requires its own access/
   owner approval. No billing or subscription changes were authorized/performed.
4. Next engineering slice: durable enrichment recovery/idempotency across tabs,
   server interruptions and operators; see candidate-qualification issue 02.
   It needs its own forward migration and PostgreSQL concurrency acceptance.
5. GPT/Claude configuration can follow for hosted drafting, then real mailbox/
   approval/delivery acceptance as a separate explicit test. Template drafts
   already work without an LLM. No outreach was sent here.

## Decisions made (don't relitigate)

- No private account identifier, token or raw provider receipt in Git, env
  examples, tests, logs or relay. Current DPAPI store under LocalAppData/ARIA is
  external and not portable to the other machine. Apify stays workspace-vault
  authority, no environment fallback. Format check is not a live provider test.
- No Docker/WSL installation here, Azure deployment, model setup or paid calls.
  Keep five permanent containers/two init jobs and stable paired volumes/key.
- Qualification uses existing scoring/enrichment/consent/approval workflows, not
  a parallel pipeline. Source/public provenance never implies contact permission.
- A verified profile/contact fact is distinct from explicit basis selection and
  exact-message human approval. None of these actions sends a candidate message.
- No automatic paid retry after uncertainty, lost responses, provider refusal or
  failed saving. Keep failures/partial results honest and unknown fields unknown.

## Watch out

- Enrichment is still synchronous. Keep the page open until saving completes;
  closing it can lose the response. Local store serialization is not a durable
  cross-tab lease. Do not claim campaign discovery recovery covers enrichment.
- User-supplied budget hints/profile caps are not currency spending guarantees.
  USD0.10 belonged only to the earlier standalone check; actual invoice unaudited.
- API change: /api/source/enrich uses candidateId rather than a browser profile.
  All repository callers/tests were updated. No raw key is accepted or returned.
- Local logs: ignored tmp/qualification-*. Browser screenshots contain fixtures
  only and remain ignored. Raw real candidate screenshots/receipts stay private.
- Genuine provider no-data success stays distinct from account/refusal/error.
  Existing human approval and real delivery checks remain authoritative.
