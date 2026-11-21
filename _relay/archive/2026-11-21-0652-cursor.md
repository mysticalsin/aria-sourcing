---
project: MSourcing / ARIA
shift: 474
agent: cursor
updated: 2026-11-21
status: integration-sweep-1
---

# Handoff - Shift 474

## Current state

- `integration/aria-all` carries the sweep 1 fixes. The click head recorded in the artifact is `07c6f17e51eec97b0a1c658fd2f1de35b1455ffe`. A later commit passes `APP_PORT` through `sudo` and records this sweep.
- Sweep 1 click run: 13 pass, 0 fail. Artifact `e2e-artifacts/20261121T055210Z/`. Notes: `docs/integration/SWEEP-01.md`.
- Stress A1–A7 pass on that head. A5 no longer stores a touch after hire. A3 resumes a pause. A8 passed at 1800.045s in `e2e-artifacts/20261121T052026Z/`.
- Odoo serves `http://127.0.0.1:8069/aria/pipeline`. The host's legacy filter was dropping bridge packets; the sweep script accepts `172.16.0.0/12` to `172.16.0.0/12` before compose.
- Draft fix PRs: #210 (base), #211 (#172), #212 (#177), #214 (#171), #216 (#175), #217 (#174), #220 (#176). #214 and #220 are not stacked; #203 and #202 already sit above those parents.

## Done this shift

- Root-caused the sweep 0 failures and fixed them on the owning heads, then merged those heads back here.
- A typed `example.test` person can be added in the demo. Outreach opens one exact-text draft and posts one dry-run send. HeyReach is shown off. A hired applicant refuses a message touch. A pause can be resumed. The ingest poppler pin is `deb12u3`. The Odoo addon publishes `/aria/pipeline`.
- The token page starts as member. The harness sets `ARIA_E2E=1` and the journey acts as admin. There is no refresh RPC.

## Blockers

- None for the 13 journeys. The packaged app did not bind in the recorded run because `sudo` dropped `APP_PORT`. The script now passes that variable. `compose config` publishes the app on 3010.

## Next steps

1. Read `docs/integration/SWEEP-01.md`.
2. Do not merge `integration/aria-all`.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: Aria does not call the professional-network host. The extension and the bridge stay deleted. The token option is only `src/channels/linkedin-token/`, off by default.
- Tony, 2026-11-20: MANUAL is the default. FULL AUTOMATIC needs a QC pass bound to the exact body hash.
- `body_hash` is the wire hash. `exact_body_hash` is the exact binding. The daily cap is the Postgres counter from #167.
- ADR 0002 stays withdrawn. Do not put the agents service back.
- This branch is a test vehicle. Do not merge it.
- The token channel has no refresh RPC. Do not add one unless a later design says so.

## Watch out

- One Compose healthcheck: the app ready probe. Do not re-add `process.kill(1,0)` on an agents service.
- One accept-script locator: the visible Manual tabpanel Name field in `scripts/accept-local-demo.mjs`.
- Do not force-push or delete `mbe-branch`, `mbe-ngrok`, `mbe-test`, or `twa-odoo`.
- `sudo docker` drops `APP_PORT` unless the script passes it. The click demo stays on port 3000.
