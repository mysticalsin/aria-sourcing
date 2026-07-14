---
project: MSourcing / ARIA
shift: 39
agent: codex-gpt-5
updated: 2026-07-14 14:02 EDT
status: source-green-frameworks-integrated-production-no-go
---

# Handoff - governed frameworks and real sourcing are source-green; production activation is blocked

## Current state

- Work only in `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: `main`.
- Base at shift start: `ac66f4d05327d98048041c23751006a16904d700`.
- The commit containing this baton is the local source of truth after shift
  close. Run `git rev-parse HEAD` and `git status --short --branch` before
  doing anything.
- Do not touch, reset, clean, or switch the original OneDrive checkout. It is a
  separate dirty worktree owned by concurrent activity.
- Public remote reads at 14:02 EDT:
  - `origin/main`: `bc4633663c9a7ba3b3b4d52b7f3654384e471cb6`;
  - `origin/vercel-demo`: `14f76f1d351f97bff1c25cfba9be97355bd91851`.
- Local source is a fast-forward descendant of public `main`, but credential
  rotation and the authority of prior remote writes are not proven. Do not push
  with an exposed or unproven credential.
- Source verdict: GO for local commit and review.
- Protected release verdict: NO-GO.
- Production verdict: NO-GO.
- Current public app readiness is HTTP 200, build
  `d2040b534177f5bd2abb28f22de19af57b58dc3a`, migration
  `0023_conversation_identity.sql`, with reported database, auth, queue,
  migration, and release identity true.
- Current Kong `/healthz` is HTTP 200. Unauthenticated Kong Auth and REST
  correctly return HTTP 401.
- Local migration tip is
  `0031_orphan_owner_recovery_authority.sql`. Production is eight migration
  files behind the reviewed source.
- Canonical local application gate is 164 chained commands: 36 pretest plus
  128 application commands.
- Exact reviewed framework source pins:
  - DeerFlow: `fabadae4168db81f0eaaf62f209050f978e2f691`;
  - Flowise: `bb773ffa710bd22639c4ba2643413a0ea2b679d3`;
  - Graphify: `94d3099540550d58dd121ec3e67cf93e80364079`,
    package 0.9.14.
- Detailed plan:
  `/Users/tony/.codex/plans/msourcing-aria-remaining-campaign-blockers-20260712.md`.
- Audit ledger: `_relay/codex-findings.md`.
- Prior baton archive:
  `_relay/archive/2026-07-14-1402-codex-gpt-5.md`.
- Graph navigation was attempted first, but
  `graphify-out/graph.json` and `graphify-out/wiki/index.md` are absent.
  Raw source was used only after that recorded fallback.

## Done this shift

- Replaced framework-inspired claims with actual pinned framework integration:
  - Flowise is a private authoring/import dependency. ARIA accepts only a
    strict bounded workflow vocabulary and compiles it into immutable ARIA IR;
  - a separate admin must approve the exact imported workflow hash;
  - DeerFlow runs only an approved workflow and receives opaque authority,
    never provider credentials or candidate records;
  - DeerFlow may propose one exact reviewed GitHub query and a report action;
  - ARIA owns provider calls, quota, idempotency, persistence, learning
    receipts, candidate DTOs, and every effect.
- Closed the browser-owned Flowise authority path:
  - agent spec create/update no longer accepts external Flowise IDs;
  - the public Flowise proxy performs no upstream fetch;
  - private admin import revalidates authority after Flowise egress;
  - arbitrary code, HTTP, MCP, tool, disconnected, duplicate, and cyclic nodes
    fail closed.
- Added model gateway and adapter controls:
  - only the exact unavoidable pinned DeerFlow
    `review_skill_package` schema is recognized and stripped;
  - all other tools and all returned tool/function calls are rejected;
  - only one exact non-streaming provider/model request is allowed;
  - prompt, response, concurrency, and request-rate bounds are enforced;
  - streamed overflows cancel the upstream reader;
  - readiness authenticates the gateway and proves the exact provider/model.
- Added database authority:
  - 0028 makes normalized message writes service-owned and owner-binds
    conversations to durable sent receipts;
  - 0029 adds approved workflow versions, framework instances, run claims,
    immutable provenance, step/terminal receipts, and one-time sourcing
    capabilities;
  - 0030 adds replay-safe prepare/confirm/activate provisioning plans with
    exact origin, image, source, isolation, provider, model, credential, and
    control-version authority;
  - 0031 adds approval-bound orphan-owner recovery with pre-binding password
    login proof, request markers, per-attempt cleanup IDs, append-only receipts,
    and service-only database mutation.
- Reconciled protected database recovery with the complete 0031 schema:
  - canonical public-schema SHA updated;
  - exact table inventory and function allowlists updated;
  - filename plus SHA migration ledger remains authoritative;
  - empty, legacy, complete, replay, rotation, and cross-owner cases are tested.
- Made adaptive sourcing real and bounded:
  - cloud LLM configuration is not required for canonical deterministic
    GitHub sourcing;
  - incomplete needs and missing reviewed queries fail before provider work;
  - no model response can substitute for a real provider result;
  - zero results remain an honest empty result;
  - Graphify receives aggregate/redacted evidence only, runs without network,
    and cannot invent needs, people, or queries;
  - only a separate human-reviewed lesson can reprioritize an existing exact
    reviewed GitHub query for the same role.
- Closed demo/localStorage candidate PII:
  - no-Supabase mode defaults to the synthetic Talent Pool;
  - explicit GitHub, web, manual, Apollo, Seamless, Sillage, live-agent, and
    enrichment paths fail before I/O;
  - both commit paths and final localStorage flush reject any non-synthetic
    candidate snapshot;
  - hydration removes legacy unsafe localStorage blobs and reseeds the demo.
- Added a controlled private Fly source deployment pack under
  `infra/agent-frameworks/fly`:
  - ten no-service apps for two databases, two Redis planes, model gateway,
    DeerFlow, Flowise, Flowise worker, and two narrow adapters;
  - no Fly Proxy services or public IP allocation;
  - separate state volumes and independent secrets;
  - non-root wrappers and private authenticated identity probes;
  - `prepare -> confirm -> deploy` operator with a 15-minute hash-bound
    approval, staged stdin secret import, replay validation, and exact receipt;
  - exact final image digest, cosign signature, SPDX SBOM, SLSA provenance,
    source commit, and zero-high/critical Trivy gates;
  - seven Bake wrapper targets with SBOM and provenance attestations.
- Hardened cleanup and release verification:
  - privileged cleanup responses are content-type checked and bounded before
    parsing;
  - release proof requires sourcing and framework retention counters;
  - provisioning replay is bound to the exact Supabase origin and can recover
    lost configure/activate responses without repeating effects.
- Closed stale documentation:
  - inventory and data-flow docs no longer describe production sourcing as
    mock-only;
  - status, README, runbook counts, and migration tip are derived from current
    package and migration truth.
- Four independent QA lanes reviewed owner recovery, model gateway/release,
  provisioning/concurrency, and final full-stack/privacy behavior. Every
  concrete source defect is recorded in `_relay/codex-findings.md`.

## Verification evidence

- Final unchanged functional snapshot exited 0:
  - `npm run typecheck`;
  - `npm run lint`;
  - `npm run test:security`;
  - `npm test`, all 164 chained commands;
  - `npm run build:isolated`, clean install and Next.js 16.2.10 production
    build with 62 generated static pages and every dynamic route;
  - `npm audit --offline --audit-level=moderate`, zero vulnerabilities;
  - `gitleaks dir . --no-banner --redact --verbose`, no leaks;
  - `git diff --check`.
- Framework/Fly aggregate: `npm run test:agent-framework-adapter`, 42/42.
  This includes all ten `flyctl config validate` checks and nine Fly operator
  tests.
- Framework application aggregate: `npm run test:agent-framework`, exit 0.
- Deploy contract: 133/133. Release contract: 132/132.
- Exact Graphify gate:
  `npm run test:graphify-learning`, exact-runtime pass, no-network pass,
  deterministic graph pass, receipt pass.
- Exact Fly database recovery gate:
  `npm run test:fly-db-volume`, exit 0, including unsafe-root and PGDATA-only
  rejection, approved legacy cutover/recreate, two restarts, partial/ambiguous
  layout blocks, operator-history protection, and recreate without init
  secrets.
- Restricted database owner gate: `npm run test:db-privileges`, exit 0 with
  restricted direct postgres, direct supabase_admin, cross-owner denial,
  rotation, idempotence, read-only preflights, approved baseline, exact ledger,
  and no secret leak.
- Framework database gates: `npm run test:db-agent-framework`, authority and
  provisioning pass.
- Conversation, sourcing-learning, and owner-recovery database gates pass.
- Owner recovery operator plus real PostgreSQL result:
  exact-only topology, confirmed-email local auth, active non-banned/non-deleted
  identity, workspace/profile/domain CAS, preserved state, two-field mutation,
  append-only receipt, exact replay, service-RPC-only privilege.
- Live checks at shift close:
  - app `/api/ready`: HTTP 200 on build `d2040b...`, migration 0023;
  - Kong `/healthz`: HTTP 200;
  - unauthenticated Kong Auth/REST: expected HTTP 401.

## Blockers

1. Production is not running this source. It reports build `d2040b...` and
   migration 0023 while local source reaches 0031.
2. None of the ten framework Fly apps has been created or deployed. No
   production manifest, approval, receipt, private readiness, restart, restore,
   or campaign canary exists.
3. The recorded Kimi provider credential returns HTTP 402. DeerFlow readiness
   must remain red until an approved funded provider/model succeeds through the
   authenticated private gateway.
4. Upstream DeerFlow and Flowise inputs include mutable base tags. A protected
   runner must resolve and attest bases, build final wrappers, sign final
   digests, publish SBOM/provenance, and pass Trivy. `cosign`, `trivy`, and
   `syft` are not installed in this workspace.
5. Private Fly ingress is specified, but gateway-only outbound egress is not
   enforced or tested. Private 6PN ingress does not deny Internet egress.
6. The source stateful framework topology is one Machine and one volume per
   store. PostgreSQL HA, accepted RTO/RPO, timed snapshot restore, and failure
   injection are not approved.
7. Flowise private administrator bootstrap, workspace binding, least-privilege
   API key, readiness sentinel, tenant-isolation evidence, and commercial
   entitlement are not complete.
8. `production-readiness/AI_GOVERNANCE_GATE.md` remains NO-GO. AI
   Compliance, Legal/DPO, CTO/model owner, DPIA/FRIA, independent validation,
   fairness/drift/challenger monitoring, incident evidence, and exact
   model/vendor approvals are missing.
9. Previously exposed GitHub, Fly, and ElevenLabs credentials have open
   rotation findings. Prior remote-actor provenance is unproven. Do not push or
   deploy with those credentials.
10. The local candidate has no exact-SHA GitHub CI, CodeQL, protected-environment
    approval, promoted image, or deployment receipt.
11. First-admin creation, two-user isolation, approved Flowise import, real
    framework run, real GitHub campaign, feedback reload, Graphify
    export/review/reuse, real email/WhatsApp, erasure, rollback, and restore are
    not proven end to end on the live environment.
12. Broader data-protection findings remain open for provider-held records,
    normalized conversation bodies/addresses, logs, caches, backups, legal
    hold, and expiry proof. DP-8 localStorage candidate PII is fixed, but it is
    not the entire data-lifecycle gate.

## Next steps

1. Start with:

   ```sh
   cd /Users/tony/.codex/worktrees/msourcing-campaign-integration
   git status --short --branch
   git rev-parse HEAD
   sed -n '1,260p' _relay/HANDOFF.md
   rg -n '\*\*Status:\*\* open' _relay/codex-findings.md
   ```

2. Verify this shift commit is clean and contains the complete source. Do not
   discard any uncommitted files if the worktree is dirty.
3. Owner action before any write: revoke and rotate exposed GitHub, Fly, and
   ElevenLabs credentials; review repository/Fly access history; identify the
   prior remote actor; provision least-privilege protected-runner credentials.
4. Fetch public refs without force. Confirm public `main` remains an ancestor.
   Push local `main` only with the rotated credential and owner approval.
5. Require exact-SHA CI, CodeQL, dependency audit, full Gitleaks history and
   staged scan, all 164 commands, isolated build, database gates, Graphify, and
   Fly DB recovery before release promotion.
6. Close AI governance and vendor gates. Obtain written model/provider,
   Flowise entitlement/isolation, Legal/DPO, AI Compliance, Security, and
   operational-owner approvals. Do not turn off the framework kill switch
   without them.
7. In a protected runner, build the seven wrappers from
   `infra/agent-frameworks/fly/docker-bake.hcl`, resolve every final digest,
   sign it, attach SPDX SBOM and SLSA provenance with exact source commit, and
   pass Trivy with no HIGH/CRITICAL findings.
8. Enforce and test gateway-only outbound egress. Decide and document
   PostgreSQL HA plus RTO/RPO. Complete timed snapshot restore and failure
   injection before accepting stateful production.
9. Bootstrap Flowise privately, bind one workspace and sentinel, create a
   least-privilege API key, and prove tenant isolation. Configure a funded
   approved provider/model and pass authenticated gateway readiness.
10. Create an owner-reviewed manifest and execute the documented operator
    sequence:

    ```sh
    node infra/agent-frameworks/fly/operator.mjs prepare \
      --manifest /secure/aria-fly-manifest.json \
      --plan /secure/aria-fly-plan.json

    node infra/agent-frameworks/fly/operator.mjs confirm \
      --manifest /secure/aria-fly-manifest.json \
      --plan /secure/aria-fly-plan.json \
      --confirmation <reviewed-plan-sha256> \
      --approval /secure/aria-fly-approval.json

    node infra/agent-frameworks/fly/operator.mjs deploy \
      --manifest /secure/aria-fly-manifest.json \
      --plan /secure/aria-fly-plan.json \
      --approval /secure/aria-fly-approval.json \
      --receipt-dir /secure/aria-fly-receipts \
      --execute
    ```

11. Apply migrations 0028 through 0031 through the protected migration ledger,
    then deploy the exact accepted app/worker images. Verify build identity,
    migration tip, Kong, Auth, REST, queue, cleanup, framework heartbeat,
    private readiness, and rollback receipts.
12. Provision the first admin using
    `scripts/recover-orphan-workspace-owner.sh` only if the exact orphan
    topology and owner approval apply. Never put credentials in argv or Relay.
13. Run live two-user acceptance:
    - incomplete needs block with unknown facts preserved;
    - complete reviewed needs produce exact reviewed queries;
    - a separately approved Flowise workflow executes through DeerFlow;
    - DeerFlow chooses only one approved query;
    - ARIA returns only real provider-backed candidates and durable receipts;
    - zero results remain empty;
    - cross-user, cross-workspace, cross-campaign, replay, kill-switch, and role
      revocation attempts fail.
14. Run the learning proof with two successful same-role campaigns, aggregate
    feedback, no-network Graphify export, independent lesson review, and next
    exact-role query reprioritization. Prove a different role is unaffected.
15. Complete real channel acceptance, provider ambiguity reconciliation,
    retention/erasure/legal-hold coverage, restart, restore, rollback, and
    incident drills. Archive bounded receipts without candidate data or
    secrets.
16. Update this baton at every milestone or blocker. At shift end, archive it
    and rewrite a fresh snapshot before stopping.

## Decisions made (don't relitigate)

- ARIA owns authority and effects. DeerFlow orchestrates proposals; Flowise
  authors reviewed workflow IR; neither framework contacts candidates, spends,
  selects provider credentials, or writes candidate data directly.
- Actual pinned DeerFlow and Flowise runtimes are required. Framework-inspired
  naming alone does not satisfy the requirement.
- Production framework ingress is private and adapter-only. The broad upstream
  gateways are never exposed publicly.
- Flowise imports are drafts until a separate admin approves the exact hash.
- DeerFlow can select only one existing exact reviewed GitHub query. It cannot
  invent a need, query, candidate, provider, or effect.
- Canonical deterministic GitHub sourcing works without a cloud LLM. A model is
  an optional governed framework dependency, not a substitute for provider
  evidence.
- No candidate is product truth without a real provider result and durable
  database completion receipt.
- Unknown need and candidate facts remain unknown. No plausible defaults.
- Graphify is aggregate/redacted, no-network, digest-bound, and human-reviewed.
  It may reprioritize an exact reviewed query only for the same exact role.
- Demo/localStorage mode is synthetic-only. Real/manual candidate data is
  rejected before I/O and again at commit, storage, and hydration boundaries.
- Paid-provider authority is server-owned, prepare/confirm/commit, opaque,
  replay-safe, and receipt-bound.
- LinkedIn remains compliant assisted-manual unless an official signed
  integration exists. No login automation, scraping, evasion, or bypass.
- Named human approval remains the delivery authority. Framework execution has
  no delivery authority.
- Source proof, signed artifacts, protected release, and live acceptance are
  separate claims.
- No exposed or unproven credential may be reused.
- No push or production deploy is safe until credential rotation and prior
  remote-actor provenance are proven.

## Watch out

- The original OneDrive checkout is not this worktree. Do not clean, reset,
  switch, merge, or discard it.
- Claude and Codex share this integration worktree. Uncommitted content is real
  work. Check status before every edit, test, commit, push, or deploy.
- Do not put credentials, cookies, user emails, provider IDs, Machine IDs, raw
  queries, candidate data, approval material, or tokens in argv, logs, URLs,
  fixtures, Relay, Graphify artifacts, or git commits.
- Do not infer write authority from `gh auth status`, a tracking ref, a
  successful public read, or a fast-forward graph.
- Do not call the app enterprise-ready or production-ready from local source
  evidence. The live build/migration, model credit, governance, signed
  promotion, framework deployment, tenant isolation, egress, HA/restore, and
  acceptance receipts are still open.
- Keep `AGENT_FRAMEWORK_EXECUTION_ENABLED=false` and
  `AGENT_FRAMEWORK_KILL_SWITCH=true` until every activation gate is reviewed.
- Never weaken image digests, dependency hashes, secret-file rules, Gitleaks,
  signature/SBOM/provenance/scan checks, database ownership, RLS, or recovery
  preflight to make a release green.
- The canonical recovery fingerprint, table inventory, function allowlists, and
  migration ledger must move atomically with every new migration.
- Gitleaks allow comments in this shift are limited to exact environment names
  and deterministic rejection/redaction fixtures. New findings still fail.
