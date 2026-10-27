---
project: MSourcing / ARIA
shift: 442
agent: codex
updated: 2026-10-27
status: unified-sourcing-prepared-provider-acceptance-pending
---

# Handoff - Shift 442

## Current state

- Branch mbe-branch. Security fix 8c3376b6 is committed; the unified sourcing
  implementation follows it in this shift. Publication is recorded below.
- New primary connected campaign flow: Run sourcing -> review LinkedIn/Apify and
  GitHub queries and profile caps -> persistent source steps -> saved shortlist.
  Dashboard, Candidates and Fleet link to this same review. Intake and connected
  bulk launch prepare campaigns without starting searches.
- New migration 0003_unified_campaign_sourcing.sql adds service-owned durable
  jobs, one active run per campaign and atomic workspace/step completion. Apply
  through the normal bootstrap; do not edit/reset the baseline or existing data.
- Full required type/test gate, lint (zero errors; two existing navigation
  warnings), production build and final browser fixture smoke passed. Screenshots in
  ignored tmp/unified-review.png and tmp/unified-results.png were inspected.
- No paid source, GPT/Claude, mailbox or calendar acceptance was performed. The
  browser smoke used a local fixture backend; it is not real provider/DB proof.
- Previous f97f203d CI: Quality, audit, DB security, secret scan and CodeQL passed;
  Local Docker demo failed waiting for browser sign-in navigation. The next CI
  run includes safe auth status/path/cookie-metadata diagnostics and direct API
  login before the browser. See local-demo-runtime issue 06.

## Done this shift

1. Persistent LinkedIn-first source plan, independent GitHub step, 1-20 profiles
   per selected source, editable role-bound queries, explicit missing-key errors.
2. Compare-and-swap leases protect async paid starts. Lost/ambiguous actor starts
   are never retried automatically. Refresh/restart recovers the stored binding.
   Transient status/data failures keep that same binding for a safe resume.
3. Actual found/added/duplicate/excluded counts, partial results, source history,
   shortlist source links/observed skills/missing data/next action. No fake live
   progress or model requirement. Original operator resumes; admin can close an
   orphaned run. Closing does not abort an already launched Apify actor.
4. Candidates and completion persist together with current role, campaign basis
   and workspace version checks. Concurrent edits are preserved and deduped
   again; erased identities are excluded through the existing SQL authority.
5. Fixed the legacy Apify status ownership/dataset substitution gap. Normalized
   LinkedIn/GitHub URL variants for rerun dedupe. Rejected invalid LinkedIn links.
6. Fixed baseline provider quota's undeclared controls reference through forward
   migration, retaining an independent 100/day workspace reservation ceiling.
7. Removed fabricated profile evidence: missing Apify headline stays unknown;
   GitHub query-language filters no longer become observed person skills.
8. Added runtime/API fixture suites and actual SQL scenarios to the existing
   database security job. Updated public context and changed-workflow contracts.
   Findings and feature/acceptance tracking are committed with the implementation.

## Blockers

- Docker/WSL is absent and MUST NOT be installed on this Windows machine. Owner
  tests Docker on another machine. No new local Docker receipt is claimed.
- The previous Docker browser auth acceptance failed at waitForURL (30 seconds).
  Inspect the next CI's safe diagnostics rather than guessing or weakening gates.
- Real Apify acceptance requires the owner's configured account and an explicitly
  reviewed small profile cap. No provider key or paid call was used here.
- Azure managed PostgreSQL remains a separate design gap (true superuser owner
  reconciliation). No cloud resource/deployment was changed.

## Next steps

1. Verify the final published tip's CI, especially Local Docker demo and the
   schema-authority-db/unified-sourcing SQL scenario. Record its exact outcome.
2. On the owner's other machine, update mbe-branch, preserve db_data/app_config,
   rebuild the normal Docker stack and let bootstrap apply migration 0003.
3. Sign in and check Settings -> Workspace -> Check connections. Connect Apify
   in Settings -> API Keys; no LLM is necessary for this sourcing slice.
4. Open a reviewed active campaign, Run sourcing, select LinkedIn + GitHub, inspect
   each query and use a low cap (e.g. 3). Refresh while Apify processes; check saved
   profiles and real counters, then rerun to verify identity dedupe.
5. If a start is uncertain, inspect Apify's console before a new launch. Resume
   polls the existing binding; Close run does not stop a remote actor.
6. Once the real source receipt is green, continue candidate qualification,
   contact enrichment and human-reviewed outreach. Hosted GPT/Claude is deferred
   until requested; do not start a local LLM/infrastructure tangent.

## Decisions made (don't relitigate)

- Local connected Docker first, with five permanent services and two init jobs.
  Unified sourcing adds no container/worker/framework. Page-driven advancement
  pauses subsequent steps on navigation; an existing remote actor can continue.
- No Docker/WSL installation on this Windows session; actual runtime test elsewhere.
- Hosted GPT/Claude later for demo simplicity; sourcing selection is deterministic
  and independent of a model deciding whether to call LinkedIn.
- Never automatically retry an ambiguous paid start; no silent source fallback.
- Preserve relay/state folders, baseline migrations, stateful volumes and stable
  encryption keys. Human approval remains required before outreach.
- No Azure deploy, Fly/Vercel work or external agent framework migration.

## Watch out

- Existing workspaces need migration 0003 and a rebuilt app/migration metadata.
  Current SQL test is part of the DB gate, not a claim of a Windows DB execution.
- Leases last three minutes. An interrupted start may wait for lease expiry before
  becoming Needs review. Its paid actor must never be started automatically again.
- Candidate sourceRunId identifies exact run results; names alone are not dedupe
  identities. Missing email/title/tenure must not be fabricated from the brief.
- Local test logs: TEMP/aria-unified-*.log. Ignored tmp contains fixture UI helpers,
  screenshots and a redacted staged Gitleaks report; no relay secrets are recorded.
