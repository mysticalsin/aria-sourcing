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
contract requires one. Candidate-erasure routes intentionally omit it. Messages never contain upstream bodies, secrets, personal data, internal
paths, or database details. Callers branch on `code`, not message text.

## Authentication and request integrity

- Supabase Auth identifies the caller in live mode through the `sb-auth-token`
  session cookie, including numbered chunks when the session exceeds one cookie.
- RBAC is checked per operation and normalized resource.
- Mutating browser routes require JSON and an `Origin` that exactly matches the
  request URL origin. Missing or foreign origins are rejected before provider
  or authority work.
- Routes apply best-effort, per-instance sliding-window throttles keyed by route
  scope, trusted proxy address, and authenticated user. These in-memory limits
  are defense-in-depth controls, not cluster-wide spend authority. Admin erasure
  is limited to 15 requests per 60 seconds.
- Sensitive responses use `Cache-Control: no-store`.

## Contract tests

Every contracted route has a consumer-perspective test in `tests/`. Tests prove
request validation, response shape, resource authorization, provider call
counts, idempotent replay, concurrency behavior, error redaction, and headers.
