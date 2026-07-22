# Autonomous provider sourcing

Status: **implemented and fail-closed in source; not deployed or activated**

ARIA has two separate autonomous discovery authorities. They must never share
receipts or represent one provider as another:

- Migration 0054 authorizes bounded GitHub discovery. Anonymous mode is the
  default. Authenticated mode is explicit and uses a purpose-bound token.
- Migration 0060 authorizes one deterministic Tavily search over public
  LinkedIn profile-result URLs when the role has no approved 0054 GitHub
  query. Only the exact `role_not_approved_for_web` status falls through to
  the GitHub handler. Every other Tavily status is settled or retried without
  changing provider authority.

Migration 0058 remains the separate ordinary browser-result durability
authority. It does not authorize autonomous Tavily jobs or GitHub receipts.

Neither path creates synthetic candidates. A committed candidate must be
derived from a bounded provider response, have a canonical source identity,
and retain hashes that bind the job, query, response, and normalized result.
Outbound messages are a different capability and remain disabled unless their
own approval and drain controls are activated.

## Worker and route contract

The loop asks the database to authorize each leased `sourcing_batch` job. For
the Tavily lane, the database returns only a locator:

- `jobId`
- `leaseId`
- `workspaceId`
- `campaignId`
- `claimToken`
- `fenceVersion`

The loop sends that locator to `POST /api/internal/sourcing-execute` over a
Fly-private or loopback origin. The route requires the dedicated
`ARIA_SOURCING_EXECUTION_SECRET`. That secret must be 32 to 4096 non-whitespace
characters and must differ from `CRON_SECRET` and
`ARIA_REQUISITION_PARSE_SECRET`. The deploy contract requires and stages it;
the browser and public need-ingress routes never receive it.

The caller cannot supply an actor, provider, model, credential, query,
candidate, receipt, or completion decision. Migration 0060 derives and checks
those values from server-owned campaign and lease state.

## Tavily execution sequence

One attempt follows this sequence:

1. `authorize_autonomous_web_sourcing` locks the lease and campaign, rechecks
   sourcing controls and the activation administrator, derives the exact query,
   and creates a monotonic claim.
2. `begin_autonomous_web_sourcing_egress` rechecks the job, claim, campaign,
   quota, and exactly one fresh workspace Tavily credential. It records the
   egress attempt before any provider request.
3. The runtime resolves only that credential ID and immutable version. The
   decrypted key must match its stored `last4` metadata. The key is exposed
   only through a non-enumerable authorization closure.
4. `confirm_autonomous_web_sourcing_egress` locks the job again and rechecks
   the lease, controls, activation administrator, campaign, query hashes, and
   live credential version. It issues a ten-second start window.
5. The adapter makes one fixed request to `https://api.tavily.com/search` with
   `search_depth=basic`, `max_results=5`, `include_domains=[linkedin.com]`, and
   answer and image generation disabled. Redirects, oversized bodies,
   malformed JSON, credential echoes, duplicate URLs, non-profile URLs, and
   empty observations fail closed.
6. `record_autonomous_web_sourcing_result` stores bounded normalized evidence
   plus raw-response hash and byte count. Raw provider bytes and keys are not
   stored.
7. `commit_autonomous_web_sourcing` atomically persists novel candidates,
   exact source evidence, the workspace projection, the immutable receipt, and
   the succeeded job state. Staged personal data is then removed.

The autonomous path accepts a search result only when the exact role title is
observed or at least two independently derived role terms are observed. A
single broad skill is not enough. Names, titles, companies, locations, emails,
and phones are never model-filled. Empty fields remain empty until another
evidence-backed enrichment authority supplies them.

## Credentials and model bindings

Autonomous Tavily execution has no process-environment key fallback. The live
workspace must contain exactly one Tavily credential that:

- belongs to the same workspace;
- has provider `Tavily` and status `valid`;
- was verified with `tavily_usage_v1` or legacy Enterprise
  `tavily_key_info_v1` evidence and HTTP 200;
- was tested less than 24 hours before the egress fence; and
- still matches the immutable credential version returned by the database.

Key activation prefers Tavily's authenticated
[`/usage` endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/usage),
which verifies an ordinary account without spending a search credit. Existing
proof from the [Enterprise-only key-info endpoint](https://docs.tavily.com/documentation/enterprise/key-info)
remains accepted during rotation. Activation never sends a search request.

Requisition parsing uses a separate active `purpose=parse` runtime binding.
Migration 0055 requires exact provider, model, credential, evidence, proposer,
and independent approver identities. Kimi is eligible for sourcing only when a
concrete saved model has passed the nonce-bound tool-call evidence check; ARIA
does not guess a default Kimi model. The model capability is based on the
[Moonshot Tool Use API](https://platform.moonshot.ai/docs/api/chat).

## Recovery and replay

Provider egress is at-most-once per durable attempt:

- A repeated begin never returns fresh query or credential authority.
- An already-confirmed attempt never fetches again.
- A definitive read-only provider failure such as rate limiting, an HTTP 5xx, or
  a response-stream read failure may schedule a bounded queue retry. The retry
  receives a new immutable claim token, monotonic fence, attempt ID, and two
  fresh quota reservations while retaining the same provider, query, role, and
  lesson authority. The queue's `max_attempts` remains the hard bound.
- A crash after confirmation with no durable result becomes
  `no_durable_response` and is dead-lettered as ambiguous.
- A crash after the provider response but before a durable record is also
  ambiguous. It is never retried as a new paid request.
- A crash after recording but before commit reconciles the exact result hash
  and candidate count, then commits by locator without provider egress.
- A lost commit response is resolved from the immutable completion receipt.

The GitHub and Tavily lanes are mutually exclusive for one job. A prior GitHub
claim is sticky across re-leases and is resumed by the GitHub handler; a prior
Tavily claim prevents the GitHub authorizer from issuing authority. Neither lane
can become a fallback after the other has created a claim.

Expired attempts, stale leases, changed campaigns, revoked credentials,
disabled controls, replay conflicts, and tombstoned candidate aliases all fail
closed. Candidate erasure deletes matching staged payloads and source evidence;
the broader 0059 provenance authority handles other candidate-bearing payloads.

## Learning boundary

Graphify exports are not autonomous instructions. Migrations 0054 and 0060 may
select only current, human-promoted, exact-role lessons backed by the configured
completed and unexpired Graphify artifact. A lesson can choose only a query
already derived by the server's finite provider policy: the canonical GitHub
variants in 0054 or one of Tavily's five role-title and skill-ordinal LinkedIn
variants in 0060. The selected lesson version, human promotion, artifact,
query, and snapshot hash are frozen in the pre-egress claim and copied into the
completion receipt. Neither authority accepts free-form Graphify or LLM search
text.

## Activation and production proof

Source tests are necessary but do not activate production. A protected release
must also prove all of the following for the exact commit and image digest:

1. The database ledger includes migration 0060 and the application reports the
   same expected migration identity.
2. `ARIA_SOURCING_EXECUTION_SECRET` is present, purpose-bound, and distinct in
   the protected GitHub/Fly secret contract.
3. The workspace has one fresh Tavily credential and an independently approved
   parse-model binding.
4. The signed need-ingress throttle receipt proves the custom origin and direct
   Fly hostname share one external limiter across at least two web Machines.
5. Required GitHub CI, CodeQL, image, database, and release checks are green for
   the exact SHA, followed by the required independent approval.
6. A no-contact canary submits one synthetic role need, reaches parse,
   campaign, real provider egress, and persisted candidates, and proves replay
   causes no second provider request and no outbound message. Its proof accepts
   bounded retry history only when every attempt is confirmed and is exactly a
   receipt or an immutable failure, every job closes within four attempts with
   its receipt on the newest fence, and terminal or ambiguous failures are
   absent.
7. `/api/ready` returns 200 for that exact release and all loop/framework
   heartbeats and receipts are current.

Until those live checks pass, this feature remains source-complete but not a
production sourcing claim.
