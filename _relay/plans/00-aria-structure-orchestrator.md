---
project: MSourcing / ARIA
plan: senior-developer-structure-orchestrator
owner: Sonnet-Integrator
model: claude-sonnet-4-6
status: in-progress-plan-01-complete
updated: 2026-07-14
---

# ARIA structure orchestrator

## Outcome

Make the repository easier for a senior full-stack developer to navigate and
maintain without changing public paths, authority boundaries, or production
behavior. Execute the four linked plans in order. Never run two implementers
against the shared worktree at the same time.

## Start gate

From `/Users/tony/.codex/worktrees/msourcing-campaign-integration`:

```sh
sed -n '1,260p' AGENTS.md
sed -n '1,320p' _relay/HANDOFF.md
test -z "$(git status --porcelain)"
! rg -n '^## Shift 40 in progress' _relay/HANDOFF.md
git rev-parse HEAD
graphify query "ARIA repository organization, test orchestration, store facades, and path contracts" --budget 2400
```

If Graphify reports a missing graph, check `graphify-out/wiki/index.md`. If
both are absent, record that exact fallback in the baton and inspect source.

Create one worktree from the clean local `main` SHA:

```sh
git worktree add -b codex/aria-structure-hygiene-20260714 \
  /Users/tony/.codex/worktrees/msourcing-structure-hygiene main
```

## Required order

1. [CI reconciliation and navigation](01-ci-reconciliation-and-navigation.md)
2. [Test manifest](02-test-manifest.md)
3. [Test typecheck and documentation truth](03-test-typecheck-and-doc-truth.md)
4. [Store extraction and release proof](04-store-extraction-and-release-proof.md)

For every task: write a failing contract, make the smallest patch, run focused
proof, request an independent read-only review, fix every concrete finding,
then stage only exact owned files. Never use `git add .`, `git add -A`, or a
directory-wide add. Update `_relay/HANDOFF.md` at each plan boundary.

## Non-negotiable constraints

- Keep `src/lib/store.ts`, `src/lib/types.ts`, deployment scripts, migrations,
  Fly files, `_relay/`, and production-readiness paths stable.
- Do not move root assets or `floor-verify.mjs` without verified external-use
  evidence. This program does not authorize those moves.
- Do not weaken strictness, security gates, RLS, approvals, negative tests, or
  the sandbox runner's keep-going diagnostic behavior.
- Preserve synthetic-only fixtures. No candidate data, secrets, provider IDs,
  or approval material may enter tests, screenshots, commits, or Relay.
- Local green proof does not authorize a production deploy or an enterprise
  readiness claim.
