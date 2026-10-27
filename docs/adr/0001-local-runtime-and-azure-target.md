# ADR 0001 - A lean, reproducible local runtime and an Azure-compatible image

Date: 2026-10-27
Status: accepted for the local demo; Azure topology proposed, not deployed

## Context

The current app depends on Supabase Auth, PostgREST, JWT roles, RLS and SQL RPCs.
The checked-in bootstrap requires a direct supabase_admin superuser session.
Reducing container count by replacing these boundaries would be an application
and authorization rewrite, rather than removing unused infrastructure.

## Local decision

Keep five long-running services:

| Service | Responsibility | Why retained |
|---|---|---|
| app | Next.js UI and authenticated server routes | Recruiting product |
| db | PostgreSQL and durable state | Campaigns, candidates and authority |
| auth | GoTrue identity, sessions and token refresh | Existing authentication contract |
| rest | PostgREST, scoped CRUD and RPC | Existing RLS-backed persistence contract |
| kong | Shared /auth/v1 and /rest/v1 API origin, key routing | Existing Supabase client protocol |

Keep two short-lived jobs. db-init reconciles owner/role credentials before Auth
starts; supabase-bootstrap waits for Auth's schema, applies app migrations and
seeds the local account. Combining them without an explicit initialization
protocol creates an ordering cycle. Exited jobs consume no steady-state CPU.

Do not add Studio, Realtime, Storage, Edge Functions, Redis, a separate AI server,
or worker orchestration for this slice. The hosted LLM is an external API.

The default app is a compiled standalone image, running as a non-root user.
Hot reload and source/dependency mounts belong to docker-compose.dev.yml only.
The runtime checks the exact baked migration ledger and public configuration.
Health means /api/ready returns 200, not merely that an HTTP server responds.

Two durable volumes are paired: db_data and app_config. The latter holds the
local generated encryption key. Stop/restart never removes either volume.
A supplied encryption key must be valid and must not silently replace a stored
local key. Normal setup never resets the database or overwrites .env.local.

## Azure target

Reuse the standalone app image and the same five service responsibilities for
the first internal pilot. A private Linux VM running Compose is the lowest
migration-risk initial target: keep PostgreSQL and the key material on durable
managed storage, use a managed identity to retrieve secrets from Key Vault,
and terminate HTTPS at the existing gateway or the organization's ingress.
No Kubernetes/AKS or extra agent platform is justified for the pilot.

This is a topology decision, not an executable production deployment. The local
Compose file contains public sample JWTs and a seeded admin and must not be
published as-is. Before an Azure deployment, prepare a separate configuration
with rotated secrets, no local seeded login, fixed HTTPS origins, image digests,
private network access, database/key backup and a tested restore procedure.
The default image refuses automatic key generation outside ARIA_LOCAL_DEMO.

Azure Database for PostgreSQL Flexible Server is a later migration option,
not a drop-in substitute for db. Its administrator is not a true PostgreSQL
superuser; the current bootstrap explicitly requires one. First adapt and
prove the role/ownership/bootstrap contract on a disposable managed instance,
then consider Container Apps for app/auth/rest/gateway and a managed database.
Do not weaken RLS or grant the app owner privileges to make that migration pass.

## Acceptance

The required local Docker CI job must prove a clean start, browser login,
campaign and manual candidate creation, encrypted credential storage, browser
refresh, a full down/up without volume deletion, fresh login, restored records,
and successful decryption of the stored synthetic credential. External LLM,
search, email and calendar acceptance remains separate.

## Sources

- [Supabase self-hosting architecture](https://supabase.com/docs/guides/self-hosting/docker)
- [PostgREST native readiness probe](https://docs.postgrest.org/en/v14/references/cli.html)
- [Azure PostgreSQL administrative role restrictions](https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control)
- [VM managed identity and Key Vault](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/tutorial-linux-managed-identities-vm-access)