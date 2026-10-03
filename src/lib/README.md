# Domain and runtime library map

`src/lib/` contains application logic shared by pages, route handlers, workers,
and tests. It must not depend on `src/components/` or `src/app/`; the executable
boundary is enforced by `tests/module-boundaries.mts`.

## Stable entrypoints

| Path | Responsibility |
|---|---|
| `store.ts` | Stable `@/lib/store` client-state facade and provider |
| `store/contracts.ts` | React-free public store action and context types |
| `types.ts` | Central persisted-domain model; change only with serialization and migration evidence |
| `gate.ts` | Candidate-text human-likeness checks, dedupe hashing, quiet hours, and pacing |
| `dispatch-outbound.ts` | Server-side delivery claim, dispatch, and reconciliation |

## Directories

| Path | Responsibility | Boundary |
|---|---|---|
| `agents/` | Agent specifications, execution, framework contracts, and memory rules | Framework output is proposal-only; database authority remains in ARIA |
| `ai/` | AI runtime contracts, client and server adapters, web tools, provider selection, and redaction | Provider credentials and unrestricted fetch authority remain server-side |
| `api/` | Shared request parsing, validation, and proxy helpers | Route authentication and workspace authority remain server-owned |
| `demo/` | Synthetic demo support | No production side effects or real candidate data |
| `dust/` | Dust integration contracts and helpers | Admin-owned configuration only |
| `integrations/` | External-system authority and mapping | Server-side connection ownership and tenant checks |
| `launch/` | User-selectable sample-brief input | Live launch still uses the reviewed campaign action and real-source path |
| `needs/` | Intake readiness validation | Preserve evidence and explicit unknowns |
| `server/` | Authenticated-principal and production side-effect boundaries | Never reachable from a Client Component |
| `sourcing/` | Candidate mapping, provider authority, and learning controls | No synthetic fallback in live mode |
| `store/` | Small React-free store action factories and contracts | `store.ts` remains the public facade |
| `supabase/` | Supabase configuration, browser/server clients, and workspace persistence | Service-role clients are server-only |
| `voice/` | Browser speech and intent helpers plus the guarded TTS route client | Provider credentials stay behind the server route |

## Change rules

- Use `@/...` imports inside `src/` and preserve the direction
  `app -> components -> lib`.
- A module with `"use client"` must not reach `server-only`, `next/headers`,
  `next/server`, or `src/lib/server/**` at runtime.
- Keep `store.ts` and `types.ts` paths stable. Extract one characterized domain
  boundary at a time behind their existing public contracts.
- Find the matching negative test before changing authentication, tenant scope,
  provider access, approvals, delivery, persistence, or candidate privacy.

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for system flow and
[`docs/OWNERSHIP.md`](../../docs/OWNERSHIP.md) for verified responsibility roles.
