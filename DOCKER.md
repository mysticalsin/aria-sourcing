# Running Aria Sourcing fully in Docker (with Supabase)

One `docker compose up` brings up the whole thing — the Next.js app **and** a self-hosted
Supabase backend (Postgres, GoTrue auth, PostgREST, Kong) — all in Docker. No host
`supabase start`, no external identity provider, no manual migration step.

## Start

```bash
docker compose up --build      # first run: builds images, applies migrations, seeds admin
```

Then open **http://localhost:3000** and sign in with **admin@hermes.local** /
**admindemo123** (email form). The bootstrap seeds this admin into the
"Hermes Workspace" (fixed id `00000000-0000-4000-8000-000000000001`).

First run pulls the Supabase images and runs `npm ci`, so it takes a few minutes. Later
runs are fast. Use `docker compose up -d` to run detached.

## Stop / reset

```bash
docker compose down            # stop everything; KEEPS the database (db_data volume)
docker compose up -d           # start again — your data (users, workspace, state) persists
docker compose down -v         # stop AND wipe the database; next `up` re-migrates + re-seeds
docker compose restart app     # restart just the app after a code change
```

## What comes up

| Service | Image | Role |
|---|---|---|
| `db` | supabase/postgres | Postgres with the Supabase roles, `auth` schema, extensions, and the app schema |
| `db-init` | postgres | one-shot: hands the `auth` schema to `supabase_auth_admin` so GoTrue starts clean |
| `auth` | supabase/gotrue | email+password login, JWT issuance |
| `rest` | postgrest | RLS-enforced CRUD + RPCs over `/rest/v1` |
| `kong` | kong | single API gateway (routes `/auth/v1` + `/rest/v1`), exposed on `:54321` |
| `supabase-bootstrap` | postgres+curl | one-shot: owner reconciliation, then `migrate.sh` applies every numbered migration in `supabase/migrations/` (hash-checked ledger), seeds + promotes the local admin user, reloads PostgREST |
| `app` | (this repo) | the Next.js dev server on `:3000` |

`docker compose ps` should show `db/auth/rest/kong` healthy and the two one-shots
`Exited (0)`.

## How the networking works

- The **browser** reaches Supabase at `NEXT_PUBLIC_SUPABASE_URL` = `http://localhost:54321`
  (Kong's host port).
- The **server** (inside the app container) reaches Supabase via `SUPABASE_URL` =
  `http://kong:8000` (Docker service name). `config.ts` prefers `SUPABASE_URL` on the
  server, so the browser never sees the internal address.
- The app runs in **LIVE mode** (Supabase-backed, login gate on) because the Supabase env
  is set — visiting `/` redirects you to `/login`, which a demo build never does.

## Ports

Defaults: app `3000`, Kong/Supabase API `54321`, Postgres `54322`. Override if they clash
with a host `supabase start` or another dev server:

```bash
APP_PORT=3001 KONG_PORT=54331 DB_HOST_PORT=54332 docker compose up
```

(`NEXT_PUBLIC_SUPABASE_URL` follows `KONG_PORT` automatically.)

## Notes

### Local LLM (Ollama / OpenAI-compatible)

Run Ollama on the host and install a model that supports tools. On macOS, run
Ollama outside Docker to use the host GPU. The app container connects through
`http://host.docker.internal:11434/v1`; a host-run `npm run dev` uses
`http://127.0.0.1:11434/v1`. Ensure Ollama listens on an address reachable from
Docker, with host firewall access restricted to your local app.

In Settings -> LLM providers, add **Local / OpenAI-compatible**, enter that base
URL and the exact installed model name (including its tag, e.g. `qwen3:8b`),
enable it and set it as default. No API key is needed for local Ollama. A gateway
requiring Bearer authentication can use a saved **Custom** key. Local requests
never borrow a hosted provider's environment key.

In Saved Models, assign a model from this provider as the default for each task
you want to run locally. Existing task defaults take priority over the default
provider. Disable hosted providers when all model inference must remain local.
Candidate search still queries GitHub/public search services: local inference
does not make sourcing offline.

For a functional test, start the Docker stack, sign in, create/review a campaign,
and click **Run agent**. The result must report `cloud` mode, include candidates
backed by actual search results, and include model drafts. A completed search
with zero matches returns an empty result. Profiles found without valid model
drafts return an explicit error; disable the provider to use deterministic real
search. Warm the model before testing to avoid the bounded request timeout.

Only private/loopback hosts are accepted by default. Deployment-owned exact DNS
names can be added via server environment `PROVIDER_ALLOWED_HOSTS` (comma-separated);
metadata addresses, URL credentials, query strings, fragments and redirects stay
blocked. The URL must expose OpenAI-compatible `/chat/completions` under the base
path. Direct Azure endpoints requiring `api-key` or `api-version` need a separate
adapter; a compatible gateway can use this provider.

See [Ollama's protocol documentation](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx).

- The Supabase keys in `docker-compose.yml` are the **public Supabase sample keys** — fine
  for a local stack only. For any non-local use, regenerate `JWT_SECRET` and the matching
  anon/service-role JWTs and override them.
- `.env.local` is optional and loaded if present. Put `DATA_ENCRYPTION_KEY` there
  (`openssl rand -base64 32`) so Settings can store API keys, plus any of `GITHUB_TOKEN`,
  `TAVILY_API_KEY`, Google / Microsoft OAuth, `RESEND_API_KEY`. The core stack runs
  without it.
- The public `/careers` board reads the seeded workspace (`CAREERS_WORKSPACE_ID` is set in
  `docker-compose.yml`). It answers 503 until the admin has signed in once, because the
  first sign-in creates the workspace document.
- Inspect the database directly: `docker compose exec db psql -U postgres -d postgres`.
  The `postgres` role cannot read `auth.users` (ownership hardening); use
  `-U supabase_admin` for auth tables.
- The `.next` build dir lives on an anonymous volume (not the OneDrive-synced checkout), so
  Next's output never corrupts the host copy.
