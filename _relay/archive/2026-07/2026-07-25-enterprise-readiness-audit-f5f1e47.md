# Enterprise-readiness audit at `f5f1e47` — 27 findings that survived refutation

Method: 7 read-only auditors, each followed by a skeptic whose default verdict was *refuted* and who
had to open the cited `file:line` before letting a finding live. 14 agents, 3.5M tokens, 713 tool
calls. 43 findings raised, **27 survived**, 16 refuted.

## Read this before trusting the list

- **My first synthesis reported zero survivors and was wrong.** The skeptics prefixed each claim with
  `[severity]`, so my exact-string match against the finders' claims never hit and every survivor was
  dropped. The counts below come from re-reading `journal.jsonl` directly. If a future run reports a
  suspiciously clean result, read the journal before believing it.
- **The `blockers` auditor ran without Bash, Grep or Glob** (`E2BIG`), so it re-verified only the 8
  named blockers and explicitly did NOT check recorded blockers 4-8, 11-17, 19-23 and 27-32. Those
  remain unverified, neither confirmed nor retired.
- The 16 refutations are worth reading in the journal; several are better-evidenced than the findings
  they killed (notably that `/api/ready` IS wired in the deploy, and that the web tier holds no
  Postgres connections because PostgREST multiplexes them).

## Retired by the audit — 5 of the 8 named blockers are now false

Measured at `85ab870`, before Rocks 1 and 2. Against current code:

1. "the sourcing loop registers zero handlers" — `scripts/sourcing-loop-worker.mjs:49-63` declares 11
   kinds, `:555-567` binds a handler to each.
2. "eleven of twelve `aria_jobs` kinds have no handler" — 11 in the loop worker plus `swarm_assignment`
   in `scripts/swarm-orchestrator-worker.mjs:51`.
3. "the swarm plane has zero tests" — `tests/test-manifest.mjs:80` registers `swarm-request-boundary`.
   (A narrowed version of this one survives; see B4.)
4. "Hermes is structurally dead in production" — `src/lib/api/url.ts:21-33` and `:98-103` add the
   deployment-named host allow-list; `src/lib/readiness.ts:72` fails readiness on misconfiguration.
5. "scoring, dedupe and the candidate commit run in the browser, so headless is impossible" —
   `src/app/api/sourcing-agent/route.ts:534-542` scores server-side, `:662-664` dedupes server-side,
   `scripts/sourcing-loop-worker.mjs:485-492` commits server-side.

## B0 — the one I verified myself, and the most urgent

**The next production deploy will abort after mutating production.** `fly.app.toml:13` declares a
fourth process group `loop`, added by Rock 1's own commit `c95fe44`.
`scripts/verify-apollo-cleanup-release.mjs:5` hardcodes `PROCESS_GROUPS = ["web", "cleanup",
"framework_heartbeat"]` and `:67-69` throws `unexpected Fly application process group` for any machine
outside it. In `deploy-fly.sh` the order is: `:1050` `fly deploy --config fly.app.toml` (which creates
a machine per declared process group), `:1056-1057` health and readiness pass, then `:1071`
`verify_apollo_cleanup_release` lists machines and throws. So the new code is already live when the
release verification fails.

Fix is small: admit `loop` to `PROCESS_GROUPS`, assert its image digest like the others, and update
`tests/apollo-cleanup-worker.mts:114-116` and `tests/deploy-contract.mts:246-247`.

## The 27 survivors

### BLOCKER

- **[authz]** The per-workspace `sourcing_loop_controls` switchboard (kill switch, per-stage enables, daily caps) is never read by the job spine or the loop worker, so the only tenant-facing control over autonomous processing has no effect.
  - evidence: supabase/migrations/0038_loop_job_authority.sql:21-24 documents it as the "per-workspace fail-closed switchboard"; :134-157 defines kill_switch DEFAULT TRUE and every stage enable DEFAULT FALSE. `enqueue_aria_job` at :229-254 checks only `auth.role()` and workspace existence. `claim_due_aria_jobs` at :341-359 selects on `status='queued' and next_run_at<=now() and kind = any(p_kinds)` with no join 
  - impact: An enterprise tenant admin who engages their kill switch (or who simply never enabled sourcing — the shipped default) still has their jobs claimed and executed by the shared worker. shortlist_build in particular writes candidate records into that tenant's workspace_state through complete_aria_job_wi

- **[blockers]** The durable loop's sourcing handlers are bookkeeping only — none reaches a provider or a model, and five of the eleven kinds never enqueue the successor their own transition table declares — so the queue still cannot source a candidate headless.
  - evidence: scripts/sourcing-loop-worker.mjs:54-56 declares sourcing_batch->shortlist_build, provider_poll->shortlist_build, enrich_candidate->shortlist_build; the handlers at :429-441 (handleSourcingBatch), :443-455 (handleProviderPoll), :457-468 (handleEnrichCandidate) each make zero outbound provider calls and pass `[]` as successors at :439, :453, :466. :495-506 handleDraftGenerate emits a `draft.ready` e
  - impact: A tenant enabling the loop gets heartbeats, lease reaping and an outbound drain, but no candidate is ever found, enriched, scored or drafted by the server. Every job kind that would touch a provider completes successfully having done nothing, and the chain dies at sourcing_batch because the declared

- **[blockers]** The only live sourcing authority route is still browser-bound: it requires a same-origin Origin header and a Supabase cookie session, with no service-role or service-token path, and the loop worker never calls it.
  - evidence: src/app/api/sourcing-agent/route.ts:221-224 rejects any request whose Origin header is absent or not equal to req.nextUrl.origin with CROSS_ORIGIN_REQUEST; :226-233 then requires getServerSupabase() plus auth.getUser() and 401s otherwise; there is no bearer/service-role branch anywhere in handlePost (:206-790). On the other side, the loop worker's configuration exposes exactly one HTTP destination
  - impact: Nothing server-side can start a candidate search. A scheduled job, a webhook, an agent framework or the loop worker itself cannot authenticate to the one route that performs live sourcing, because it demands a browser session cookie plus a matching Origin. Autonomous sourcing for an enterprise tenan

- **[blockers]** The 0046 swarm authority and the swarm orchestrator worker still have zero executed proof; the one swarm test that now exists covers only the HTTP request boundary.
  - evidence: tests/test-manifest.mjs:80 registers exactly one swarm command, swarm-request-boundary, and :305 places it in the application group; the database group at :491-510 contains no swarm suite. tests/swarm-orchestration-db.sh does not exist (Read returned File does not exist) and neither does tests/swarm-orchestrator-worker.mts. The untested surface is live: scripts/swarm-orchestrator-worker.mjs:291 ca
  - impact: The lease-bound checkpoint commit, the DAG/concurrency/greenlight gates and the stale-assignment auto-repair are all enforced in SQL that is already applied to the production database and has never been executed by a test. A regression in any of those RPCs would ship green through every gate, and th

- **[dataprotection]** The Rock 1 job spine (aria_jobs) is contractually required to carry raw candidate PII, yet migration 0033's erasure never touches it and the 0038 schema declares it out of erasure scope on a premise the worker code disproves.
  - evidence: scripts/sourcing-loop-worker.mjs:513 — `const replyText = boundedText(payload.replyText ?? payload.body ?? payload.text, 20_000, "reply_text_required");` (an inbound_classify job THROWS unless up to 20 000 chars of candidate-authored reply text are in the job payload). scripts/sourcing-loop-worker.mjs:384-398 + :473-474 — shortlist_build requires `payload.candidates`, whole candidate records sprea
  - impact: After a tenant runs `request_candidate_erasure` the RPC returns status `completed` and a receipt set, but the candidate's raw email/WhatsApp reply body and full profile record remain readable in `public.aria_jobs.payload` indefinitely. The erasure receipt is therefore a false attestation, and an ent

- **[dataprotection]** Lawful basis is enforced only for manually entered candidates; every provider-sourced candidate — the Art.14 population where a balancing test actually matters — reaches outreach approval with no lawful basis recorded anywhere.
  - evidence: src/lib/rules.ts:84-97 — the lawful-basis blocker is wrapped in `if (candidate.provenance === "manual")`; no other branch checks it. src/lib/sourcing/candidate-mappers.ts:73, :132, :191, :247 — mapGithubCandidates, mapApolloCandidates, mapSeamlessCandidates and mapWebSearchCandidates each mint `provenance: "live"` and none of the four object literals sets `lawfulBasis`, `lawfulBasisRecordedAt` or 
  - impact: Candidates scraped from GitHub, Apollo, Seamless and LinkedIn/web search are contacted with zero recorded lawful basis and zero recorded source-of-data. Those are precisely the records where GDPR Art.14 notice and a documented legitimate-interest assessment are mandatory; a supervisory authority or 

- **[dataprotection]** `request_candidate_erasure` refuses to erase any candidate who is no longer present in the workspace_state JSON blob, even though the operational stores keyed on that candidate_id still hold their PII.
  - evidence: supabase/migrations/0033_candidate_erasure_authority.sql:1441-1453 — the function selects workspace_state, and `if not found or jsonb_typeof(...->'candidates') <> 'array' then return jsonb_build_object('status','not_found')`, then looks the candidate up by id AND campaignId and returns `not_found` if absent; every scrub statement (:1763-1836) runs after that gate. Nothing deletes the dependent row
  - impact: A recruiter dropping a candidate from a shortlist permanently disables that person's right to erasure: the DSAR RPC returns `not_found`, writes no receipt and scrubs nothing, while their email address, phone number and message bodies stay live in messages_inbound/outbound, outreach_ledger and whatsa

- **[outreach]** The per-workspace kill switch (sourcing_loop_controls.kill_switch, DEFAULT TRUE) is never read by any code on the outbound send path, so engaging it does not stop a single message from going out.
  - evidence: supabase/migrations/0038_loop_job_authority.sql:134-157 defines the "per-workspace fail-closed switchboard" with kill_switch DEFAULT true; supabase/migrations/0039_email_channel_durability.sql:24-25 claims the email worker path "ships dark behind the loop kill switch (0038)"; src/lib/dispatch-outbound.ts:113-133 (dispatchDue) reads messages_outbound and dispatches with only publicDemoSideEffectsDi
  - impact: A tenant that says "stop all outreach now" (candidate complaint, GDPR demand, wrong campaign published) has no working control. Flipping kill_switch in the switchboard changes nothing: the Vercel daily cron and the opportunistic drain in /api/webhooks/whatsapp keep draining every approved, queued ro

- **[pipeline]** Of the 11 stages in PIPELINE_STAGE_TRANSITIONS, 9 handlers are event-emitters that do no stage work; nothing in the loop calls Apify, any enrichment provider, any drafting, or any reconciliation RPC. Only inbound_classify and shortlist_build mutate tenant state.

- **[pipeline]** Five of the seven declared stage transitions can never fire because the owning handlers pass an empty successor array to completeJob.

- **[pipeline]** Nothing outside the worker enqueues a root job, so the spine has no ignition; enqueue_aria_job is service_role-only and the worker only enqueues successors of jobs it already claimed.

- **[pipeline]** The per-tenant sourcing_loop_controls plane is not enforced anywhere in the loop — neither the claim RPC nor the worker reads it; only a process-wide env kill switch has effect.

- **[reliability]** The `loop` process group in fly.app.toml is rejected by the release verifier, so the protected production deploy aborts at its final step after mutating production, and CI cannot catch it.

### MAJOR

- **[authz]** The database privilege gate is a hand-maintained allowlist that omits roughly 35 live public routines, so nothing proves their EXECUTE grants, SECURITY DEFINER state, or pinned search_path — including a workspace-keyed HMAC helper.
  - evidence: docker/bootstrap/legacy-baseline-invariants.sql:15 is the canonical signature inventory the recovery preflight enforces; it lists `sourcing_authority_hmac(uuid,text)`, `list_workspace_candidates(text,text,text,text,text,integer,integer)`, `begin_sourcing_run(...)`, `complete_sourcing_run(uuid,uuid,uuid,jsonb)`, `fail_sourcing_run(uuid,uuid,uuid,text)`, `claim_calendar_booking(...)`, `reconcile_cal
  - impact: CI cannot detect a grant regression on any of these routines. A `grant execute … to authenticated` (or an unpinned search_path) added to `sourcing_authority_hmac`, `begin_sourcing_run`, or `claim_calendar_booking` in a future migration would pass every gate in the repo. For a paying tenant that mean

- **[dataprotection]** Erasure scrubs agent_runs, agent_events and agent_framework_sourcing_authorizations by literal candidate-ID substring only, ignoring the email/phone/URL identity set the same function already computed.
  - evidence: supabase/migrations/0033_candidate_erasure_authority.sql:1585-1616 builds `identities` (email, phone, linkedinUrl, githubUrl, sourceUrl) and `phones`; :1776-1790 correctly uses both to scrub messages_inbound. But :1861-1865 selects agent_runs with `run.state_json::text like '%' || to_jsonb(p_candidate_id)::text || '%'`, :1874-1880 scrubs agent_events with `event.payload::text like '%' || to_jsonb(
  - impact: Any agent run or agent event that captured the candidate's email, phone or LinkedIn URL without also embedding the internal candidate id survives erasure with the PII intact, and the receipt row written at 0033:1931-1932 reports it as scrubbed with an accurate-looking row count. The same asymmetry i

- **[dataprotection]** loop_events is append-only for every role including the table owner and stores candidate identifiers, so those rows are unerasable by construction and are never touched by erasure.
  - evidence: supabase/migrations/0038_loop_job_authority.sql:89-99 defines loop_events with `subject_id` and a jsonb payload; :114-129 installs `loop_events_append_only` as a BEFORE UPDATE OR DELETE trigger raising 42501 unconditionally — the policy at :110-112 grants postgres/supabase_admin but the trigger fires regardless of role. tests/loop-jobs-db.sh:901-910 asserts both UPDATE and DELETE raise 42501 with 
  - impact: Every erased candidate leaves a permanent, undeletable audit trail of `candidate.enriched` / `draft.ready` / `reply.classified` rows tied to their identifier and campaign, in a table that not even the DB owner can purge without dropping the trigger. Erasure completion can never be truthfully certifi

- **[operability]** There is effectively no observability: no metrics/tracing/error reporting, /api/health is a constant, /api/ready returns bare booleans, and the provider-egress chokepoint records nothing.

- **[operability]** On Fly nothing schedules outbound dispatch: the loop worker ships dark, the release never sets ARIA_LOOP_KILL_SWITCH, and the only cron is in vercel.json while /api/ready still reports queue:true.

- **[outreach]** Microsoft Graph rotates the refresh token on every refresh and the new one is thrown away — only access_token and expires_at are ever written back.
  - evidence: src/lib/email-oauth.ts:230-235 sets connection.accessToken, connection.expiresAt and `if (json.refresh_token) connection.refreshToken = json.refresh_token;` in memory. The only persistence path, src/lib/email-send.ts:93-105, fires on `origAccessToken !== connection.accessToken || conn.expires_at !== connection.expiresAt` and updates exactly `{ access_token, expires_at, updated_at }` — refresh_toke
  - impact: The refresh token stored at connect time (src/app/auth/microsoft/callback/route.ts:143) is the only one the database will ever hold. Once it ages out of Microsoft's refresh-token lifetime, ensureAccessToken returns null, sendViaMicrosoftGraph returns deliveryState 'not-sent' (src/lib/email-oauth.ts:

- **[outreach]** The outreach-sequence suppression gate matches on suppression_list.candidate_id, a column the canonical DDL does not define and that no writer populates, and nothing stops an active sequence on hard bounce or spam complaint.
  - evidence: supabase/migrations/0045_outreach_sequence_authority.sql:274-281 gates scheduling on `select 1 from public.suppression_list sl where sl.workspace_id = … and sl.candidate_id = seq.candidate_id` (and ignores expires_at). supabase/migrations/0002_fleet.sql:30-40 creates suppression_list as (id, workspace_id, type, value, reason, source, created_at, expires_at) — no candidate_id. All four writers key 
  - impact: This is the gate that has to hold before sequences_enabled can ever be turned on for a tenant. As written it either raises `column sl.candidate_id does not exist` on first execution (claim_sequence_step_for_schedule then fails for every step) or matches nothing, in which case a candidate who unsubsc

- **[outreach]** The outreach_ledger de-dupe index is permanent, not windowed, so the 90-day re-contact window can never elapse — a candidate contacted once in a workspace can never be contacted again.

- **[pipeline]** Reply classification silently degrades to a four-branch keyword regex in production: the production entrypoint never passes a modelClient, so the LLM path in handleInboundClassify is unreachable outside the unit test.
  - evidence: runSourcingLoopTick accepts modelClient as its 5th parameter (scripts/sourcing-loop-worker.mjs:601), but runSourcingLoopForever calls it with only four arguments (:699) and main() never builds one (:731-762) — modelClient is not even in the destructured options at :685-694. So `context.modelClient?.classifyReply` at :517 is always undefined and classification falls to deterministicClassification (
  - impact: Every candidate reply that isn't matched by the literal words in the regex is stored as intent UNCLEAR with confidence 0.6. Non-English replies beyond the single hardcoded French phrase, indirect declines and referrals all land in the same bucket, and the recruiter-facing suggestedAction/draftRespon

- **[pipeline]** Apify runs are ephemeral and browser-bound: the start route persists no provider run, the browser polls under a user session, and candidate mapping happens client-side, so a closed tab loses the run with no server-side record.

- **[reliability]** Jobs killed by the lease reaper are dead-lettered silently — no event, no authenticated read surface, and the recovery RPC needs a job id the tenant can never obtain.

- **[reliability]** Four of the six multi-stage transitions are never enqueued by any handler, and nine of the eleven handlers perform no domain work.

- **[reliability]** The agent-framework lease reaper that 0038 says closes the 0029 gap has exactly one caller, and that caller sits behind the sourcing-loop kill switch.

### MINOR

- **[reliability]** Inbound reply classification silently degrades to a keyword regex because the model client is never threaded into the tick.

