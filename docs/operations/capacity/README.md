# Capacity release gate

Status: executable gate present, 50,000-user capacity unproven.

The gate measures one exact, approved staging profile. It does not convert a
registered-user count into a concurrency fact. The checked-in profile currently
states these planning assumptions:

- 50,000 registered users;
- 500 peak concurrent sessions, or 1% of registered users;
- two read requests per active session per minute;
- 16.67 target requests per second for five minutes;
- at most 50 in-flight requests from the test runner.

These values have not been measured or approved. The profile stays
`pending-owner` and points to an `.invalid` staging origin until the product
owner ratifies the business workload and an operator provisions a paid staging
environment. A green offline test is only harness validation.

## Safety boundary

`scripts/capacity-release-gate.mjs` refuses to run HTTP probes unless all of
these conditions hold:

1. The profile is owner-ratified and names an exact HTTPS staging origin.
2. The same origin is supplied again through `--allow-origin`.
3. The hostname contains a staging marker and is not the production Fly host.
4. `ARIA_CAPACITY_SYNTHETIC_TENANT_ID` starts with `synthetic-capacity-`.
5. `ARIA_CAPACITY_AUTH_COOKIE` contains only the synthetic tenant's
   `sb-auth-token` cookie or chunks.
6. A named owner attests the synthetic workspace, no-external-effects posture,
   and SHA-256 digest of that exact session cookie for at most 24 hours.
7. Every request is GET or HEAD to a checked read-only app path.

The runner never calls sourcing, provider, webhook, dispatch, outreach, or
campaign mutation routes. It does not retain response bodies. Redirects are not
followed. Responses, request count, duration, response bytes, request timeout,
and in-flight concurrency are bounded. Production origins cannot be overridden.

## Evidence flow

The gate is deliberately two-phase so platform telemetry covers the same load
window instead of being guessed by the client.

### 1. Ratify and provision

Copy `workload-profile.v1.json` to a reviewed profile revision. Replace the
`.invalid` origin with the dedicated staging origin, then set:

```json
"ratification": {
  "status": "approved",
  "approvedBy": "named-owner",
  "approvedAt": "2026-07-21T15:00:00.000Z"
}
```

Validate without network access:

```sh
node scripts/capacity-release-gate.mjs validate-profile \
  --profile docs/operations/capacity/workload-profile.v1.json
```

### 2. Capture bounded HTTP evidence

Create an isolated tenant containing synthetic candidates and synthetic
agent specifications only. Copy
`synthetic-tenant-attestation.example.v1.json`, change its kind to
`aria-capacity-synthetic-tenant-attestation`, replace every example value, and
set `sessionCookieSha256` to the lowercase SHA-256 digest of the exact cookie
string. A named owner must approve it, and its validity may not exceed 24
hours. Export the cookie locally, never into the profile, attestation, or
receipt. Run against staging only:

```sh
export ARIA_CAPACITY_SYNTHETIC_TENANT_ID='synthetic-capacity-<run-id>'
export ARIA_CAPACITY_AUTH_COOKIE='sb-auth-token=<synthetic-session>'

node scripts/capacity-release-gate.mjs probe \
  --profile <approved-profile.json> \
  --origin https://<staging-host> \
  --allow-origin https://<staging-host> \
  --release-sha <40-lowercase-hex> \
  --tenant-attestation <synthetic-tenant-attestation.json> \
  --output <http-observation.json>
```

The probe records status-derived errors and p50/p95/p99 input samples for
health, deep readiness, a bounded candidate-page read, and an agent-specification
list read.
It does not write application data.

### 3. Export operational metrics and fault evidence

During the exact HTTP window, the staging monitoring system must export:

- at least ten queue-age samples and the duplicate-delivery count;
- database-unavailable recovery;
- queue-worker-restart recovery;
- provider-timeout recovery with `externalContacts: 0`;
- peak CPU, memory, and database-connection utilization.

`operational-metrics.fixture.v1.json` shows the shape only. Its
`synthetic-operational-fixture` kind is intentionally rejected by the staging
gate. Real evidence must use `staging-operational-metrics`, the same release,
origin, synthetic tenant, and attestation digest as the HTTP observation, and a
telemetry window that fully covers the HTTP window. Fault injection belongs in
isolated staging stubs. Do not disable a shared database or call a live provider.

### 4. Evaluate and write the receipt

```sh
node scripts/capacity-release-gate.mjs gate \
  --profile <approved-profile.json> \
  --http <http-observation.json> \
  --metrics <staging-operational-metrics.json> \
  --receipt <capacity-receipt.json>
```

The command exits nonzero if any required metric is absent or a threshold is
breached. The JSON receipt binds the profile, raw evidence, exact release,
decision, summary, and failures with SHA-256 digests. Receipt integrity detects
later edits, but it is not a third-party signature.

## Proposed thresholds

All thresholds are proposals until the workload is ratified:

| Signal | Proposed gate |
|---|---:|
| Health p95 / p99 | 250 ms / 500 ms |
| Readiness p95 / p99 | 750 ms / 1,500 ms |
| Authenticated reads p95 / p99 | 500 ms / 1,000 ms |
| Health/readiness error rate | at most 0.1% |
| Authenticated-read error rate | at most 0.5% |
| Queue age p95 / maximum | 60 s / 120 s |
| Duplicate deliveries | 0 |
| Fault recovery / error rate | 30 s / at most 1% |
| External contacts in provider-timeout test | 0 |
| CPU / memory / DB connections | 70% / 75% / 70% peak |
| Minimum resource headroom | 25% |

Passing this profile establishes only that one release met this one ratified
staging workload. It does not establish unlimited scale, production availability,
multi-region tolerance, provider throughput, write capacity, or a 50,000-session
peak. The current runner translates 500 active sessions into an aggregate arrival
rate but uses one attested synthetic session for authenticated reads. It therefore
does not prove 500 distinct authentication sessions or multi-tenant distribution.
A session-pool profile, stress run, and soak run need separate approved revisions
and receipts before those claims can be made.

## Local verification

No network is used by the deterministic test:

```sh
node --import tsx --test tests/capacity-release-gate.mts
```
