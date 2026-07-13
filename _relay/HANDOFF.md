---
project: MSourcing / ARIA
shift: 36
agent: codex-gpt-5
updated: 2026-07-13 02:18 EDT
status: candidate-intake-green-local-main-release-and-live-no-go
---

# Handoff - guarded candidate intake complete, provider enrichment next

## Current state

- Continue in:
  `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: `main`.
- Current verified source commit:
  `1f898138d7d8c403f8a0adfbcf10fc6bcad0244b`.
- Local `origin/main` tracking ref:
  `bc4633663c9a7ba3b3b4d52b7f3654384e471cb6`.
- Local `main` is six commits ahead of that tracking ref:
  `316aecb`, `8775096`, `1450f85`, `7327b2b`, `e070e55`, and
  `1f89813`.
- Working tree contains this Relay, findings, plan, and learning update only.
  Run `git status --short` before touching source because Claude and Codex share
  the worktree.
- Bounded source verdict through guarded GitHub/manual intake: GO.
- Release verdict: NO-GO.
- Production verdict: NO-GO.
- Detailed execution plan:
  `_relay/2026-07-12-enterprise-refinement-plan.md`.
- Adversarial audit record:
  `_relay/codex-findings.md`.
- Shift 35 archive:
  `_relay/archive/2026-07-13-0218-codex-gpt-5.md`.

## Done this shift

- Completed the first sourcing action slice in `e070e55`:
  - extracted `sourceNextBatch` into the React-free
    `src/lib/store/sourcing-actions.ts` factory;
  - enforced authoritative source permission, workspace availability, campaign
    existence and pause state, current-state dedupe, explicit commit truth, and
    positive-only source events and metric updates;
  - preserved synthetic sourcing behind its independent demo capability.
- Completed guarded GitHub and manual candidate intake in `1f89813`:
  - moved `addCandidateFromGithub` and `addCandidateManual` behind the same
    explicit factory dependencies;
  - revalidated workspace, role, campaign, pause state, latest candidates, and
    scoring weights after provider I/O;
  - required exact `github.com` profile identity, bounded response DTOs, safe
    integers and dates, canonical email and URL fields, and redacted bounded
    provider errors;
  - projected manual input through a strict allowlist with field, collection,
    URL, email, control-character, and private-network bounds;
  - prevented unknown input from overriding IDs, campaign, stage, provenance,
    source, or other authority-owned fields;
  - required an operator-selected manual lawful basis and recorded canonical
    millisecond UTC time plus `operator_selection` source;
  - added a shared fail-closed lawful-basis validator used by approval, consent
    display, and Quick Draft eligibility.
- Corrected the candidate truth model across live sourcing:
  - unknown experience is `null`, never zero or a generated fallback;
  - GitHub, Apollo, Seamless, web, Sillage, and chatbox mappings preserve
    unknown tenure and titles;
  - unknown experience, company stage, industry, location/timezone, and
    activity score neutrally;
  - region matching uses token boundaries, so `Eugene` does not match `EU`;
  - UI and prompts render unknown facts as not provided rather than fabricated
    evidence.
- Corrected multilingual outreach truthfulness:
  - missing-company greetings are grammatical in English, French, Spanish,
    German, Portuguese, Italian, and Dutch;
  - evidence-free profiles use translated generic subjects;
  - fit-style subjects and personalized greetings require a case-normalized
    intersection with the role's required skills;
  - an unrelated profile skill cannot create personalization evidence or a fit
    claim;
  - years-only profiles keep a generic subject and use only the verified tenure
    evidence.
- Added and expanded adversarial tests:
  - `tests/store-sourcing-actions.mts`: 23/23;
  - `tests/rules-confidential.mts`: 58/58;
  - `tests/mock-ai.mts`: 52/52;
  - `tests/sourcing.mts`: 48/48;
  - `tests/web-leads.mts`: 22/22;
  - `tests/scoring-metrics.mts`: 160/160;
  - `tests/roles-i18n.mts`: 17/17;
  - `tests/hermes-live.mts`: 32/32.
- Final unchanged-snapshot proof for source commit `1f89813`:
  - `npx tsc --noEmit && npm test && npm run build`: exit 0;
  - all 137 chained test commands passed;
  - `npm run lint`: exit 0 with no warnings;
  - `git diff --check`: exit 0;
  - production build compiled and generated 59/59 static pages;
  - full `npm run test:security`: green in the independent security review.
- Independent closure on working diff SHA-256
  `41688ff384b9cfdbac7247f16c634fbeb3fa272d3badc1d5af89071cee28f3d6`:
  - Senior Full-Stack Validator: GO;
  - QA: GO after finding and closing no-evidence, unrelated-skill, and
    timestamp parsing gaps;
  - Cybersecurity Director: bounded GO with no remaining P0/P1 in this slice.
- Updated the execution plan and Codex findings with exact completed evidence
  and the remaining provider-enrichment risks.
- Added the candidate-truth lesson to `_agent_state/codex/memory.json`.
- Archived shift 35 before rewriting this Baton.

## Blockers

1. **GitHub credential rotation is unproven.** A prior CLI credential was
   exposed through process arguments. Do not reuse it or authenticate until
   revocation, audit review, and least-privilege replacement are proven.
2. **The 00:24 push actor is unknown.** The local tracking ref moved to
   `bc46336`, but the actor and credential remain unknown.
3. **Current main is not pushed.** Local `main` is six commits ahead of the
   local tracking ref. Do not push until fresh credentials and remote identity
   are proven.
4. **Fly credential rotation is unproven.** Do not perform production Fly
   mutations with the previously exposed credential.
5. **Exact CI and CodeQL cause is unknown.** Runs `29221158898` and
   `29221158901` failed before meaningful execution; exact annotations need
   fresh authenticated inspection.
6. **The old release candidate is superseded.** `c3e94b2` does not contain the
   current store boundaries or guarded intake work.
7. **Fly DB recovery is still blocked by Alpine package-index networking.**
   Do not weaken the CVE patch layer or accept a stale repository bypass.
8. **Owner-controlled release settings are unverified.** Branch protection,
   protected-environment review, administrator bypass, secret scopes, and
   bundle-secret removal need current evidence.
9. **Production is behind reviewed source.** Last verified readiness reported
   build `d2040b...` and migration `0023`, not current source and migrations
   through `0025`.
10. **Enterprise behavior is not fully proven live.** Two-user browser
    isolation, real email, official WhatsApp, recovery, two restarts, first
    admin, and final campaign acceptance remain open.
11. **Paid enrichment is not server-bound to a candidate.** Apollo and
    Seamless accept client-supplied provider IDs without proving a matching
    workspace candidate before spending credits or returning contact data.
12. **Async provider handles are not bound to persistence targets.** Seamless
    and Sillage polling accept raw request IDs while the browser independently
    chooses the candidate or campaign receiving the result.
13. **Sillage returns a company-wide profile batch.** The current status route
    returns all mapped profiles and the client persists all accepted contacts
    without a per-candidate reveal decision.
14. **Remaining provider callbacks use the old effect contract.** Apollo,
    Seamless, Sillage, and sourcing-agent actions do not yet share the new
    post-I/O authority, latest-state, exact-DTO, and commit-result gates.
15. **Sourcing-agent payloads are overbroad.** The route casts opaque campaign
    and candidate records and sends more candidate context than a bounded
    dedupe and disclosure projection requires.
16. **Provider error translation is inconsistent.** Several source routes pass
    raw exception or upstream detail strings to the browser without one shared
    redaction and length boundary.

## Next steps

1. Start with the paid Apollo reveal boundary:
   - write a red route test showing an arbitrary provider ID can spend or reveal
     without a workspace candidate binding;
   - accept a canonical candidate ID, resolve the workspace-owned record
     server-side, and compare stored platform and external ID;
   - fail closed before provider I/O on missing, foreign, duplicate, or
     mismatched records;
   - return an exact bounded DTO and never expose upstream error text;
   - require security, full-stack, and QA closure before commit.
2. Apply the same binding to Seamless start and poll:
   - persist an opaque workspace-scoped job record bound to candidate and
     provider external ID;
   - authorize polling from that record, not a raw client target;
   - revalidate candidate and workspace before applying contact details;
   - reject replay, cross-candidate, cross-workspace, and stale handles.
3. Redesign Sillage as a minimized preview plus explicit candidate selection:
   - bind every mapping job to workspace and campaign;
   - return only fields needed to preview and dedupe;
   - reveal and persist contact data per selected candidate;
   - prove no company-wide PII batch reaches client state by default.
4. Extract Apollo, Seamless, Sillage, and sourcing-agent callbacks into the
   React-free sourcing factory one provider group per commit. Preserve all 124
   public action names and the store-contract cycle gate.
5. Replace sourcing-agent opaque casts with exact schemas and minimum-necessary
   existing-candidate context. Validate every returned candidate with the live
   candidate DTO before any draft or shared-state commit.
6. Add one shared provider-error translator with public codes, secret and URL
   redaction, a hard length cap, and non-reflective tests.
7. After sourcing/enrichment closes, continue Wave 1B in order:
   outreach/compliance, fleet/integrations, then chat/sessions/shared UI memory.
8. Build the Wave 1C persistence adapter and canonical outreach projection
   resync path.
9. Rotate GitHub and Fly credentials, audit access, verify remote main, and
   push only through fresh least-privilege authentication.
10. Capture exact CI and CodeQL annotations, create a new current-SHA release
    candidate, then complete protected release, migration, recovery, restart,
    first-admin, two-user, real-channel, and campaign acceptance gates.

## Decisions made (don't relitigate)

- `src/lib/store/contracts.ts` owns the React-free public store contracts;
  `src/lib/store.ts` remains the compatibility entry point.
- `src/lib/store/campaign-actions.ts` owns campaign/intake actions.
- `src/lib/store/sourcing-actions.ts` owns guarded live-batch, exact GitHub, and
  manual candidate intake actions.
- Every action factory receives explicit dependencies and imports no React
  context.
- Effectful actions check authoritative workspace and role state before I/O and
  again after I/O, then report success only after a positive commit result.
- Browser and provider data are runtime projected even when callers are typed.
- Manual lawful basis is an operator input, not a legal conclusion. The record
  is complete only with allowed basis, `operator_selection`, and exact
  millisecond UTC timestamp.
- Unknown sourced facts remain unknown through mapping, scoring, prompts, UI,
  consent, and outreach. No role, title, tenure, or fit evidence is invented.
- Personalized outreach claims require canonical shared evidence. Generic copy
  is the fail-safe when evidence is absent or unrelated.
- Normalized outreach rows own delivery authority; `workspace_state` remains a
  UI projection.
- Source, release, and live evidence are separate claims.
- No exposed credential may be reused.

## Watch out

- The original OneDrive checkout is dirty and remains on
  `deploy/fly-github-actions`. Do not clean, reset, switch, or discard it.
- Work only in the integration worktree above unless a new isolated worktree is
  intentionally created.
- Claude and Codex share this worktree. Treat every uncommitted file as real
  work and inspect `git status` before editing or committing.
- Do not put credentials into argv, process listings, logs, Relay, URLs, or
  fixtures.
- Do not infer safe authentication from the unexplained tracking-ref advance.
- Do not run `git push` until credential rotation and remote identity are
  proven.
- Do not authorize paid provider work from a client-supplied external ID or raw
  polling handle.
- Do not return a full provider record when an exact bounded DTO is sufficient.
- Do not make provider-action factories both transport adapters and opaque
  state reducers. Keep effect, validation, and commit boundaries explicit.
- Do not treat interrupted exit-130 runs as evidence. The valid final gate is
  the unchanged-snapshot exit-0 run recorded above.
- Do not claim production readiness from local source gates or live migration
  `0023`.
