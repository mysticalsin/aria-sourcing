# Aria E2E proof on `odoo` tip `7c5e892d`

Synthetic data only. Michaël's `odoo` tip was not rewritten, rebased, or pushed.

## Tip lock

| Check | Expected | Observed |
|---|---|---|
| Branch | `odoo` (no open PR at start) | `odoo` |
| Commit | `7c5e892d09036439513227fcc1d404e813549f3a` | match, still HEAD of `odoo` |
| Tree | `c179636ebc8d0cf109c87117c88fc52dee879480` | match |
| Author / subject | Michaël BERNARD · 2026-11-25T09:04:04Z · docs(relay): shift 471 handoff | match |

## Verdict: PARTIAL

The product path on this tip works for shift 471 and for a fake-Odoo hire. The stock Local Docker demo script and the release gate do not pass.

| Path | Result |
|---|---|
| Scoring model 2 on a manual synthetic candidate | YES. Score **52**. Skills not shown in the snippet count as neutral. |
| Contact floor on | YES. Glass box **Blocked**: "Match score 52 is below the 70 contact floor." Toast "Approval blocked". |
| Contact floor off | YES, after the settings save finished. Toast "Approved: queued for send" / "Match score 52 is below 70; the contact floor is off in Settings." Stored row: `status=Approved`, `dryRun=false`, `approvedBy=Operator`. No email was sent. |
| Fake Odoo 20 hire | YES. Odoo `20.0-20261123`, database `aria`. Applicant **#42** created on job "Synthetic Floor Hire e2e9", moved to hired stage "Contract Signed". ARIA sync toast: "Sora Floorproof: Sourced → Hired". Campaign strip: **1 hired**. |
| `npm run test:local-demo` | NO. See below. |
| GitHub release gate on this tip | FAIL. Secret scan FAIL and Local Docker demo FAIL. Quality, Dependency audit, Database security, Analyze (javascript-typescript) SUCCESS. |

## What was run

Disposable Compose project `aria-acceptance-e2e-proof-003` from this tip (`APP_PORT=3101`), plus `docker/odoo` project `aria-odoo` (Odoo 20, admin/admin, database `aria`). The app container had `ODOO_ALLOW_HTTP=true` and shared the Odoo network. Server address used by ARIA: `http://odoo:8069`. No LinkedIn call. Candidate: **Sora Floorproof**, email `sora.floorproof.<run>@example.test`, company "Example Synthetic Co", skill "Go", lawful basis consent.

Identity of the passing browser run: campaign `camp_1795609377812_synthetic-floor-hire-e2e9`. A follow-up approval of that same draft, after the settings write had returned HTTP 200, is what persisted `Approved`. The first toast in the same session was shown while a settings save was still in flight; `commit()` did not keep that attempt, and the row stayed "Needs Approval" until the second click.

## Screenshots

- `01_workspace_ready.png` — Check connections, core workspace ready
- `02_contact_floor_switch_on.png` — Settings, block-below-minimum on
- `04_synthetic_candidate_score.png` — manual candidate, model 2
- `06_guardrail_floor_block.png` / `06_approval_blocked_by_floor.png` — floor blocks approval at score 52
- `12_reapprove_floor_off.png` — floor off, "Approved: queued for send"
- `09_odoo_connected.png` — Connected to Odoo 20.0-20261123
- `10_sent_to_odoo.png` — applicant created
- `11_synced_hired.png` — "1 hired", Sourced → Hired

## GitHub checks on `7c5e892d` (run 45581889577)

- Quality: success
- Dependency audit: success
- Database security: success
- Analyze (javascript-typescript): success
- Secret scan: **failure**. `gitleaks 8.30.1` scanned 1854 commits and reported 8 leaks. The same config on the current tree reports 2: `generic-api-key` at `tests/odoo-integration.mts:17` (synthetic in-memory fixture) and `linkedin-client-secret` at `src/lib/store/sourcing-actions.ts:333` (8-character identifier, entropy ~3.3, not a credential). Values are not copied here.
- Local Docker demo: **failure**. Job log: the app container became healthy, then `container aria-acceptance-45581889577-1-agents-1 has no healthcheck configured`. `docker-compose.yml` sets `agents.healthcheck.disable: true` (the image healthcheck probes the web server; the runner is not a web server). `scripts/accept-local-demo.mjs` uses `docker compose up --wait`, which exits 1. The script then tears the stack down. It never reaches browser login. Release gate fails because local demo and secret scan failed.
- Vercel Preview Comments: success. Preview URL from the task was not used for this proof (owner decision: Vercel is not the runtime; the demo is the local stack).

## Local `npm run test:local-demo`

Command (ports 3101 / 54331 / 54332, `ARIA_BROWSER_CHANNEL=chrome`, full `ARIA_RELEASE_SHA`):

```
ARIA_LOCAL_ACCEPTANCE=1 ARIA_ACCEPTANCE_PROJECT=aria-acceptance-e2e-proof-002 \
APP_PORT=3101 API_PORT=54331 DB_HOST_PORT=54332 \
ARIA_BROWSER_CHANNEL=chrome \
ARIA_RELEASE_SHA=7c5e892d09036439513227fcc1d404e813549f3a \
npm run test:local-demo
```

Docker Compose **v5.8.0** on this machine did not fail `--wait` on the agents service (`agents-1 Healthy`). The script then failed in the browser:

```
locator.fill: Timeout 30000ms exceeded.
waiting for getByRole('dialog', { name: 'Add a candidate' }).getByLabel('Name', { exact: true })
locator resolved to <input id="_r_8_-linkedin-name" ...>
element is not visible
```

`TabPanel` keeps a visited tab mounted with the `hidden` attribute. The LinkedIn tab is the default, so `getByLabel('Name')` binds that hidden input instead of the Manual tab field. Login, readiness, and campaign creation had already succeeded. Exit code 1.

This VM's first attempt died earlier: `iptables-legacy` had `FORWARD` policy `DROP` and only accepted `docker0`, so containers on the Compose bridge could not open TCP to each other (`db-init` timed out connecting to `db`). Setting the legacy FORWARD policy to ACCEPT was an environment fix, not a repo change. After that, container TCP worked (Odoo 20 setup completed).

## Not done

- No change to `odoo` or any `mbe-*` branch.
- No live LinkedIn, no real candidate data, no secrets committed.
- The stock acceptance script was not patched on this tip. A passing `npm run test:local-demo` needs a Compose that accepts `healthcheck.disable` on `agents` (or a real agents healthcheck) and a Manual-tab locator that ignores the hidden LinkedIn inputs.
