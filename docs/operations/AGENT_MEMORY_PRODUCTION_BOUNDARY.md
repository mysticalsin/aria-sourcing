# Agent memory production boundary

ARIA treats operator-authored agent memory as untrusted free text. The current
candidate-erasure authority cannot prove that an operator's `classification:
none` statement is complete without inspecting encrypted content. Production
therefore disables new free-text content until a structured, database-verifiable
memory format replaces that assertion.

## Runtime contract

When `NODE_ENV=production`, the authenticated memory API enforces this boundary:
POST create and PATCH content edit operations are disabled; non-content
operations remain available under their existing owner authority.

| Operation | Production behavior |
| --- | --- |
| `POST /api/agents/memories` | `403` with `code: memory_content_writes_disabled` |
| `PATCH` edit containing `content` | Same typed `403` response |
| `GET` | Read remains available to the exact owner scope |
| `PATCH` metadata-only edit | Kind, pinned state, expiry, and review metadata remain available |
| `PATCH` approve/reject | Remains available |
| `DELETE` | Remains available so content can be tombstoned |

Every response is JSON with `Cache-Control: no-store`, `Pragma: no-cache`, a
request ID, and no submitted content. Development and test environments retain
the content-write path so the replacement structured contract can be developed
and verified without presenting it as production authority.

## Database boundary

Migration `0059_candidate_payload_provenance.sql` keeps `SELECT` on the legacy
`agent_runs` and `agent_events` tables but revokes direct `service_role`
mutation. PostgreSQL-owned `SECURITY DEFINER` RPCs remain the only mutation path
and continue to enforce their exact workspace, owner, actor, and provenance
checks. The guarded rollback restores only the grants that existed before 0059.

## Graphify independence

Graphify sourcing lessons do not depend on the agent memory route or the legacy
`agent_runs` and `agent_events` write grants. The lesson worker consumes the
redacted, structured sourcing evidence contract and the sourcing runtime binds a
human-promoted lesson snapshot before provider egress. Disabling operator
free-text memory therefore does not disable sourcing adaptation.

## Verification

Run the focused source and route checks:

```sh
node --import tsx tests/agent-memory-authority.mts
node --experimental-test-module-mocks --import tsx --test tests/agent-memory-route.mts tests/agent-memory-route-adversarial.mts
```

Run the disposable PostgreSQL proof for migration, rollback, RPC execution, and
candidate-erasure behavior:

```sh
bash tests/candidate-erasure-db.sh
```

This source boundary is not evidence that a production migration or deployment
has occurred. Release readiness must separately attest the exact migration and
deployed application SHA.
