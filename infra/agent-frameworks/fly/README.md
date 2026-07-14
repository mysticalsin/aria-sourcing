# Private Fly deployment pack

This directory defines ten separate Fly apps for the ARIA-owned DeerFlow and
Flowise boundary. Every app uses the default organization 6PN, has no
`services` or `http_service` section, requests no public IP during deployment,
and runs one always-on Machine. The two PostgreSQL apps and two Redis apps use
independent encrypted Fly volumes and independent secret authorities.

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
- The source topology uses one Machine and one volume per stateful app. It does
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
one identical adapter image digest, and the two Redis roles must use one
identical Redis image digest, while their apps, volumes, and passwords remain
separate.

## Secret files

The operator reads local secret-manager material only from owner-only files.
Every file must contain one independent base64url value of at least 32
characters and have mode `0600`. Configure these environment variables with
file paths, never values:

- `ARIA_FLY_SECRET_DEERFLOW_DB_PASSWORD_FILE`
- `ARIA_FLY_SECRET_DEERFLOW_REDIS_PASSWORD_FILE`
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
arguments, receipt, or operator output.

## Prepare, confirm, deploy

Create an owner-reviewed runtime manifest matching
`aria.agent-framework.fly-manifest.v1`. It binds the organization, `cdg`
region, default network, deployment/workspace/framework UUIDs, canonical
configuration SHA, exact provider/model/credential revision, Flowise workspace
and sentinel, and all ten signed final image digests plus source commits and
certificate identities. Protect the operator files locally:

```sh
chmod 600 /secure/aria-fly-manifest.json

node infra/agent-frameworks/fly/operator.mjs prepare \
  --manifest /secure/aria-fly-manifest.json \
  --plan /secure/aria-fly-plan.json
```

`prepare` performs only local checks, registry verification, vulnerability
scanning, and read-only Fly inventory. It validates all ten TOML files, rejects
an existing app outside the default 6PN or with an allocated Fly Proxy IP, and
emits a 15-minute plan plus its confirmation SHA. Independently review that
plan, then bind approval to it:

```sh
node infra/agent-frameworks/fly/operator.mjs confirm \
  --manifest /secure/aria-fly-manifest.json \
  --plan /secure/aria-fly-plan.json \
  --confirmation <reviewed-plan-sha256> \
  --approval /secure/aria-fly-approval.json
```

Only the deploy command mutates Fly. It creates absent apps on the default
6PN, stages file secrets, and deploys each exact image digest in dependency
order with `--no-public-ips --ha=false --strategy rolling`. The explicit
`--execute` flag is mandatory:

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
receipt replay performs only fresh read-only validation and does not stage
secrets or redeploy.

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

Fly creates scheduled snapshots for all four independent state volumes.
Inventory snapshots without exposing data:

```sh
flyctl volumes snapshots list --app aria-mantu-deerflow-db
flyctl volumes snapshots list --app aria-mantu-flowise-db
flyctl volumes snapshots list --app aria-mantu-deerflow-redis
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
database integrity checks, elapsed recovery time, and rollback decision in the
change ticket. Never restore one framework's Redis or PostgreSQL data into the
other framework's app. Image rollback requires a new prepare/confirm/deploy
cycle using the last accepted signed digest and its matching configuration.
