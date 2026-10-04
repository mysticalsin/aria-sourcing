# ARIA internal API contract policy

ARIA's browser-facing Next.js routes are internal APIs. They use additive-only
contracts under `/api` for the current version. A breaking request, response,
authentication, or error change must move to `/api/v2` and keep the previous
contract for at least three months.

The machine-readable contract starts at [`api/openapi.yaml`](api/openapi.yaml).
New or changed routes must be added to that file before implementation. Existing
routes not yet represented remain technical debt and must be added as their
boundaries are changed.

## Error contract

Contracted routes return at least the following error fields:

```json
{
  "ok": false,
  "code": "STABLE_MACHINE_CODE",
  "requestId": "opaque-correlation-id"
}
```

Some route families add an optional bounded `error` message when their existing
contract requires one. Memory and candidate-erasure routes intentionally omit
it. Messages never contain upstream bodies, secrets, personal data, internal
paths, or database details. Callers branch on `code`, not message text.

## Paid provider actions

Paid or irreversible provider work requires all of the following:

1. a server-issued candidate and target from a provider search;
2. a successfully persisted candidate document followed by an explicit exact
   campaign, candidate, and target selection in normalized server authority;
3. resource-level workspace authorization from normalized server authority;
4. a short-lived, single-use confirmation nonce;
5. a caller-generated idempotency key;
6. an atomic database claim and workspace/principal quota check before provider
   I/O;
7. a terminal receipt that replays without a second provider call;
8. non-retryable reconciliation when the provider outcome is ambiguous.

The candidate document proves that the operator saved the server-issued tuple;
it never supplies provider identity. Provider identity, selection, quota, and
the paid claim remain normalized server authority. Select, prepare, and claim
all re-check the exact saved tuple, so candidate removal or anonymization
revokes paid authority immediately.

### Retention and erasure

Encrypted Apollo email receipts have a hard 30-day database expiry. A dedicated
Fly cleanup process runs at startup and every six hours, paginates workspaces,
drains bounded batches, isolates per-workspace failures, and emits structured
counter/error events to Fly logs. An admin candidate-rights action erases the
exact campaign/candidate/target receipt immediately and returns an append-only
audit event. A lost response or shared-state conflict converges on retry by
returning the original erasure event without creating a second event.

Candidate anonymization removes the known structured operational copies in the
shared document. Required suppression records, provider-side DSR handling,
logs, caches, and backups follow their own controlled retention policies and
must not be described as immediately deleted by this operation.

### Ambiguous-outcome recovery

Apollo does not provide this adapter with a verified transaction-status lookup.
An ambiguous or expired in-progress attempt therefore never becomes retryable
automatically. The admin-only reconciliation operation requires an exact
attempt version, a bounded case reference, and a SHA-256 evidence digest. It can:

- quarantine an expired in-progress lease as ambiguous;
- record a verified email or verified no-match as the terminal receipt; or
- release a target only after evidence proves no provider call or charge occurred.

Every accepted transition writes an append-only, secret-free audit event. A
release does not refund quota and a later provider attempt still requires a new
confirmation nonce and idempotency key. Direct SQL edits, automatic ambiguous
retries, and quota refunds are outside the supported contract. The operator
procedure is in
[`operations/APOLLO_ENRICHMENT_RECONCILIATION.md`](operations/APOLLO_ENRICHMENT_RECONCILIATION.md).

## Authentication and request integrity

- Supabase Auth identifies the caller in live mode through the `sb-auth-token`
  session cookie, including numbered chunks when the session exceeds one cookie.
- RBAC is checked per operation and normalized resource.
- All Apollo browser POST routes require JSON and an `Origin` that exactly matches the
  request URL origin. Missing or foreign origins are rejected before provider
  or authority work.
- Search requests have a best-effort, per-instance sliding-window throttle of
  10 requests per 60 seconds. Selection and enrichment requests have the same
  kind of throttle at 15 requests per 60 seconds. Keys include route scope, trusted
  proxy address, and authenticated user. These in-memory limits are
  defense-in-depth controls, not cluster-wide spend authority.
- Paid enrichment spend is authorized separately by the atomic Postgres claim.
  The current database-backed daily limits are 100 claims per workspace and 25
  per user. A terminal replay does not create another provider call or spend
  claim.
- The admin reconciliation operation has a best-effort per-instance throttle of
  20 requests per 60 seconds and never invokes Apollo. Admin erasure is limited
  to 15 requests per 60 seconds.
- Sensitive responses use `Cache-Control: no-store`.

## Apollo route status contract

All five routes use the typed error contract above. In addition to operation-level
errors, malformed JSON or invalid fields return `400`, oversized bodies return
`413`, unsupported content types return `415`, and unavailable live authority
returns `503`. Search provider failures return `502`. Enrichment returns `409`
for confirmation, idempotency, in-progress, or reconciliation conflicts, and
`502` when a provider outcome is unknown and must not be retried automatically.

The OpenAPI document is authoritative for the exact machine codes available at
each status. `Retry-After` is present for per-instance request throttling. A
database spend-quota rejection also returns `429`, but does not currently emit
`Retry-After`.

## Contract tests

Every contracted route has a consumer-perspective test in `tests/`. Tests prove
request validation, response shape, resource authorization, provider call
counts, idempotent replay, concurrency behavior, error redaction, and headers.
