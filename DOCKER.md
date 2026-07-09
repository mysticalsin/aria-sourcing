# Running Aria Sourcing fully in Docker (with Supabase)

One `docker compose up` brings up the whole thing — the Next.js app **and** a self-hosted
Supabase backend (Postgres, GoTrue auth, PostgREST, Kong) — all in Docker. No host
`supabase start`, no external identity provider, no manual migration step.

## Start

```bash
docker compose up --build      # first run: builds images, applies migrations, seeds admin
```

Then open **http://localhost:3000** and sign in:

- one-click **`admin` / `admin`**, or
- the email form: **admin@hermes.local** / **admindemo123**

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
| `supabase-bootstrap` | postgres+curl | one-shot: applies migrations `0001` through `0015`, seeds + promotes the admin user, reloads PostgREST |
| `obscura` | pinned Rust source build | read-only browser-research sidecar; no host port, stealth, or private-network access |
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

- The Supabase keys in `docker-compose.yml` are the **public Supabase sample keys** — fine
  for a local stack only. For any non-local use, regenerate `JWT_SECRET` and the matching
  anon/service-role JWTs and override them.
- `.env.local` is optional and loaded if present — put provider keys there (GitHub, WhatsApp,
  Twilio, OAuth, `DATA_ENCRYPTION_KEY`, …) to light up those integrations. The core stack
  runs without it.
- Inspect the database directly: `docker compose exec db psql -U postgres`, or point any
  client at `localhost:54322` (user `postgres`, password `postgres`).
- The `.next` build dir lives on an anonymous volume (not the OneDrive-synced checkout), so
  Next's output never corrupts the host copy.

### Restricted build egress

The `obscura` image caches Rusty's pinned V8 archive with BuildKit. If the
builder cannot reach GitHub Releases on its first build, provide a
non-secret, owner-controlled mirror with the upstream layout, for example:

```bash
RUSTY_V8_MIRROR=https://artifacts.example.internal/rusty_v8 docker compose build obscura
```

For the currently pinned dependency, that mirror must serve
`v137.3.0/librusty_v8_release_aarch64-unknown-linux-gnu.a.gz`. Verify the
artifact’s checksum before publishing it. Do not put credentials in
`RUSTY_V8_MIRROR`, because Compose passes it as a build argument.
