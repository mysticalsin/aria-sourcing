---
project: MSourcing / ARIA
shift: 443
agent: codex
updated: 2026-10-27
status: unified-sourcing-verified-paid-provider-smoke-pending
---

# Handoff - Shift 443

## Current state

- Branch mbe-branch. Runtime/test code tip 43b9db34 is committed and pushed.
  This wrap-up changes only relay/spec/issue documentation after that code tip.
- CI 40499885119 on 43b9db34 completed SUCCESS: Quality (types, tests, lint,
  production build), dependency audit, secret scan, Database security, Local
  Docker demo and Release gate. CodeQL 40499885130 also completed SUCCESS.
  https://github.com/mysticalsin/aria-sourcing/actions/runs/40499885119
- Actual Linux PostgreSQL tests executed the unified-sourcing scenario. Actual
  Docker/browser acceptance passed clean startup, readiness, login, UI campaign
  and candidate creation, encrypted credential storage, refresh, stack restart,
  fresh login, restored state and credential decryption. externalProviderCalls=0.
  Earlier 0be6b3ca CI 40498433529 independently passed the same complete gates.
- Local required gate, lint (zero errors; two existing navigation warnings),
  production build and compiled browser fixtures passed. 1280x720 smoke covered
  source review, limits, one launch, refresh recovery, preview confidentiality,
  intake creation and normally typed manual-candidate creation without force clicks.
- No Docker/WSL installation occurred on this Windows machine. Docker ran in CI
  Linux, honoring the owner's instruction to test it on another machine.
- No real Apify/GitHub candidate sourcing, LLM, mailbox or calendar acceptance was
  performed. Discovery browser/API tests used fixtures. A real paid-provider smoke
  test with an owner-reviewed small limit is the remaining recruiting acceptance.

## Done this shift

1. Unified connected campaign Run sourcing: LinkedIn/Apify first, optional GitHub,
   editable role-bound queries, explicit 1-20 profile cap per selected source,
   explicit missing-key errors, no LLM prerequisite or silent source fallback.
2. Durable campaign_sourcing_jobs steps with one active run per campaign,
   compare-and-swap leases, recoverable provider bindings and actual per-source
   found/added/duplicate/excluded counts. Unknown paid starts never auto-retry.
3. Atomic candidate/step persistence checks current role, campaign basis and exact
   workspace version. Concurrent edits trigger remapping/dedupe; erased identities
   are excluded using the existing SQL authority. Partial source failures preserve
   successful results. Exact run identity is stored in candidate.sourceRunId.
4. Dashboard, Candidates and Fleet enter the same review. Connected intake and
   bulk launch prepare campaigns without automatic source calls. Synthetic
   showcase flows remain separate and offline-safe.
5. Shortlist preview includes observed skills, unknown/contact gaps and next
   action. Identity and source links honor existing confidentiality/outreach-purpose
   policy. Preview UI and unit regressions verify masking.
6. Security fix 8c3376b6 binds legacy Apify status to workspace-owned run/dataset.
   Follow-up 0be6b3ca uses migration 0004's scoped service-only RPC, preserving
   private provider-table ACLs instead of granting direct service table access.
7. Migration 0003 fixes the baseline provider quota's undeclared controls reference
   through an independent 100/day workspace cap. Baseline SQL stays untouched.
   LinkedIn/GitHub URL variants dedupe; invalid LinkedIn URLs are excluded.
8. Unknown Apify headline stays unknown. GitHub language query filters no longer
   become observed person-language evidence. Full-time is explicit in the bundled
   intake JD, so the real readiness gate accepts the advertised complete sample.
9. Tall modals portal to body, bound height and scroll internally. Stable focus
   handling permits normal typing. This fixed the real Docker 720px click failure.
10. SQL fixtures set both JWT forms and prepare private rows as owner before
    asserting service-only RPC behavior. Added actual quota, replay, workspace,
    role-revocation, claim, stale-version and atomic-completion SQL scenarios.
11. Findings fixed in 56d165bf, 33fd5765, 0be6b3ca and 43b9db34 are recorded in
    codex-findings.md. Local issue/spec evidence and docs/SOURCING.md are updated.

## Blockers

- No remaining implementation or CI blocker in this slice.
- Real Apify account acceptance is not yet performed; the owner must connect the
  account in Settings and explicitly select a small profile limit before billing.
- Azure managed PostgreSQL remains a separate deferred bootstrap-design issue:
  existing owner reconciliation requires a true superuser. No cloud resource,
  deployment, production database or real outbound message was changed.

## Next steps

1. On the owner's Docker machine, update mbe-branch without discarding local work.
   Follow DOCKER.md and rebuild the app; bootstrap applies migrations 0003/0004.
   Preserve db_data and app_config together. Never reset volumes to fix startup.
2. Sign in; check Settings -> Workspace -> Check connections. Connect Apify in
   Settings -> API Keys. No GPT/Claude/local-model setup is needed for this slice.
3. Open a reviewed active campaign -> Run sourcing. Select LinkedIn + GitHub,
   inspect each query and choose a small cap (e.g. 3). Start the reviewed search.
4. Refresh during processing; verify the same run resumes, candidates retain
   source links and observed evidence, missing data stays unknown, and counters
   persist. Rerun to verify URL/email identity dedupe. Record the real receipt.
5. If a start is uncertain, inspect Apify's console before a new launch. Resume
   polls the existing binding; Close run does not abort an existing remote actor.
6. Next recruiting slice: qualification/contact enrichment and human-reviewed
   outreach. Hosted GPT/Claude configuration remains deferred until requested.
7. A relay-only documentation push follows verified code 43b9db34; check any new
   documentation-tip CI separately rather than calling a queued run successful.

## Decisions made (don't relitigate)

- Retain five permanent app/Supabase services and two ordered init jobs. This
  sourcing slice adds no container, background worker or external agent framework.
- Page-driven advancement pauses subsequent steps on navigation; an existing
  Apify actor can continue remotely, and the stored run resumes on return.
- No automatic retry of an ambiguous paid start and no silent source fallback.
- Hosted GPT/Claude later; local-model acceptance deferred. Human approval remains
  mandatory before outreach. No automatic LinkedIn login/session automation.
- No Docker/WSL installation in this Windows session; runtime test elsewhere.
- Preserve relay/state folders, baseline migrations, persistent data and stable
  encryption keys. No Azure deployment, Fly/Vercel or framework migration.

## Watch out

- Existing workspaces require forward migrations 0003/0004 and a rebuilt app with
  current migration metadata. Never edit the baseline or broaden provider ACLs.
- Leases last three minutes. An interrupted start waits for expiry before Needs
  review; do not start another paid actor automatically. Original operator resumes;
  an administrator may close an orphaned run after the claim finishes/expires.
- Mode-based masking is presentation policy; keep the existing explicit identity
  reveal/purpose flow when extending previews. Do not render raw identity URLs
  while confidentiality is enabled for a newly sourced candidate.
- Local logs: TEMP/aria-unified-*.log; ignored tmp contains fixture browser helpers,
  screenshots and redacted scan receipts. No secrets are recorded in the relay.
