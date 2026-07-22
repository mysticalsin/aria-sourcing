# Private Fly deployment pack

This directory declares ten Fly roles for the ARIA-owned DeerFlow and Flowise
boundary. `deerflow-db` and `deerflow-redis` remain only as canonical-manifest
and provenance identities. Eight roles are release-enabled. The operator rejects any
Machine or secret attached to either disabled role and never creates,
configures, or deploys those apps. Every active
app uses the default organization 6PN, has no `services` or `http_service`
section, requests no public IP, and runs one always-on Machine. The active
Flowise PostgreSQL and Redis apps use independent encrypted volumes and secret
authorities. The DeerFlow runtime is single-process and memory-only. It receives
no database or Redis authority.

The DeerFlow image keeps the audited upstream `runs.py` patch at SHA-256
`d5ee9ebcf676656ca9380e866b414d1ff4fa70cfac587a9fbc7d7a60506a6db4`.
A separate cleanup-deadline guard at SHA-256
`4e4b0006ad7486b5b028dfa9168e3e45d26d33eca46e7b653db29db4683918e6`
terminates the single worker with exit code 70 if temporary-state cleanup does
not finish within 10 seconds. This bounds both a task that ignores cancellation
and a storage delete that blocks or never returns without changing the audited
patch. The request-time memory-only policy at SHA-256
`9312dff2f23f04fc8c2a92600d47d8d4958094e4c37e010c10ff1e011dce6025`
removes persistence and tracing authority before each request and immediately
before each response. Its `x-aria-runtime-policy: memory-only-v1` response
marker lets the private probe prove policy enforcement in the serving Uvicorn
worker instead of inspecting the probe process environment.
The runtime configuration SHA-256 is
`a5a41ab4a2772e74203820d65a6efb488bc3b6a5948c47a8d1f9dd6cd3a30369`.
It fixes the database, run-event store, and stream bridge to `memory`.

The Flowise worker build accepts only upstream `worker.ts` SHA-256
`c1bd833235bcfde0fc1593a9a2cb49bce4e6c5e5fe9a9fc0d1435946223eced4`
from the pinned Flowise commit and produces patched SHA-256
`47f2efd0187dc104ac112a05eb13af60f072e43f4d6e51a122c470ed271f75cb`.
Its private HTTP check is ready only while the worker has refreshed owner-only
evidence within 15 seconds after a successful database query and live
prediction, upsertion, and schedule BullMQ connections. A running parent
process alone is never accepted. The Fly platform check and the in-Machine
identity probe both consume this contract. The Flowise adapter also performs
its own workspace-database and Redis client-name probes.

The source pack is not live deployment evidence. Keep
`AGENT_FRAMEWORK_EXECUTION_ENABLED=false` and
`AGENT_FRAMEWORK_KILL_SWITCH=true` until all release blockers below are closed
and a production receipt plus canary evidence has been reviewed.

## Release blockers

- Recorded complete-runtime scans for both the current Flowise pin and the
  audited official `3.1.3` comparison fail the zero HIGH/CRITICAL policy. No
  Flowise image is promotable from those candidates. Keep framework execution
  disabled until a complete replacement image passes the same gate and its
  exact evidence bundle is reviewed.
- The protected image-publishing workflow now resolves every built base to a
  digest, builds one reviewed `linux/amd64` wrapper per component, scans it,
  signs it, publishes SPDX and maximal SLSA provenance, verifies the evidence,
  and associates every final digest with a stopped holder Machine for Fly
  registry retention. This source is not production evidence until that
  workflow completes for the exact release SHA and its artifact is reviewed.
- `cosign` and `trivy` remain mandatory in the protected operator environment.
  `prepare` fails if the signature, populated SPDX SBOM, exact release and
  upstream provenance, or vulnerability/secret/misconfiguration gate cannot
  be verified.
- Fly outbound traffic has not yet been constrained and tested so that only the
  model gateway can reach a public model provider. Private ingress does not, by
  itself, deny outbound Internet access.
- The source topology uses one Machine and one volume per active stateful app. It does
  not provide PostgreSQL high availability. A reviewed HA design and a timed
  snapshot restore drill are still required for an enterprise availability
  claim.
- A new Flowise instance needs a private administrator bootstrap, workspace
  binding, least-privilege API key, and readiness sentinel before the runtime
  manifest can pass adapter readiness.
- The current Kimi credential returned HTTP 402 in the last recorded live
  check. A funded or entitled provider account, an approved returned model ID,
  and a real authenticated model canary are required.

## Immutable image promotion

`docker-bake.hcl` wraps seven promoted upstream image digests and emits SBOM
and maximal provenance attestations. The protected workflow is canonical. For
an offline Bake inspection, supply every identity explicitly; empty inputs fail
before a build starts:

```sh
FLY_WRAPPER_REGISTRY=registry.example/aria-agent-frameworks \
POSTGRES_UPSTREAM_IMAGE=registry.example/postgres@sha256:<digest> \
REDIS_UPSTREAM_IMAGE=registry.example/redis@sha256:<digest> \
DEERFLOW_UPSTREAM_IMAGE=registry.example/deerflow@sha256:<digest> \
FLOWISE_UPSTREAM_IMAGE=registry.example/flowise@sha256:<digest> \
FLOWISE_WORKER_UPSTREAM_IMAGE=registry.example/flowise-worker@sha256:<digest> \
ADAPTER_UPSTREAM_IMAGE=registry.example/aria-adapter@sha256:<digest> \
MODEL_GATEWAY_UPSTREAM_IMAGE=registry.example/aria-model-gateway@sha256:<digest> \
RELEASE_SOURCE_COMMIT=<aria-release-40-hex> \
POSTGRES_SOURCE_COMMIT=<postgres-source-40-hex> \
REDIS_SOURCE_COMMIT=<redis-source-40-hex> \
DEERFLOW_SOURCE_COMMIT=<deerflow-source-40-hex> \
FLOWISE_SOURCE_COMMIT=<flowise-source-40-hex> \
DEERFLOW_PATCHED_RUNS_SHA256=<sha256> \
DEERFLOW_CLEANUP_GUARD_SHA256=<sha256> \
DEERFLOW_RUNTIME_POLICY_SHA256=<sha256> \
DEERFLOW_RUNTIME_CONFIG_SHA256=<sha256> \
DEERFLOW_DATABASE_BACKEND=memory \
DEERFLOW_RUN_EVENTS_BACKEND=memory \
DEERFLOW_STREAM_BRIDGE_TYPE=memory \
docker buildx bake -f infra/agent-frameworks/fly/docker-bake.hcl --push
```

Resolve each pushed wrapper to its final digest. Sign that digest with the
reviewed keyless identity. Publish `spdxjson` and `slsaprovenance`
attestations. The provenance predicate must contain the exact 40-hex ARIA
release commit and the independently reviewed upstream commit at canonical
BuildKit parameter paths. The two adapter roles must use
one identical adapter image digest, and the two Redis manifest roles must use
one identical Redis image digest. Only the Flowise Redis role may have an
active Machine, volume, or password. DeerFlow provenance must also contain the
exact patched `runs.py`, cleanup guard, runtime policy, runtime configuration,
database backend, run-event backend, and stream-bridge identities listed
above. The operator accepts those claims only under the SLSA invocation
parameters or build-definition external parameters and rejects provenance
missing any one of those bindings.

## Secret files

The operator reads local secret-manager material only from owner-only files.
Every file must contain one independent base64url value of at least 32
characters and have mode `0600`. Configure these environment variables with
file paths, never values:

- `ARIA_FLY_SECRET_DEERFLOW_MODEL_GATEWAY_TOKEN_FILE`
- `ARIA_FLY_SECRET_DEERFLOW_MODEL_PROVIDER_API_KEY_FILE`
- `ARIA_FLY_SECRET_DEERFLOW_INTERNAL_TOKEN_FILE`
- `ARIA_FLY_SECRET_DEERFLOW_ADAPTER_TOKEN_FILE`
- `ARIA_FLY_SECRET_FLOWISE_DB_PASSWORD_FILE`
- `ARIA_FLY_SECRET_FLOWISE_REDIS_PASSWORD_FILE`
- `ARIA_FLY_SECRET_FLOWISE_ENCRYPTION_KEY_FILE`
- `ARIA_FLY_SECRET_FLOWISE_JWT_AUTH_SECRET_FILE`
- `ARIA_FLY_SECRET_FLOWISE_JWT_REFRESH_SECRET_FILE`
- `ARIA_FLY_SECRET_FLOWISE_SESSION_SECRET_FILE`
- `ARIA_FLY_SECRET_FLOWISE_TOKEN_HASH_SECRET_FILE`
- `ARIA_FLY_SECRET_FLOWISE_API_KEY_FILE`
- `ARIA_FLY_SECRET_FLOWISE_ADAPTER_TOKEN_FILE`
- `ARIA_FLY_SECRET_AGENT_FRAMEWORK_CAPABILITY_SECRET_FILE`

The operator sends base64 file-secret values to `flyctl secrets import
--stage` over stdin. Secret values do not enter the plan, approval, command
arguments, receipt, or operator output. For an existing app, `prepare` rejects
every secret name outside the role's exact allowlist. After staging, deployment
and receipt replay require the complete exact allowlist. This rejects removed
database, Redis, tracing, or prior-architecture authority instead of silently
carrying it into the next Machine.

## Prepare, confirm, deploy

Create an owner-reviewed runtime manifest matching
`aria.agent-framework.fly-manifest.v2`. It binds the organization, `cdg`
region, default network, deployment/workspace/framework UUIDs, canonical
configuration SHA, exact provider/model/credential revision, Flowise workspace
and sentinel, and all ten signed image identities plus source commits and
certificate identities. Its required `deerflowRuntime` object must contain the
three exact SHA-256 identities and the three `memory` modes listed above. The
DeerFlow database and Redis images remain provenance-only and are marked
`releaseDisabled` in the plan. Protect the operator files locally:

```sh
chmod 600 /secure/aria-fly-manifest.json

node infra/agent-frameworks/fly/operator.mjs prepare \
  --manifest /secure/aria-fly-manifest.json \
  --plan /secure/aria-fly-plan.json
```

`prepare` performs only local checks, registry verification, vulnerability
scanning, and read-only Fly inventory. It validates all ten TOML files, rejects
an existing app outside the default 6PN or with an allocated Fly Proxy IP, and
rejects any DeerFlow database or Redis Machine and any secret on either
disabled role. It emits a 15-minute plan plus its
confirmation SHA. Independently review that plan, then bind approval to it:

```sh
node infra/agent-frameworks/fly/operator.mjs confirm \
  --manifest /secure/aria-fly-manifest.json \
  --plan /secure/aria-fly-plan.json \
  --confirmation <reviewed-plan-sha256> \
  --approval /secure/aria-fly-approval.json
```

Only the deploy command mutates Fly. It skips the release-disabled DeerFlow
database and Redis roles, creates the other absent apps on the default 6PN, stages file
secrets, and deploys each active exact image digest in dependency order with
`--no-public-ips --ha=false --strategy rolling`. The receipt records the
disabled roles without Machines. The explicit `--execute` flag is mandatory:

```sh
node infra/agent-frameworks/fly/operator.mjs deploy \
  --manifest /secure/aria-fly-manifest.json \
  --plan /secure/aria-fly-plan.json \
  --approval /secure/aria-fly-approval.json \
  --receipt-dir /secure/aria-fly-receipts \
  --execute
```

Deployment fails closed unless every app remains on the default 6PN with no
Fly Proxy IP, exactly one started Machine on the approved digest, passing
platform checks where configured, and fresh private readiness. Gateway
readiness authenticates and proves the exact live provider/model. Adapter
readiness authenticates and proves workspace, framework instance, source
commit, image digest, canonical configuration, and every dependency. An exact
DeerFlow in-Machine probe additionally hashes the live patched source, cleanup
guard, and configuration, parses all three memory backends, and proves tracing
is explicitly disabled with no persistence environment left behind. An exact
receipt replay performs fresh read-only image, secret, and readiness validation
and does not stage secrets or redeploy.

## Verification

```sh
npm run test:agent-framework-adapter

for config in infra/agent-frameworks/fly/*.toml; do
  flyctl config validate --config "$config"
done
```

The local tests prove config shape and operator contracts. They do not prove a
registry signature, cloud model, production Machine, private Flowise
bootstrap, backup restore, fault recovery, or real sourcing campaign.

## Snapshots, restore, and rollback

Fly creates scheduled snapshots for both active state volumes.
Inventory snapshots without exposing data:

```sh
flyctl volumes snapshots list --app aria-mantu-flowise-db
flyctl volumes snapshots list --app aria-mantu-flowise-redis
```

Restore into a new encrypted volume, never over the source volume:

```sh
flyctl volumes create <volume-name> \
  --app <stateful-app> \
  --region cdg \
  --snapshot-id <reviewed-snapshot-id> \
  --scheduled-snapshots \
  --yes
```

Attaching the restored volume requires a separately reviewed Machine
replacement. Record the source snapshot, new volume, exact image digest,
applicable database integrity checks, elapsed recovery time, and rollback
decision in the change ticket. Never restore one Redis plane into the other or
restore Flowise PostgreSQL data into another role. Image rollback requires a
new prepare/confirm/deploy cycle using the last accepted signed digest and its
matching configuration.
