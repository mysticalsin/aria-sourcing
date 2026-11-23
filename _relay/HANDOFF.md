---
project: MSourcing / ARIA
shift: 471
agent: cursor
updated: 2026-11-23
status: linkedin-token-devin-followup
---

# Handoff - Shift 471

## Current state

- Branch `cursor/linkedin-token-channel-3374`, PR #178, base `twa-odoo` (`e3fa3f59`). Do not merge.
- Tip after the mapped-address and timeout follow-up: see `git rev-parse HEAD`.
- The channel stays in `src/channels/linkedin-token/`. It is off until an owner or admin records the risk notice.
- `next` in the lockfile is still 16.4.3. This branch does not upgrade Next.js.

## Done this shift

- IPv4-mapped private addresses are refused the same way as private IPv4.
- A pinned `www.linkedin.com` address is fetched with the certificate name `www.linkedin.com` and certificate checking left on.
- A timeout keeps one transport attempt and does not free the cap slot or the approval.
- The queued-send test checks that the next send runs after the current one finishes.
- A JSON body whose message says login stays an accepted answer. Checkpoint URLs and redirects still pause.

## Blockers

- `gitleaks git --log-opts=--all` still reports one finding on commit `0f2b86e1238067f7525245a7f492d90ee25737b9` (`scripts/jwt-secret-policy.mjs:4`). That commit is not reachable from this head. A scan of `HEAD` reports zero findings. The fingerprint was not added here.

## Next steps

1. Leave this tip frozen after the PR body update. Do not merge.
2. Stack conflicts with #251, #272, and #282 are shared files (`.gitleaksignore`, `docker-compose.yml`, `scripts/accept-local-demo.mjs`, `tests/test-manifest.mjs`, `_relay/HANDOFF.md`, `.github/workflows/ci.yml`). Do not rewrite those tips.

## Decisions made (don't relitigate)

- Tony: the token option stays the existing one, off by default, with approved text, daily caps, a kill switch, and auto-pause.
- H-01, NEW-2, and NEW-6 stay as already fixed.
- Do not upgrade Next.js on this branch.

## Watch out

- `@playwright/test` is pinned to 1.65.1. `scripts/e2e-mac.sh` refuses Node versions other than 22.x.
- Full-history gitleaks sees other branches. A clean `HEAD` scan does not mean `--all` is clean.
