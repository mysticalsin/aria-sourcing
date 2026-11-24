---
project: MSourcing / ARIA
shift: 440
agent: cursor-grok
updated: 2026-11-24T16:48Z
status: ci-pending
---

# Handoff — Shift 440

## Current state

- Draft PR #318 stays draft. Base is `cursor/odoo-hire-traceability-d254` at `32b60ba3d0652cdfeffc124eaadb08d48c63295b`. Do not merge. Do not retarget. Do not touch #313, #317, #319, or #320.
- Branch `cursor/vacancy-close-shape-c32a`. Previous tip `f4a57ec00055ac020519156e2f1cea5f484fad6c` failed Release gate because Production image supply chain failed in "Build every production custom image".
- That step built the graphify image, then `npm run test:graphify-learning` failed `test_container_and_dependency_contract_is_bounded`: `workers/graphify-lessons/test_worker.py` rejects `apt-get` in the Dockerfile. The `apt-get upgrade` lines came from `b27c0682`.
- Those lines existed to clear fixed HIGH and CRITICAL Debian findings on `python:3.12-slim@sha256:090ba77e2958f6af52a5341f788b50b032dd4ca28377d2893dcf1ecbdfdfe203` (Debian 13.5). Removing the upgrade without moving the pin would fail the Trivy gate again.
- This shift pins both stages to `python:3.12-slim@sha256:4a68d3169325c47e1bafbb86425220f03fbdff6f079a419e8d39407183288217` (Python 3.12.16, Debian 13.8, published 2026-11-24) and deletes the `apt-get` block.
- Local Trivy 0.72.0 on that base rootfs, with `--severity HIGH,CRITICAL --ignore-unfixed=true`, reported 0 vulnerabilities. The same binary's secret scanner reported 0 findings. `.gitleaks.toml` and the CI secret-scan job were not edited. `linkedin-client-secret` stays armed.
- Host check: `test_container_and_dependency_contract_is_bounded` passed with a stubbed `graphify` import. `node --experimental-strip-types tests/sourcing-learning-operations.mts` passed 19. Docker is not installed here, so the container runtime test was not run locally.
- CI on the new tip is not terminal yet.

## Done this shift

1. Diagnosed both Release gate failures on `f4a57ec0` as the supply-chain job (push and pull_request). Quality, Dependency audit, Secret scan, Database security, and CodeQL were success.
2. Replaced the graphify base digest and removed `apt-get` so the worker contract and the fixed-vulnerability gate can both hold.

## Blockers

- Waiting on GitHub Actions for the new tip. The full image build and `test:graphify-learning` run only in that job.

## Next steps

1. If Production image supply chain or Release gate fails, read the job log and fix on this branch only. Do not disable a secret rule to get green.
2. Leave the pull request in draft. Do not merge.

## Decisions made (don't relitigate)

- Zod stays on 3.x on older local main notes; this branch already carries the Zod 4.6.7 change from `b27c0682`. Do not downgrade it here.
- LinkedIn policy stays assisted-manual or official Recruiter System Connect
- Do not copy cookie scraping, login evasion, Voyager, or the LinkedIn browser bridge
- `linkedInSourcingRunsWithoutErp` returns true. Connector sync is gated separately
- Unset `HIRE_CONNECTOR` prefers Odoo, then SMART, then the generic API, then MCP
- Demo hire requests strip Odoo, SMART, generic API, and MCP credentials
- #49 closed permanently; #51 was the Europe successor
- Slim Fly deploy preserves live 0079 migration identity
- The graphify image does not run `apt-get`. Released Debian fixes come from the pinned `python:3.12-slim` digest above.
- Do not weaken Gitleaks or the Trivy secret scanner to clear this gate

## Watch out

- `tests/public-fetch.mts` forbids a `fetch(` call in `src/lib/mcp-client.ts`. The hire runner takes an injected fetch and does not call `fetch(`
- `POST /api/hire` uses the same demo, origin, rate-limit, and `source` permission gates as `POST /api/source`
- A partial connector env does not call fetch; LinkedIn sourcing still completes
- Manifest contract hashes must be recomputed when a test is added. This shift did not add a test
- `FLY_API_TOKEN=local-validate-only` is only for local `flyctl config validate`. Do not commit it
- Do not push `cursor/hire-action-ui-defa` or `cursor/odoo-hire-traceability-d254`
- CI runs on push and on pull_request, so the same job name appears twice. Both must succeed
