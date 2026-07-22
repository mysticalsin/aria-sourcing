# Need ingress production throttle

`POST /api/webhooks/needs` verifies a timestamped HMAC and resolves a tenant
credential before it writes a requisition. The handler has a local pre-auth
limit of 20 requests per minute for each trusted network identity. That check
runs before service-client construction and any database RPC.

The local counter is per-process. It does not provide a shared limit across
Machines and it does not protect against requests distributed across source
networks. Production therefore refuses need ingress and reports readiness false
unless both of these activation-owned values are present:

- `ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED=true`
- `ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256=<64 lowercase hex>`

A bare `true` is not authority. Every normal release sets the flag to `false`
and the evidence digest to an empty string. Only the protected sourcing
activation gate may populate them, and re-dark clears both.

## Activation evidence

Keep the setting `false` until all of the following are recorded in the release
evidence:

1. A shared atomic limiter or an edge policy covers `/api/webhooks/needs` on
   every public origin, including the direct Fly hostname. There must be no
   alternate route that bypasses the policy.
2. The shared policy groups traffic by a trusted network or client identity. An
   attacker-controlled credential key must not create a new limit bucket.
3. Excess requests return HTTP 429 with a positive `Retry-After` header. The
   response must not be cached.
4. A test sends one combined burst through at least two web Machines and proves
   that the shared threshold is enforced across both Machines.
5. A valid signed request below the limit still reaches the durable tenant-bound
   ingestion transaction, while an invented key above the limit causes no
   service-client construction or database RPC.

## Signed receipt contract

The independent verifier signs one bounded JSON receipt after the tests above
actually pass. Signing uses HMAC-SHA-256 over canonical JSON (object keys sorted
recursively) with the top-level `signature` field omitted. The verification key
is a 32-byte base64url value without padding. Store the receipt and key only as:

- `ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_JSON`
- `ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_HMAC_KEY`

The first secret belongs to the protected
`Production-Need-Ingress-Throttle-Proof` environment. The key is also required
by `Production-Sourcing-Activation` so the downloaded artifact is independently
revalidated immediately before Machine mutation. Never place either value in
the repository, an artifact, or `_relay/`.

The receipt is exact-key and binds all of the following:

- schema/status, `aria-mantu-app`, `/api/webhooks/needs`, release SHA, and the
  accepted digest-pinned app image;
- the sorted set of HTTPS public origins, including
  `https://aria-mantu-app.fly.dev`;
- the sorted IDs of at least two currently running web Machines;
- hashed policy identity and revision, provider, request limit, and window;
- positive assertions for every-origin coverage, trusted-identity bucketing,
  combined multi-Machine enforcement, 429, positive `Retry-After`, `no-store`,
  and a successful signed request below the limit;
- zero origin requests and zero database writes for the blocked invented-key
  probe; and
- canonical `testedAt`/`expiresAt` timestamps with a maximum 24-hour evidence
  lifetime.

`signature` must be `sha256=<64 lowercase hex>`. Unknown fields, reordered or
duplicate origin/Machine sets, a stale receipt, a different release/image,
fewer than two active web Machines, or a changed signed assertion all fail
before any Machine mutation.

## Protected activation flow

When `activate_sourcing=true`, the deployment workflow does not trust a boolean
or use the raw secret directly in the activation job:

1. `verify-need-ingress-throttle-evidence` runs behind the separate
   `Production-Need-Ingress-Throttle-Proof` approval, obtains the exact accepted
   release receipt and current Fly Machine inventory, validates the signed
   receipt, and archives only the validated JSON.
2. The activation job accepts only the artifact ID/digest emitted by that same
   run. It rechecks the exact artifact name, run ID, release head SHA, expiry,
   digest, and bounded size before downloading by artifact ID.
3. The gate revalidates the HMAC and live Machine inventory, then generates an
   exact operational plan that sets the flag and the canonical evidence digest.
4. `/api/ready` and `/api/webhooks/needs` require both values. Every failure
   after mutation runs the exact re-dark plan, which restores `false` and clears
   the digest.

This workflow verifies evidence; it does not provision an edge/shared limiter
and it cannot manufacture a passing receipt. Until an owner deploys the real
policy, runs the two-Machine test, and supplies a valid signed receipt, sourcing
activation is intentionally blocked.

## Local safety-net verification

Run:

```sh
node --import tsx --test tests/need-ingress.mts tests/need-ingress-authority.mts tests/readiness.mts tests/sourcing-activation-gate.mts
```

This proves the application-side limit and fail-closed configuration contract.
It does not prove the external shared policy.
