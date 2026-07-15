# AGENTS.md — ARIA / MSourcing

This project is worked concurrently by Claude Code and Codex CLI in the same
worktree. Read this file before touching anything.

## Division of labor (Tony, 2026-07-09)

- **Claude Code = builder + integrator.** Implements features, runs the full
  test gate (`npm run typecheck` + `npm run typecheck:tests` + `npm test`), commits in small reviewable
  chunks, pushes, verifies deploys, keeps the goal state
  (`_agent_state/mantu-goal/*.json`) and this project's baton honest.
- **Codex = adversarial auditor.** Reviews the code Claude (or Codex itself)
  writes for correctness bugs, security gaps, spec-compliance mismatches, and
  missing edge cases. Write findings to `_relay/codex-findings.md` (create it
  if absent, template below) rather than only fixing silently — a paper trail
  of what was wrong and why beats a silent diff.
- **Either tool may write code.** Whoever writes a feature does NOT have to
  be the one who commits it — Claude Code treats any uncommitted working-tree
  content as real work to review, test, and commit, not scratch to discard.
  Never assume uncommitted files are noise; `git status` is ground truth for
  what the other tool has done.
- **No stopping to ask for permission on either side.** Full autopilot: build,
  audit, fix, test, commit, push. Escalate only on an actual irreversible risk
  (secrets, destructive git ops, production data) — normal iteration doesn't
  wait for a human.

### Codex findings template (`_relay/codex-findings.md`)

```markdown
## <date> — <short title>
**Severity:** correctness | security | spec-mismatch | test-gap
**File:** path:line
**Issue:** what's wrong, concretely — not "could be cleaner"
**Repro/evidence:** the input/state that breaks, or the spec line violated
**Suggested fix:** optional, one line
**Status:** open | fixed (commit hash) | wontfix (reason)
```

Claude Code checks this file at the start of every session/loop iteration and
triages every `open` entry before starting new feature work.

---

## Relay Baton — shift handoff (MANDATORY)

This project uses `_relay/HANDOFF.md` as shared memory between AI tools (Claude Code, Codex, Antigravity, Xcode). Treat every session as a shift:

1. **Shift start:** Read `_relay/HANDOFF.md` BEFORE anything else. It is the freshest ground truth. Honor the "Decisions made" section — do not relitigate settled decisions. Tell the user in one line what you're resuming.
2. **During:** Update `HANDOFF.md` at milestones and the moment you hit a blocker.
3. **Shift end:** Archive the current baton to `_relay/archive/<YYYY-MM-DD-HHMM>-<your-tool-name>.md`, then rewrite `HANDOFF.md` as a fresh snapshot: frontmatter (project, shift n+1, agent, updated, status) + sections: **Current state** (verifiable facts), **Done this shift**, **Blockers** (exact errors), **Next steps** (ordered, executable without conversation context), **Decisions made (don't relitigate)**, **Watch out**.

Rules: facts over narrative; name files/commands/errors; never delete `archive/`; no secrets in `_relay/`; commit `_relay/` to git.

## Test gate (both tools must keep this green)

```
npm run typecheck && npm run typecheck:tests && npm test
```

The command list is owned by `package.json`; do not copy a suite count into
this contract. If either tool's change breaks the gate, fix it before
committing. Never commit red.
