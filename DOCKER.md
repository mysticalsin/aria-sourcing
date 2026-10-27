# Local connected demo and development

The default stack runs the compiled application with Supabase authentication and
PostgreSQL persistence. It needs Docker Engine/Desktop and Compose 2.24 or newer.
Windows Docker Desktop needs WSL 2 or its supported virtualization backend.
No host Supabase CLI, Node installation, or LLM key is required for the core demo.

## Start and sign in

```bash
docker compose up --build --detach --wait --wait-timeout 300
```

Open **http://localhost:3000/login** and sign in with **admin@hermes.local** /
**admindemo123**. These are intentionally local sample credentials. Published
ports bind to loopback; this configuration is not a public Azure deployment.

The first build installs and compiles once. Later starts reuse the built image.
The app starts only after migrations and local account setup complete. Its health
check calls `/api/ready`, verifying the database, Auth, outbox and exact migration
ledger. `/api/health` is only process liveness.

Optional Node 22 helpers:

```bash
npm run demo:doctor   # check Docker and Compose configuration; changes no data
npm run demo:up       # build, start and wait for readiness
npm run demo:status   # include completed initialization jobs
npm run demo:stop     # stop and retain durable volumes
```

`scripts/local-supabase-up.sh` delegates to this same path. It no longer runs
`supabase db reset`, starts a second Supabase stack, or overwrites `.env.local`.

## What runs, and why

| Service | Lifecycle | Purpose |
|---|---|---|
| app | permanent | Compiled Next.js UI and server API, non-root user |
| db | permanent | PostgreSQL, RLS, campaigns, candidates and authority records |
| auth | permanent | GoTrue authentication and session refresh |
| rest | permanent | PostgREST CRUD and RPC under database authorization |
| kong | permanent | Shared Supabase API origin and key/JWT routing |
| db-init | exits after success | Reconcile database roles before Auth starts |
| supabase-bootstrap | exits after success | Migrate after Auth created its schema, seed the local admin |

There are **five running services**, not seven permanent services. The two jobs
have different ordering requirements. No Studio, Realtime, Storage, Redis,
local LLM server or agent framework is started. See
[the infrastructure decision](docs/adr/0001-local-runtime-and-azure-target.md).

## Persistence and restart

```bash
docker compose down
docker compose up --detach --wait --wait-timeout 300
```

Both commands retain **db_data** (database) and **app_config** (local encryption
key). New campaigns and candidates survive browser refresh and a complete stack
restart. Initialization is repeatable and the existing account is not recreated.
A wrong database credential fails initialization instead of wiping the database.

The app creates a random encryption key once, in the protected app_config volume,
when no DATA_ENCRYPTION_KEY is supplied. It reuses that key on every restart.
Provider keys and mailbox credentials can therefore be encrypted without manual
setup. Back up and restore the database and its encryption key together.
Deleting volumes deletes data or makes encrypted credentials unreadable.

If `.env.local` already supplies DATA_ENCRYPTION_KEY, keep that same value. An
invalid key or one differing from an existing generated key fails startup rather
than silently making stored credentials unreadable. Use the application's key
rotation procedure for a deliberate rotation.

## Connection diagnostics

As the administrator, open **Settings -> Workspace -> Check connections**.

- **Verified** means the backend check passed now.
- **Configured** means credentials/configuration are saved; provider connectivity
  and an actual search/send still need their own acceptance test.
- **Missing** optional integrations do not block the core workspace.
- **Blocked** means a core dependency or credential encryption needs attention.

This check does not call a paid LLM, start sourcing, send mail, or expose keys.
Real discovery needs provider setup; the synthetic `npm run dev` showcase still
uses browser-local fixtures and is a different mode.

## Ports and public configuration

Default app/API/database ports are 3000, 54321 and 54322. Put custom values in a
local `.env` file before building:

```dotenv
APP_PORT=3101
KONG_PORT=54331
DB_HOST_PORT=54332
```

Then rerun the start command. Auth callbacks, browser CSP and the compiled browser
backend URL use these values. Changing public URLs requires rebuilding the image;
the runtime detects an image/configuration mismatch and refuses to start.
The server reaches Supabase internally at `http://kong:8000`.

Optional provider/OAuth credentials belong in `.env.local` or Settings as
appropriate; no setup command overwrites that file. A stored workspace Apify key
is required for its LinkedIn adapter. Configure one GPT/Claude provider later.

## Development only

```bash
npm run docker:dev
# or:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This selects the development image, mounts source, and enables hot reload. Only
this mode mounts node_modules and .next volumes. The encryption-key volume is
shared with the normal demo. On Linux, ensure the development container's node
user can write generated files in the source checkout.

## Repeatable acceptance on a disposable stack

The **Local Docker demo** CI job performs browser login, UI campaign and manual
fixture candidate creation, encrypted fixture-key storage, refresh, full down/up,
a fresh login, and checks record persistence and credential decryption. It uses
custom ports to exercise URL/CSP/cookie configuration. External discovery and
outreach are deliberately excluded.

On the Docker machine, use Node 22 and Playwright's installed Chromium, or set
`ARIA_BROWSER_CHANNEL=chrome` (or `msedge`) for an installed browser:

```bash
ARIA_LOCAL_ACCEPTANCE=1 ARIA_ACCEPTANCE_PROJECT=aria-acceptance-local-001 \
APP_PORT=3101 KONG_PORT=54331 DB_HOST_PORT=54332 npm run test:local-demo
```

PowerShell users set the same names with `$env:NAME='value'` before the npm
command. Use a new acceptance project name each time. The script refuses a
normal project name or external/shared volumes and removes only its isolated
acceptance stack at the end. Never point it at a working database.

## Future Azure target

The app's standalone runtime image is reusable, but this local Compose file is
not production configuration. The proposed first internal target keeps the same
service boundaries on a private Linux VM, durable managed storage, Key Vault
secrets and HTTPS ingress. No cloud resource is deployed by these commands.

A direct swap to Azure PostgreSQL Flexible Server is currently blocked by the
bootstrap's superuser requirement. The ADR records the compatible initial target,
managed-service migration prerequisites, and deployment gates.

## Local model option (deferred)

Local / OpenAI-compatible remains available. Host Ollama outside the app container;
use `http://host.docker.internal:11434/v1` from Docker or
`http://127.0.0.1:11434/v1` from a host-run app. Enter the exact installed model tag,
e.g. `qwen3:8b`, and set task-default Saved Models. A local Ollama key is optional;
an authenticated compatible gateway can use a saved Custom key. On Linux add an
appropriate Docker host-gateway mapping if that hostname is not provided.

Only private/loopback hosts are accepted by default; server-side
PROVIDER_ALLOWED_HOSTS can add deployment-owned exact DNS names. Metadata hosts,
URL credentials/query/fragment and redirects remain blocked. Direct Azure
api-key/api-version endpoints need a dedicated adapter. Local inference still
uses external candidate search services.
