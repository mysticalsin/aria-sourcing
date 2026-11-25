---
project: MSourcing / ARIA
shift: 3
agent: cursor-qa
updated: 2026-11-25 16:10 America/Sao_Paulo
status: in-progress
---

# Handoff — PR #299 red QA

## Current state
- Draft PR https://github.com/mysticalsin/aria-sourcing/pull/299 stays draft. Not merged. PR body was not edited.
- Branch `cursor/a07-rust-router-1aac`. Previous tip `145a54e2cc350ca90650cba70192d2d683194b11`.
- Fixes are local until the push recorded in `internal/pr-299-qa.md`.
- Inherited CI reds (npm audit, image scan, release gate, flyctl, gitleaks, database security) were not changed.

## Done this shift
- Failing tests, then fixes, for the 90-day recontact parser, profile identity ports, C ABI row identity, caller cancellation, and a panic that kept a budget reservation.
- `cargo +stable test --locked --workspace` in `core/` passed.
- `go test -count=1` and `-race` in `services/router` passed.
- `cargo +stable build --release --locked -p aria-ffi` and `go test` in `core/go/aria` passed.
- The TypeScript app was not changed, so `npx tsc` and `npm test` were not run.

## Blockers
- none in this diff. Draft stays draft. MERGE HOLD.

## Next steps
1. Leave #299 draft. Do not merge, do not touch main, do not force-push.
2. Do not edit the PR body.
3. Inherited reds stay as they are.

## Decisions made (don't relitigate)
- A date-time with no zone is UTC. The window does not follow the machine zone.
- `T24:00:00` is the next UTC midnight. Second 60 is not a contact.
- A non-default port is part of the profile identity. `:443` and `:80` stay omitted.
- Display name is not a dedupe or entity key. The C ABI writes per input index.
- A cancelled caller context is returned. It is not a fallback classification.
- A provider panic still re-panics as `ErrInfra` and releases the reservation.

## Watch out
- Do not retarget this PR onto `vercel-demo` or merge it.
- `core/target/` is build output. Do not commit it.
