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
`79b6601066faa937a2d0b5551f7e1a5311304f1e7b28962c1ccee72cea05d6e7`.
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

The source pack is not live deployment evidence. Keep
`AGENT_FRAMEWORK_EXECUTION_ENABLED=false` and
`AGENT_FRAMEWORK_KILL_SWITCH=true` until all release blockers below are closed
and a production receipt plus canary evidence has been reviewed.

## Release blockers

- The upstream DeerFlow and Flowise Dockerfiles consume some mutable base
  tags. A source Git commit is not a reproducible image identity. The release
  pipeline must resolve every base to a digest, build and promote a final
  wrapper digest, and publish a signed SBOM and SLSA provenance statement that
  binds the final digest and exact reviewed source commit.
- `cosign` and `trivy` must be installed in the protected operator environment.
  `prepare` fails if the signature, SPDX SBOM, provenance, or zero-high/critical
  vulnerability gate cannot be verified. These tools are not installed in the
  current local workspace, so no promotion evidence was verified here.
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
and maximal provenance attestations. Supply only `repo@sha256:...` values:

```sh
FLY_WRAPPER_REGISTRY=registry.example/aria-agent-frameworks \
POSTGRES_UPSTREAM_IMAGE=registry.example/postgres@sha256:<digest> \
REDIS_UPSTREAM_IMAGE=registry.example/redis@sha256:<digest> \
DEERFLOW_UPSTREAM_IMAGE=registry.example/deerflow@sha256:<digest> \
FLOWISE_UPSTREAM_IMAGE=registry.example/flowise@sha256:<digest> \
FLOWISE_WORKER_UPSTREAM_IMAGE=registry.example/flowise-worker@sha256:<digest> \
ADAPTER_UPSTREAM_IMAGE=registry.example/aria-adapter@sha256:<digest> \
MODEL_GATEWAY_UPSTREAM_IMAGE=registry.example/aria-model-gateway@sha256:<digest> \
docker buildx bake -f infra/agent-frameworks/fly/docker-bake.hcl --push
```

Resolve each pushed wrapper to its final digest. Sign that digest with the
reviewed keyless identity. Publish `spdxjson` and `slsaprovenance`
attestations. The provenance predicate must contain the exact 40-hex
`sourceCommit` from the deployment manifest. The two adapter roles must use
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
