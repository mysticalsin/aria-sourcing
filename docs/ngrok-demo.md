# Public demo URL (ngrok)

One HTTPS URL that testers open from their own machine, each with a demo account
and an empty workspace of their own. The stack stays on this Mac; ngrok forwards
its static domain to the gateway's public edge.

```
browser --https--> ngrok --> gateway :8080 (public edge)
                               |-- /auth/v1, /rest/v1 --> gateway :8000 (key check) --> GoTrue, PostgREST
                               '-- everything else ----> app :3000
```

The browser finds the Supabase API on the page's own origin
(`browserSupabaseUrl` in `src/lib/supabase/config.ts`), so the image needs no
public URL baked in. On `localhost:3000` nothing changes.

## What protects the owner's workspace

- **Rotated keys.** `docker-compose.yml` ships the public Supabase sample JWT
  secret: anyone could forge a service_role token. `scripts/tunnel-keys.mjs`
  writes fresh ones to `.env`. The tunnel service refuses to start without them.
- **Sign-up closed** (`AUTH_DISABLE_SIGNUP=true`), and the edge also closes
  `/auth/v1/signup`, `/auth/v1/admin`, invite, OTP and magic links. Accounts
  exist only through `scripts/demo-accounts.mjs`.
- **One workspace per account.** Workspaces are keyed by email domain; each
  demo account has its own (`demo3@aria-demo3.test` → "Aria-Demo3.Test
  Workspace"). Never create a demo account in `@aria.local`: it would join the
  owner's workspace.
- **Owner password changed** from the published `admindemo123` to
  `DEMO_ADMIN_PASSWORD` in `.env`.
- **Closed on the edge:** the one-click owner login (`/api/auth/demo-login`),
  the agents and cron clocks, webhooks, the careers board, and any request that
  carries the service key.
- **LinkedIn:** nothing is sent from a tester's workspace until that tester
  installs the extension and pairs it with their own LinkedIn session (see
  below). The owner's extension only talks to `localhost`. Autopilot, in any
  workspace, contacts only the profiles in `AGENTS_LINKEDIN_ALLOWLIST`
  (`.env.local`) while it is set.

## Run it

No Node on the host: both scripts run in the Playwright image.

```sh
# 1. Rotate the sample keys, close sign-up, set an owner password (.env).
docker run --rm -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.61.1-noble \
  node scripts/tunnel-keys.mjs

# 2. Put your ngrok authtoken and static domain in .env:
#    NGROK_AUTHTOKEN=...
#    NGROK_DOMAIN=your-name.ngrok-free.app

# 3. Rebuild (the anon key is baked into the bundle) and recreate the stack.
docker compose up -d --build

# 4. Create (or reset) the demo accounts. List in .demo-accounts.local.md.
docker run --rm --network host -v "$PWD":/app -v aria_gate_node_modules:/app/node_modules -w /app \
  mcr.microsoft.com/playwright:v1.61.1-noble node scripts/demo-accounts.mjs --count 5

# 5. Open the tunnel.
docker compose --profile tunnel up -d
docker compose logs tunnel        # "started tunnel" with your URL
```

Stop the public URL: `docker compose stop tunnel`. The rest keeps running.

### LinkedIn extension for testers

The edge serves one file, `/downloads/aria-linkedin-bridge.zip`, from
`.demo-downloads/` (gitignored, mounted read-only in the gateway). Rebuild it
after any change to the extension:

```sh
rm -rf .demo-downloads && mkdir .demo-downloads
(cd extensions && zip -qrX ../.demo-downloads/aria-linkedin-bridge.zip linkedin-bridge -x '*.DS_Store')
```

Tester side, in Chrome:

1. Download `https://<NGROK_DOMAIN>/downloads/aria-linkedin-bridge.zip` and unzip it.
2. `chrome://extensions` -> Developer mode -> **Load unpacked** -> the
   `linkedin-bridge` folder.
3. Extension popup -> Settings -> ARIA address `https://<NGROK_DOMAIN>` -> Save,
   and allow the permission Chrome asks for.
4. Reload the ARIA tab -> **LinkedIn** -> **Connect in one click**. Stay signed
   in to linkedin.com in the same Chrome profile.

Invitations and messages then leave from the tester's own LinkedIn account,
which LinkedIn's User Agreement does not allow for automated tools.

Rerunning step 4 resets every demo password; workspaces and their data stay.

## Good to know

- AI spend is shared: every workspace counts against `AI_DAILY_BUDGET_USD` and
  `AI_MONTHLY_BUDGET_USD` (`.env.local`). Past the cap, AI calls fall back to
  the deterministic paths for everyone, the owner included.
- ngrok's free plan shows a one-time "You are about to visit" page; click
  "Visit Site".
- Rotating keys signs everyone out once. The LinkedIn extension keeps its own
  pairing and is not affected.
- Back to the sample keys: delete `.env`, then `docker compose up -d --build`.
  The owner password stays the one `demo-accounts.mjs` set.
