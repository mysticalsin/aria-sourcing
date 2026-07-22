# ARIA private agent frameworks

This directory contains the ARIA-owned boundary around two real upstream agent
frameworks. DeerFlow performs the constrained proposal run; Flowise stores and
exports the governed workflow graph. Neither upstream API is exposed to a
browser or a public host port.

The adapters do not make an LLM response authoritative. DeerFlow may select
only an index from the reviewed query list signed by ARIA. ARIA resolves that
index back to the exact reviewed query. Flowise exports only ARIA node IDs,
ARIA node kinds, and graph edges; credentials and arbitrary node data are
discarded.

## Audited source boundary

| Component | Source revision | Official build file | Runtime API used |
| --- | --- | --- | --- |
| ARIA model gateway | this repository release SHA | `model-gateway/Dockerfile` | `GET /v1/models`, `POST /v1/chat/completions`, `GET /readyz` |
| DeerFlow | `3c0a45ad772cdba388009b8d5ecad5e48cd22429` | upstream `backend/Dockerfile` plus checksum-pinned `deerflow-runtime/Dockerfile` | `POST /api/runs/wait` |
| Flowise | `ed9e100fb71643cd3922b005908f9732bc0e07dc` | `Dockerfile` | `GET /api/v1/chatflows/:id` |
| Flowise worker | same Flowise revision plus ARIA's checksum-bound readiness patch | `infra/agent-frameworks/upstream/flowise.Dockerfile` | `GET /healthz` |

`docker-bake.hcl` builds those exact Git objects and emits BuildKit SBOM and
maximal provenance attestations. The upstream Dockerfiles still reference
some mutable base tags. Therefore a Git revision alone is not a release
identity: scan, sign, and promote the resulting image digest, then configure
ARIA and the adapters with that exact digest.

> **Current release status: NO-GO.** No complete Flowise runtime at either
> audited candidate passes the zero HIGH/CRITICAL release gate. The framework
> pack has no accepted production deployment or restore receipt. DeerFlow also
> has no accepted exact-model canary; the last recorded Kimi authentication
> check returned HTTP 402. Keep execution disabled.

## Build candidate images and promote only after acceptance

Run Bake from the repository root:

```sh
REGISTRY=registry.example/aria-agent-frameworks \
  docker buildx bake -f infra/agent-frameworks/docker-bake.hcl --push
```

Before promotion:

1. Resolve and record each pushed `repo@sha256:...` reference.
2. Verify the provenance subject matches that digest and the source revision
   above.
3. Scan the SBOM under the organisation's vulnerability policy.
4. Sign the accepted digest and require signature verification at admission.
5. Put only accepted digest references in the Compose inputs. Tags are never
   accepted by adapter configuration or readiness.

## Deployment topology

`compose.yaml` is an executable, tested one-workspace stack for an operator
that provides the listed images, volumes, secret files, and private network.
It is not invoked by the protected Fly workflow. A separate reviewed source
deployment pack now exists in [`fly/README.md`](fly/README.md) for eight active
private Fly apps and two release-disabled provenance roles, and a
prepare/confirm/deploy operator. It has not been executed in
production. Immutable promotion evidence, egress enforcement, Flowise private
bootstrap, stateful HA/restore proof, live provider readiness, and a real
campaign canary remain release blockers. Do not treat a successful Compose or
Fly config render as live deployment evidence.

Deploy one copy of this stack per ARIA workspace. This is the supported
open-source Flowise isolation boundary. Do not place multiple ARIA workspaces
inside one unlicensed Flowise instance.

All active runtime services join the `framework_private` internal network. The
file declares no host ports. Only `model-gateway` also joins the dedicated
`model_gateway_egress` network. DeerFlow has no Internet route and always uses
`http://model-gateway.service.internal:8090/v1`.

DeerFlow is intentionally ephemeral. Its supported `database`, `run_events`,
and `stream_bridge` backends are all `memory`; the process receives no database
or Redis URL, credential, dependency, or readiness probe and runs one Uvicorn
worker. ARIA's checksum-pinned wrapper accepts only the audited `runs.py` from
the source revision above. For `POST /api/runs/wait` with
`on_completion=delete`, it serializes the terminal result, then unconditionally
cancels and drains the generated-thread run and erases its checkpoint, run,
event, thread, stream, manager, and temporary-file state. Cleanup is shielded
from request cancellation. Any cleanup uncertainty terminates the worker so
its memory and ephemeral root are cleared before it can become ready again.
Caller-owned thread IDs are rejected for delete mode.

The gateway has two compiled provider allowlist entries: `kimi` maps to
`https://api.moonshot.ai/v1`, and `openai` maps to
`https://api.openai.com/v1`. An operator cannot supply another upstream URL.
The production example selects `kimi` so the existing governed
`KIMI_API_KEY` can be materialized as the gateway provider-key file without
buying or introducing another provider credential. Adding any other provider
requires a reviewed code change, tests, a new promoted gateway image, and a new
canonical configuration receipt. Model discovery exposes only
`DEERFLOW_MODEL_ID`; chat requests must use that exact approved model, remain
non-streaming, and contain only the bounded safe parameter set.
The production gateway keeps a 256 KiB total request ceiling so every valid
bounded ARIA need, including its UTF-8 worst case, can traverse DeerFlow; the
same ceiling still rejects oversized bodies before provider egress.
The Kimi path does not send `response_format`; the pinned DeerFlow proposal
agent requests JSON in its reviewed prompt and the adapter validates the
returned object before ARIA can use it.

The pinned DeerFlow runtime always binds its framework-owned
`review_skill_package` builtin, even when this custom agent declares
`tool_groups: []` and its only skill declares `allowed-tools: []` (see the
[pinned builtin list](https://github.com/bytedance/deer-flow/blob/3c0a45ad772cdba388009b8d5ecad5e48cd22429/backend/packages/harness/deerflow/tools/tools.py#L15-L19)
and [framework allowlist](https://github.com/bytedance/deer-flow/blob/3c0a45ad772cdba388009b8d5ecad5e48cd22429/backend/packages/harness/deerflow/skills/tool_policy.py#L13-L16)).
The gateway accepts only the exact schema emitted by the pinned
`langchain-openai` runtime and removes both that schema and the optional literal
`tool_choice: "none"` before provider egress. It rejects any additional tool,
schema drift, or other tool choice. The cloud provider therefore receives no
tool authority, and a future DeerFlow or LangChain schema change fails closed
until it is reviewed with a new image and gateway contract.

DeerFlow and its private adapter read only the internal
`deerflow_model_gateway_token`; the adapter uses it solely for authenticated
readiness and requires the gateway to return the exact configured provider and
model. The gateway reads that token and the separate
`deerflow_model_provider_api_key` from secret files. It does not log headers,
bodies, secrets, or provider responses. No
fallback, sample response, or fake sourcing result exists. If a required
dependency is unavailable, readiness is 503 and ARIA remains fail closed. The
DeerFlow readiness v2 dependencies are exactly `modelGateway`,
`runtimeHealth`, `modelBinding`, `assistantBinding`, and `policyBundle`. The
Flowise readiness v2 dependencies are exactly `database`, `queue`, `worker`,
and `policy`.

The pinned Flowise worker's upstream health server returns `200` without
checking the worker. ARIA does not use that signal. The build verifies the
exact upstream `worker.ts` SHA-256, applies a deterministic patch, and rejects
any source or patched-output drift. The patched worker refreshes an atomic
owner-only receipt every five seconds only after `SELECT 1` succeeds, all three
BullMQ workers are running, their normal Redis clients answer `PING`, and their
blocking clients are ready. ARIA's dependency-free `/healthz` validates that
receipt, its live worker PID, exact queue names, file ownership and mode, and a
15-second freshness limit. Missing, stale, mismatched, unsafe, or unprovable
evidence returns `503`. The adapter separately checks the workspace sentinel
through Flowise and the exact BullMQ client names through Redis, so the worker
receipt does not replace either independent dependency check.

The Fly source pack uses an app with no public service, sets
`MODEL_GATEWAY_BIND_HOST=fly-local-6pn`, and binds the gateway to its 6PN
interface. The canonical URL validator accepts `http://*.internal`
with an optional port because Fly `.internal` traffic crosses the encrypted
WireGuard 6PN, not the public Internet. It also accepts private HTTPS. It still
rejects every public hostname and any URL credentials, query, or fragment.
See [Fly private networking](https://fly.io/docs/networking/private-networking/)
and [Fly internal app services](https://fly.io/docs/networking/app-services/).

## Required secrets

Create these in the deployment platform; never put their values in Git, image
layers, Compose variables, logs, or the Relay baton:

- `flowise_db_password`
- `flowise_redis_password` for the Flowise queue
- `deerflow_model_gateway_token`, `deerflow_model_provider_api_key`,
  `deerflow_internal_token`
- `deerflow_adapter_token`, `flowise_adapter_token`
- `flowise_encryption_key`, `flowise_jwt_auth_secret`,
  `flowise_jwt_refresh_secret`, `flowise_session_secret`,
  `flowise_token_hash_secret`
- `agent_framework_capability_secret`
- `flowise_api_key`, created for the single private Flowise workspace

Use independently generated base64url values of at least 32 characters. The
model-gateway token, cloud-provider key, DeerFlow adapter token, Flowise
adapter token, DeerFlow internal token, Flowise API key, and capability secret
are different authorities and must not be reused.

When `DEERFLOW_CLOUD_PROVIDER_ID=kimi`, materialize the existing governed
Kimi secret into the file named by `DEERFLOW_MODEL_PROVIDER_API_KEY_FILE`.
Do not copy the value into Compose environment variables. The application may
still have `KIMI_BASE_URL` for its separate general-purpose provider path; the
framework gateway ignores that variable and always uses the compiled official
Moonshot origin. Set `DEERFLOW_MODEL_ID` to the model explicitly approved for
this framework and verify that exact identifier through authenticated
readiness before activation.

Current external blocker (verified 2026-07-14): the available
`KIMI_API_KEY` receives HTTP 402 from authenticated
`GET https://api.moonshot.ai/v1/models`. The gateway converts that response to
unavailable readiness without returning the provider body. Fund or entitle the
account, repeat the authenticated model inventory, and approve one returned
model ID before setting `DEERFLOW_MODEL_ID`. Do not invent a default model or
activate the framework while the provider returns 402.

`compose.yaml` requires a host path for every secret and mounts each value with
the Compose secrets mechanism. In production, point those variables at
short-lived files materialized by the platform's secret manager. The adapters
consume `_FILE` variables and never require secret values in their environment.
The DeerFlow runtime and DeerFlow adapter receive no Redis URL, password, or
authority. Flowise alone uses the `flowise-redis` service for its queue. The
Flowise adapter derives authority from the mounted Flowise Redis-password
secret and the fixed Compose hostname `flowise-redis:6379/0`.

On Fly, only the Flowise adapter receives `REDIS_HOST` and `REDIS_FLY_HOST`.
Both must be the same exact reviewed lowercase hostname,
`aria-mantu-flowise-redis.internal`. The adapter rejects an absent or
mismatched `REDIS_FLY_HOST`, a cross-framework hostname, every public hostname,
and any port or database other than `6379/0`. Compose intentionally omits
`REDIS_FLY_HOST` and permits only its exact service name.

## Required deployment inputs

Use `compose.env.example` as the secret-free input inventory. Its `*_FILE`
values are paths to secret-manager material, never secret values.

The Compose deployment fails interpolation when any identity is absent:

- image repository and 64-hex digest pairs for the active Flowise Postgres and
  Redis identities, the provenance-only DeerFlow Postgres and Redis identities,
  DeerFlow, Flowise, the Flowise worker, the adapter, and the model gateway.
  Compose always joins each pair as `repository@sha256:digest`, so a mutable
  tag cannot replace the required digest. The DeerFlow Postgres identity is
  retained only for canonical-manifest compatibility and provenance. The same
  is true of the DeerFlow Redis identity. Compose starts neither service, and
  the Fly operator marks both roles release-disabled;
- the ARIA workspace UUID and separately registered DeerFlow and Flowise
  framework-instance UUIDs;
- the Flowise workspace UUID returned by that private Flowise instance;
- the Flowise workflow ID of the workspace-bound readiness sentinel;
- the exact ARIA framework-configuration SHA-256;
- the adapter, active Flowise Redis and database, provenance-only DeerFlow Redis
  and database, and Flowise-worker image digests;
- the exact `langchain-openai` integration, allowlisted cloud-provider identity,
  model ID, private model-gateway URL, promoted gateway digest, and opaque
  credential-version identifier.

The application-side registration must use the same workspace IDs, framework
instance IDs, source commits, image digests, Flowise isolation value, adapter
tokens, and configuration digest. A mismatch is a hard 403, 412, or readiness
failure before upstream egress.

The configuration receipt is not an operator-chosen value. Populate every
secret-free identity variable listed in `.env.production.example`, then derive
the receipt with:

```sh
node scripts/agent-framework-configuration.mjs --sha-only
```

Store that exact output as `AGENT_FRAMEWORK_CONFIGURATION_SHA256` in the ARIA
app, heartbeat worker, both adapters, and the workspace control row. The
versioned canonical manifest binds the ARIA workspace; distinct DeerFlow and
Flowise instance IDs; adapter endpoints; all promoted runtime image digests;
the audited source commits; the exact LangChain integration, cloud provider,
model, private gateway URL, gateway image and credential version; and the
Flowise workspace, sentinel, isolation and queue.
Both adapters and the heartbeat recompute the receipt at startup, and
authenticated `/readyz` includes it. Any missing field or drift fails closed.

## Flowise bootstrap

A new Flowise database has no ARIA service API key. Bootstrap is an explicit
operator step:

1. Start the private Flowise database, its isolated Redis, Flowise service, and worker.
   Use `docker compose -f infra/agent-frameworks/compose.yaml up -d
   flowise-db flowise-redis flowise flowise-worker`. The post-bootstrap workspace ID,
   sentinel ID, and API-key file may be absent for this service subset; their
   empty defaults make `flowise-adapter` fail configuration validation if it is
   accidentally started before bootstrap completes.
2. Use the deployment platform's audited, time-bounded admin port-forward to
   the internal Flowise service. Do not add a permanent host port.
3. Register the single administrator. This pinned open-source Flowise revision
   creates its sole `Default Workspace` during registration; creating another
   workspace is enterprise-feature-gated. Bind that generated workspace UUID
   to the one ARIA workspace and create a least-privilege service API key there
   with exactly the `chatflows:view` permission required by the pinned
   `GET /api/v1/chatflows/:id` route. Do not grant create, update, delete,
   agent-flow, credential, tool, workspace, or administration permissions.
4. In that workspace, create a readiness-sentinel chatflow named
   `ARIA readiness sentinel` whose sanitized graph is exactly one node
   `{ "id": "sentinel", "data": { "ariaKind": "plan" } }` and no edges.
   Record its opaque workflow ID. Readiness retrieves that exact flow through
   the service API, verifies the configured workspace UUID, and runs the same
   sanitizer used by exports.
5. Store the workspace UUID, sentinel workflow ID, and API key in the
   deployment secret manager, remove the port-forward, and start
   `flowise-adapter`. The separate runtime-secret preflight compares that key
   with every other mounted authority and rejects an absent, malformed, short,
   or reused value before the adapter can start. The `/dev/null` Compose default
   exists only so the private bootstrap subset can start before the key exists.
6. Confirm the adapter export returns only the sanitized ARIA graph fields.

Replace the sentinel by creating and validating the new flow first, updating
`FLOWISE_READINESS_WORKFLOW_ID`, restarting the adapter, and confirming ready
before deleting the old flow. Rotate the API key with the same overlap pattern.

If the platform cannot provide an audited private bootstrap path, deployment is
blocked; do not temporarily expose Flowise to the Internet.

## Verification gates

Local contract and artifact tests:

```sh
node --test --test-reporter=spec infra/agent-frameworks/adapter/adapter.test.mjs
node --test --test-reporter=spec infra/agent-frameworks/model-gateway/gateway.test.mjs
node --test --test-reporter=spec infra/agent-frameworks/deployment.test.mjs
docker buildx bake -f infra/agent-frameworks/docker-bake.hcl --print
```

Resolve the Compose model with non-secret deployment inputs before rollout:

```sh
docker compose -f infra/agent-frameworks/compose.yaml config -q
```

Production activation requires both authenticated adapter readiness endpoints
to return HTTP 200 with all dependency flags true and the exact registered
workspace, instance, commit, image digest, contract, and isolation values.
Then run one canary campaign using an approved need and reviewed query set.
The canary passes only when:

- Flowise exports the expected sanitized DAG;
- DeerFlow returns an allowed reviewed-query index and never query text;
- ARIA persists step receipts and the selected action as a proposal;
- the campaign's actual sourcing connector returns live provider evidence;
- killing Flowise Redis, the Flowise database, the Flowise worker, either
  framework upstream, or the model gateway makes the applicable readiness fail
  and prevents new framework runs.

Before that canary, authenticate directly over the private network and prove
the model boundary without printing tokens or response bodies:

1. `GET /readyz` returns the exact configured provider and model.
2. `GET /v1/models` contains exactly that model and no other provider model.
3. A bounded `POST /v1/chat/completions` returns the exact configured model.
4. A wrong model, `stream: true`, an unknown field, an invalid token, and a
   public gateway URL all fail before provider egress.
5. The deployment receipt contains the exact promoted gateway digest,
   provider identity, model ID, private URL, and credential-version ID.

Keep `AGENT_FRAMEWORK_EXECUTION_ENABLED=false` and the framework kill switch on
until every gate above has evidence. A successful image build is not evidence
of a live model, a configured Flowise workspace, or a real candidate result.

## Recovery and rollback

- Back up the Flowise Postgres volume and exercise a restore before activation.
  DeerFlow has no database or Redis volume.
- Flowise Redis is not a system of record. Recover it by creating an empty
  Redis volume and service, restarting Flowise, its worker, and its adapter,
  then reconciling in-flight jobs against Flowise Postgres and ARIA receipts.
  Do not attach a restored Redis snapshot to the active service.
- Roll back by restoring the last signed image digests and their matching ARIA
  registrations. Never point a registration at a different digest in place.
- Rotate adapter and upstream tokens after any suspected exposure. Rotation
  requires coordinated secret replacement and readiness verification.
- The immediate safety action is the ARIA framework kill switch; it prevents
  new execution while preserving evidence for diagnosis.
