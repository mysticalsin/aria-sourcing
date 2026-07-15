# Contributing to ARIA

ARIA handles recruiting data and external communication authority. Small,
reviewable changes are preferred over broad rewrites.

## Before changing code

1. Read [`README.md`](README.md) and
   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
2. Read [`production-readiness/STATUS.md`](production-readiness/STATUS.md) for
   the source and release boundary.
3. If another agent or developer is active, read
   [`_relay/HANDOFF.md`](_relay/HANDOFF.md) and preserve every existing
   working-tree change.
4. Use Node 22 and install from the lockfile with `npm ci`.

## Change workflow

1. State the behavior or invariant being changed.
2. Find the narrowest owning module and its existing tests.
3. For a bug or behavior change, add a failing regression test first and run it
   to confirm the expected failure.
4. Implement the smallest complete fix.
5. Run the focused test, then the mandatory repository gate.
6. Review the diff for unrelated edits, secret material, stale documentation,
   and authority expansion.
7. Commit one logical change with an evidence-based message.

Do not discard an uncommitted file because it looks unfamiliar. This repository
is used by multiple tools in shared and linked worktrees.

## Mandatory gate

```bash
npm run typecheck && npm run typecheck:tests && npm test
```

Also run `npm run lint` for source changes. Use
`npm run build:isolated` for production-build verification in a OneDrive
checkout.

See [`docs/TESTING.md`](docs/TESTING.md) for focused database, security, and
release gates.

## Architecture rules

- Browser state does not grant server authority.
- Live identity comes from the authenticated principal, profile role, and RLS.
- Shared `workspace_state` is collaboration state, not credential, provider,
  integration-origin, agent-owner, approval, or delivery authority.
- Every live Agent run is bound to one workspace, owner, and active AgentSpec.
- Agent graph drafts stay in run history and have no delivery authority.
- Candidate replies require named human review before any send path.
- Unknown, unsupported, or ambiguous authority fails closed.
- Provider outcomes that may have been accepted are not automatically retried.
- LinkedIn remains assisted-manual unless an official signed integration is
  available.

## Database changes

- Add a new numbered file under `supabase/migrations/`; never edit production
  history in place.
- Inspect later migrations that replace the same function, policy, trigger, or
  privilege.
- Preserve direct-session owner and migrator boundaries.
- Add static contract tests and a disposable-Postgres behavior test when the
  change affects RLS, privileges, claims, memory, or migrations.
- Do not run `supabase db push` against Fly production. The protected
  bootstrap ledger is the only production migration path.

## API and integration changes

- Authenticate before resolving a secret or making an external request.
- Validate request size and shape.
- Apply workspace, owner, role, and domain checks on the server.
- Keep external origins and secret bindings in normalized admin-owned records.
- Redact upstream errors and never return provider bodies or credentials.
- Classify external mutations as definitive success, definitive pre-transport
  failure, or ambiguous outcome.

## Documentation changes

- Put current developer guidance under `docs/`.
- Put current Fly release procedures under `production-readiness/`.
- Mark historical evidence as historical; do not update an old audit body to
  resemble current evidence.
- Keep source readiness, release eligibility, and live health as separate
  claims.
- Update `tests/docs-truth.mts` when a current documentation contract changes.

## Commit and review

- Keep one logical concern per commit.
- Do not force-push shared integration or release branches.
- Do not advance the protected release branch until exact-SHA checks and
  recovery evidence are green.
- A reviewer should be independent of the author for security, authority,
  migration, recovery, and deployment changes.
- Record adversarial findings in [`_relay/codex-findings.md`](_relay/codex-findings.md).

## Completion evidence

A change is ready for review only when the relevant command output is current,
the worktree contains no unintended files, and every skipped or externally
blocked verification step is named explicitly.
