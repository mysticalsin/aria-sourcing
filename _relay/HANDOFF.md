---
project: MSourcing / ARIA
shift: 472
agent: cursor
updated: 2026-11-23 14:08 America/Sao_Paulo
status: linkedin-token-devin-followup
---

# Handoff - Shift 472

## Current state

- Branch `cursor/linkedin-token-channel-3374`, PR #178, base `twa-odoo` (`e3fa3f594a6d86aec31d42a65414a96be4c8400e`). Do not merge.
- Tip: `git rev-parse HEAD` on this branch. Additive commits only. No force push.
- The channel stays in `src/channels/linkedin-token/`. It is off until an owner or admin records the risk notice.
- `next` in the lockfile is still 16.4.3. This branch does not upgrade Next.js.

## Done this shift

- Expanded, compatible, and NAT64 IPv4 embeddings are refused, along with unspecified, multicast, and CGNAT answers. A public mapped address is still allowed.
- Dedupe no longer retries a timeout. A timeout still keeps the approval and the cap slot.
- `probePinnedTls` shares the pinned certificate name with the production HTTPS request. A test certificate for another name fails the handshake.
- A pumped send that is still queued or sending is marked failed when the result is a refusal.
- `.gitleaks.toml` allowlists one historical line: the SHA-256 of a retired sample HMAC. `gitleaks git --log-opts=--all` on this tree exits 0 (1754 commits, no leaks). History was not rewritten.

## Blockers

- None for this follow-up. Sentinel CONSENSUS is PENDING. Do not merge.

## Next steps

1. Wait for CI on the new tip. Do not merge.
2. Stack conflicts with #251, #272, and #282 are shared files (`.gitleaksignore`, `docker-compose.yml`, `scripts/accept-local-demo.mjs`, `tests/test-manifest.mjs`, `_relay/HANDOFF.md`, `.github/workflows/ci.yml`). Do not rewrite those tips.

## Decisions made (don't relitigate)

- Tony: the token option stays the existing one, off by default, with approved text, daily caps, a kill switch, and auto-pause.
- H-01, NEW-2, and NEW-6 stay as already fixed.
- A timeout keeps the cap slot and the approval. It does not start a second transport attempt.
- Do not upgrade Next.js on this branch.

## Watch out

- `@playwright/test` is pinned to 1.65.1. `scripts/e2e-mac.sh` refuses Node versions other than 22.x.
- The gitleaks exception is one exact digest line, not a path.
