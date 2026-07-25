# Lessons — continuity and audit hygiene (2026-07-24)

Why this file is in `docs/lessons/` and not `.rocket-fuel/`: **`.rocket-fuel/` is gitignored**
(`.gitignore:4`), and `tests/repository-hygiene.mts:20,25` asserts both that nothing under it is
tracked and that the ignore rule exists. That test is right — raw agent execution logs should not
sit at the release tip. But it means `PLAN.md`, `ROCKS.md`, `state.json` and the entire
`IMPROVE.md` lesson ledger are **invisible to every clone, to CI, and to any agent working from
the remote**. That is the structural reason each new shift re-derives the same lessons.

**Standing rule: durable knowledge goes in `docs/lessons/` or `_relay/` (both tracked).
`.rocket-fuel/` is a scratch working directory only.** If a lesson matters past the engagement,
it does not live there.

---

## Continuity failures found in the handoff chain

These are not hypotheticals. Each one cost a later shift real time.

1. **A baton's headline status was false and never corrected.** `_relay/HANDOFF.md:6` read
   `commit-blocked-by-sandbox-git-permission`, and the body (`:31-32`, `:70`, `:111`) said local
   commits were impossible. The blocker was resolved roughly 80 minutes later and five commits
   landed — `9732199..b8d00c1` — and nobody went back to the baton. The next shift opened it and
   believed the tree could not be committed.
   *Rule: when a recorded blocker clears, correcting the baton is part of clearing it. A baton is
   a claim about the present tense; leaving a stale one is worse than writing none.*

2. **Both batons asserted "no shipped numbered migration was edited" while `0043` was
   modified in the working tree.** The assertion was about the author's own commits; the reader
   took it as a statement about the tree.
   *Rule: scope every claim to what it covers. "I did not edit a migration" is not "no migration
   is edited." Verify the tree, then state which.*

3. **Three documents define three different mandatory gates and none matches the gate actually
   run.** `docs/TESTING.md:19-25`, `.rocket-fuel/ROCKS.md:9-11` and `production-readiness/STATUS.md`
   disagree. This exact class was already found once before (`PLAN.md:126-130`: `npm test` runs
   only the `application` group, `test:all` resolves to `pretest+application+posttest` and
   excludes `database`).
   *Rule: one definition of the gate, referenced by every other document. A subset gate is not
   the gate, and a green subset is how a SHIP verdict landed on a red gate on 2026-07-18.*

4. **Graphify is mandated as the first action and does not exist.** `graphify-out/graph.json`
   and `graphify-out/wiki/index.md` are both absent; `graphify-out/` is gitignored
   (`.gitignore:5`). Two consecutive shifts opened with the mandated query, got
   `error: graph file not found`, and neither recorded it as a blocker.
   *Rule: a mandated control that fails is a finding, not a footnote. Record it the first time so
   the third shift does not pay for it.*

5. **A test's own receipt line can be a hardcoded string.** `scripts/test-fly-db-volume.sh:512`
   prints `RESULT fly-db-volume: unsafe_root_mount=failed pgdata_only=failed …` as a literal
   `printf`. It is honest — the script runs under `set -Eeuo pipefail` with `exit 1` at every
   assertion, so line 512 is unreachable on failure — but it *reads* like measured output, and
   twelve suites use the same pattern. I misread it as two real failures before checking.
   *Rule: read the line that emits a result before quoting the result. Success-only receipts
   should say so.*

6. **A green gate belonged to no commit.** The gate passed on a tree with 94 dirty and untracked
   entries, including `src/components/app/index.ts` — imported by 28 tracked files and untracked,
   so a fresh clone could not typecheck. Green was unattributable and no deploy was possible,
   because `scripts/lib/prod-release-guard.sh:35-37` requires an empty
   `git status --porcelain --untracked-files=all`.
   *Rule: green is a property of a SHA, not of a working directory. Commit, then re-run, then
   claim.*

7. **Nothing in the executable gate guards the rock ledger.** That is how a green gate coexisted
   with seven rocks marked `NOT STARTED` and a `state.json` saying rock 1 was `BUILDING`.
   *Rule: if a status file is load-bearing, something must assert it. Otherwise treat every
   status line as a rumour and re-derive from code.*

---

## Environment traps in this repo

8. **Registered git worktrees inflate the Bash sandbox profile without bound.** 51 of them added
   189 filesystem deny rules, pushing the spawn arguments to 1.1 MB and past the OS exec limit —
   **every** shell command failed with `E2BIG`, including in subagents. The profile is built at
   session start, so pruning does not take effect until restart.
   *Rule: `git worktree prune` after any worktree-based work. `.claude/worktrees/` is now
   gitignored. If shells start failing with `E2BIG`, count the worktrees first — the error names
   the cause and it is not the command.*

9. **Do not instruct a subagent to disable its sandbox.** Seven of eight audit dimensions were
   killed by the safety classifier for exactly that, after ~1.1M subagent tokens had already been
   spent on the run. Route the shell work through the main thread, or fix the sandbox, or have the
   human relax it. Never write the bypass into a prompt.

10. **OneDrive breaks git object reads and recursive filesystem walks.** A bare `find .` times out;
    `git ls-files` is instant. `npm ci` and `flyctl` builds have both stalled reading the mount —
    which is why `scripts/prod-deploy-app.sh` rsyncs a small local mirror first.
    *Rule: use `git ls-files`, never recursive `find`. Work from a mirror off CloudStorage for
    anything that reads the whole tree.*

11. **Docker is not persistent.** `state.json` claimed colima had been running since 2026-07-21;
    it was dead. The database group silently becomes unrunnable.
    *Rule: probe `colima status` / `docker info` before claiming the database lane, and report a
    Docker outage as BLOCKED with the verbatim error — never as a pass and never as a code
    failure.*

---

## Engineering rules earned this session

12. **Never edit a shipped numbered migration — the blast radius is backups.**
    `scripts/backup.sh:86-90` derives `EXPECTED_MIGRATION_IDENTITIES` from **file sha256** and
    compares it against `public.aria_schema_migrations`. Editing `0043` in place did not just
    break immutability in principle; it disabled backups and the restore drill for as long as the
    edit sat there, silently. The fix is always a new numbered migration —
    `0048_requisitions_member_read_via_rpc_only.sql` here.

13. **An untracked file can defeat a contract test structurally.**
    `tests/infra-release-contract.mts:93-95` enumerates release surfaces from `git ls-files -z`.
    `deploy-fly-2.sh` therefore deployed production Fly with credentials off disk and no release
    guard, completely invisible to the test written to catch exactly that.
    *Rule: when a test enumerates "all X", check what its enumeration cannot see. Tracked-only,
    imports-only and glob-only enumerations all have blind spots.*

14. **A tripwire that must be hand-bumped will fire on the wrong thing.**
    `scripts/prod-swarm-rollout.sh:40` asserted exactly 45 migration files against 47 on disk, so
    the owner's rollout aborted 100% of the time. The release guard above it already binds an exact
    reviewed SHA and a clean tree, which pins the migration set far harder.
    *Rule: prefer a check that derives its expectation over one that stores it. If a stronger
    check already exists upstream in the same script, the weaker literal is not defence in depth,
    it is a fault generator.*

15. **Run evidence containing candidate PII must not enter git history.** The e2e showcase held
    candidate lists, match scores, experience history and a raw scraped profile JSON. Git history
    is immutable, so committing them places personal data permanently beyond the reach of the
    erasure authority in `0033`/`0041` — actively defeating the control the product is built
    around. Now gitignored under `production-readiness/e2e-*/`.

16. **Stale audit claims are as expensive as missing ones.** Roughly a third of the open items
    carried forward from the 2026-07-16/18/19 audits were already fixed. Re-verifying against code
    before reporting is not optional politeness; a ledger of items that are no longer true trains
    the next shift to disbelieve the ledger.
    *Rule: every audit finding carries the code check that proves it still open, dated. Findings
    proven closed move to an explicit "no longer true" list.*

---

## Plan-review evidence hygiene (added 2026-07-25, from a 5-round Same Page Meeting)

Four of eleven review findings across that engagement were not about the plan's substance at all —
they were about how I cited evidence. Each one cost a full round. The pattern is worth more than the
individual fixes.

17. **Evidence must be committed at the SHA the reviewer reads, not merely present in your working
    tree.** I cited a document as proving a claim while, at `HEAD`, that same document still concluded
    the opposite — I had edited it and never committed. Verify with
    `git log -1 --format=%H -- <path>` before citing. A reviewer reads the repo, not your editor.

18. **When you copy a brief forward, diff it against the plan header.** Base SHA, branch and revision
    must agree. A stale SHA in a copied brief made an approval target ambiguous and pointed the
    reviewer at a commit where the cited evidence did not exist. The brief is an artefact the reviewer
    trusts as much as the plan.

19. **A value from a network call is not evidence until it exists locally.** I recorded a remote head
    SHA obtained from `git ls-remote`; `git show` could not resolve it because the object had never
    been fetched, and the local tracking ref was stale by 23 commits. Either materialise it
    (`git fetch`) or cite the method rather than the value. Fetching also produced the real numbers,
    which corrected a repo-wide belief: divergence was `23 62`, not the "~21 local-only" recorded
    elsewhere.

20. **A placeholder inside a locked proof command is an unexecutable proof.** `origin/<branch>` cannot
    run. "Locked at approval" has to mean executable as written, with no substitution step — otherwise
    the rock cannot be proved and nobody notices until build time.

21. **Brief a shape-level reviewer, not only a defect-level one.** Asking a second model "is this the
    right architecture" — rather than "find the bugs" — surfaced more than either the plan author or
    the defect reviewer: that the keystone rock was scheduled last and mislabelled independent, that
    invented job-kind names would have been rejected by `enqueue_aria_job`, and that a missing
    shortlist gate would have reduced the human approval gate to a rubber stamp. Two reviewers with
    different questions beat two reviewers with the same question.
