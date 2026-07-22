# Adaptive sourcing and Graphify operations

This runbook operates ARIA's evidence-grounded sourcing lessons. Graphify is an
internal aggregate-analysis worker. It is not an LLM provider, does not invent
role needs, does not search for candidates, and has no authority to promote a
lesson or contact a person.

## Authority model

1. A recruiter launches sourcing from a persisted campaign whose title,
   required skills, location, seniority, and role description passed readiness
   and prompt-injection checks.
2. `begin_sourcing_run` atomically claims an idempotency key and daily workspace
   and user quota before any provider or search request.
3. The server permits only reviewed, role-bound GitHub queries. Every successful
   provider execution produces an aggregate query receipt.
4. `complete_sourcing_run` revalidates tenant and campaign authority and records
   the final outcome. Candidate results are not returned to the browser unless
   this receipt succeeds.
5. A recruiter may mark a receipt `useful`, `dead_end`, or `needs_correction`.
   The feedback endpoint accepts only the server-issued opaque receipt ID.
   Successful, unreviewed receipts are reloaded from database authority after a
   page refresh and remain scoped to the recruiter, workspace, and campaign;
   failed searches never become feedback prompts.
6. After the database evidence thresholds are met, Graphify groups redacted
   aggregate lessons. The worker returns a digest and cluster reference only.
7. A different admin explicitly reviews the exact lesson version. Only a
   `promoted` decision makes that lesson eligible for a later matching role.
8. Migration `0054` may consume a current promoted lesson only to select or
   reorder the finite same-page GitHub query variants already derived by the
   server for that exact role and workspace. It freezes the lesson, review,
   export, and query snapshot before egress. Learning cannot add a need,
   provider or credential authority, candidate fact, or delivery permission.

Graphify input excludes names, profile URLs, emails, phone numbers, raw provider
IDs, raw search queries, and campaign text. It contains opaque lesson IDs,
one-way role/query fingerprints, the provider category, aggregate outcome
counts, independent evidence counts, and the optimistic authority version.

## Required release artifacts

- Migration `0027_sourcing_learning_authority.sql` applied through the protected
  migration ledger.
- A Graphify worker image built from `workers/graphify-lessons/Dockerfile` and
  stored by immutable registry digest.
- Chainguard Python builder digest
  `sha256:5233e2961d13485e80cd9adc5515cf4242dc43d23045a6540466eee82764879b`
  and minimal runtime digest
  `sha256:2c6a2e8bdeb1336cd8545d3586d1c1e5b4f7564ef00924b0447ebfbe57a549ee`.
- Graphify source commit
  `94d3099540550d58dd121ec3e67cf93e80364079` (`graphifyy` 0.9.14).
- `requirements.lock` hash verification, `pip check`, image scan, SBOM, and
  provenance tied to the release SHA.
- A dedicated scheduler or operator identity that can run Docker but cannot
  approve lesson promotion.
- A completed `sourcing_graphify_exports` row containing the exact input digest,
  graph bytes, manifest, image digest, and Graphify commit. A lesson cannot be
  attached to an uncompleted or mismatched export.

The application does not need Graphify to source candidates. If the worker or
review path is unavailable, an independently activated GitHub sourcing path can
continue using campaign evidence and server-derived queries without adaptive
lessons.

## Verification before activation

Run from the accepted release SHA:

```bash
npm run typecheck
npm test
npm run test:db-sourcing-learning
npm run test:graphify-learning
```

`test:graphify-learning` builds the exact worker and runs it with no network,
a read-only root filesystem, no Linux capabilities, no privilege escalation,
and bounded CPU, memory, and process counts. A registry, package-index, or
GitHub timeout is a failed release gate, not permission to use an unpinned image.

## Pin and enable the worker

The database rejects artifacts from any image other than the configured digest.
Use optimistic versioning and an exact confirmation string:

```bash
export SOURCING_LEARNING_ENABLED='true'
export SOURCING_LEARNING_EXPECTED_VERSION='1'
export SOURCING_LEARNING_WORKSPACE_DAILY_LIMIT='100'
export SOURCING_LEARNING_USER_DAILY_LIMIT='25'
export SOURCING_LEARNING_MIN_EVIDENCE_RUNS='2'
export SOURCING_LEARNING_LESSON_TTL_DAYS='90'
export SOURCING_LEARNING_REQUEST_ID='approved-change-record'
export SOURCING_LEARNING_CONFIRM='configure:approved-workspace-uuid:true:1:approved-registry/aria-graphify-lessons@sha256:approved-image-digest'
npm run configure:graphify-learning
```

The same command with `SOURCING_LEARNING_ENABLED=false`, the current expected
version, and a matching confirmation is the kill switch.

## Attach a Graphify artifact

Set secrets in the operator environment, never in the command history or Relay
Baton. `GRAPHIFY_LESSONS_IMAGE` must include an immutable digest.

```bash
export SUPABASE_URL='https://approved-project.example'
export SUPABASE_SERVICE_ROLE_KEY='set-through-secret-manager'
export SOURCING_LEARNING_WORKSPACE_ID='approved-workspace-uuid'
export SOURCING_LEARNING_ADMIN_ID='operator-admin-uuid'
export GRAPHIFY_LESSONS_IMAGE='approved-registry/aria-graphify-lessons@sha256:approved-image-digest'
npm run run:graphify-learning
```

Expected terminal status is `attached_for_human_review`. Before attachment, the
operator independently hashes the graph and the database durably verifies its
input, graph, manifest, approved image digest, lesson IDs, and optimistic
versions. `learning_disabled` and
`no_eligible_lessons` are safe no-op statuses. The command cannot promote a
lesson. Preserve the JSON status, release SHA, image digest, and worker manifest
in the protected release evidence bundle.

## Human review and promotion

Use an admin who did not create the evidence being reviewed. Confirm the exact
lesson ID, database version, artifact digest, Graphify commit, campaign count,
run count, and recruiter feedback before promotion.

```bash
export SOURCING_LESSON_ID='lesson-uuid'
export SOURCING_LESSON_EXPECTED_VERSION='3'
export SOURCING_LESSON_DECISION='promoted'
export SOURCING_LESSON_REASON='reviewed_useful'
export SOURCING_LESSON_REQUEST_ID='change-ticket-or-review-id'
export SOURCING_LEARNING_CONFIRM='review:lesson-uuid:promoted:3'
npm run review:graphify-learning
```

Use `suspended` with `quality_hold`, `security_hold`, or `operator_disabled` when
evidence is questionable. Use `retired` with `expired` or `superseded` when a
lesson should no longer influence a role.

## Kill switch and recovery

An admin can run `npm run configure:graphify-learning` with learning disabled
and an exact confirmation. Disabling immediately suspends promoted
lessons and causes export and retrieval to return `learning_disabled`. Sourcing
itself stays available without learned lessons.

After an incident:

1. Disable learning and retain the affected run, feedback, review, and release
   receipts.
2. Revoke the worker operator identity and quarantine the image digest.
3. Inspect aggregate manifests and database audit history. Do not export
   candidate data to Graphify for diagnosis.
4. Suspend or retire affected lessons with a named reason and exact version.
5. Rebuild from an accepted source SHA, rerun every gate above, and require a new
   independent review before re-enabling learning.

The cleanup RPC bounds expired run and feedback data. It must run from the same
protected scheduler used for other authority cleanup jobs. Active promoted
evidence is retained until the lesson is suspended or retired and its retention
requirements are satisfied.
