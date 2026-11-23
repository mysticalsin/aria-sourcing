# PREMERGE aria #287 @ 7eb1fa9c

Recorded: 2026-11-23T18:22:08Z

Exact-head check of code and body for https://github.com/mysticalsin/aria-sourcing/pull/287. PR 287 stays unmerged.

## Freeze

Jarvis freeze confirmed. The live tip, tree, and body still match the required prefixes, so this check continued.

| Check | Required prefix | Live value |
| --- | --- | --- |
| Tip | `7eb1fa9c` | `7eb1fa9c9e79766e9ab498ec5a7389f315d71750` |
| Tree | `5c11bb25` | `5c11bb25617445b196fd48beb3f5a0c7bbc3f9dd` |
| Body SHA-256 | `a8c294eb` | `a8c294eb96843dae7344e59ecece029b55f62f12114f30019327de4c2d0a6116` |

The same tip and body hash were read from the live pull request before the suite (updated_at `2026-11-23T17:53:04Z`) and again at `2026-11-23T18:22:08Z` after both runs. `updated_at` was still `2026-11-23T17:53:04Z`.

- Head ref: `cursor/sourcing-through-hired-bfd1`
- Base: `main` @ `b5480986fe6a749f24d106dbd519bb5e0b2be2ef`
- State: open, merged false, mergeable true, mergeable_state blocked
- Title: LinkedIn sourcing, hire route, audit, and motion on main
- 16 commits, +2083 / −419, 34 files
- Tip parent: `37b58879dbec95d932dd8091310501462c05c2c1`
- Tip signature: valid (GitHub SSH verification). The signed payload records tree `5c11bb25617445b196fd48beb3f5a0c7bbc3f9dd`.
- Local object check: `git rev-parse 7eb1fa9c9e79766e9ab498ec5a7389f315d71750^{tree}` is `5c11bb25617445b196fd48beb3f5a0c7bbc3f9dd`.

Body hash is SHA-256 over the GitHub REST pull request `body` field as UTF-8, 5164 bytes. That field includes the Cursor body markers and the pull request footer. The detached worktree used for the suite stayed clean at this commit.

## Substitute suite

`npm test` ran twice on a detached worktree of `7eb1fa9c9e79766e9ab498ec5a7389f315d71750`. That pair is the substitute run for this record.

Environment:

- Node v22.23.4, npm 10.9.9
- `npm ci` installed 507 packages. The install audit reported 1 high severity advisory.
- `flyctl` v0.5.15 on `PATH`. Archive SHA-256 `88136c52952fe75371d3a156b840b7999c6554a5d501e29b0ca7348cd701065b`. Reported version `flyctl v0.5.15 linux/amd64 Commit: bcead3a580e7b61e00b7046aa512558adbb94e9b BuildDate: 2026-11-23T04:49:51Z`.
- `FLY_API_TOKEN=local-validate-only`

`npm test` runs manifest groups pretest (51), application (156), and posttest (2): 209 commands. `scripts/run-test-manifest.mjs` returns 1 and stops on the first command whose status is non-zero. Exit 0 means all 209 commands in that invocation returned status 0.

| Run | Start (UTC) | End (UTC) | Exit |
| --- | --- | --- | --- |
| 1 | 2026-11-23T18:14:51Z | 2026-11-23T18:17:58Z | 0 |
| 2 | 2026-11-23T18:17:58Z | 2026-11-23T18:20:59Z | 0 |

Both logs produced the same result digest (`baf9d93da74e85181d19abfd0e815e6a0614aeb132bb5f0506c17c3b2574a149`): 158 `RESULT` lines summing to 4250 passed and 0 failed, and node:test reporter totals of 316 pass and 0 fail. Those are separate reporters. Three `RESULT` lines use a non-count format (`openapi-contract`, `apollo-runbook-contract`, `agent-framework-provisioning-cli`) and completed inside the exit-0 runs.

## Checks already on this tip

GitHub checks for `7eb1fa9c9e79766e9ab498ec5a7389f315d71750`:

| Check | Conclusion | Runs |
| --- | --- | --- |
| Quality | success | [45232233655](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233655/job/137894537085), [45232220424](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220424/job/137894489398) |
| Analyze (javascript-typescript) | success | [45232233726](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233726/job/137894537158), [45232220645](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220645/job/137894488993) |
| CodeQL | success | [137895458987](https://github.com/mysticalsin/aria-sourcing/runs/137895458987) |
| Vercel Preview Comments | success | [137895208272](https://github.com/mysticalsin/aria-sourcing/runs/137895208272) |
| Dependency audit | failure | [45232233655](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233655/job/137894537880), [45232220424](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220424/job/137894489631) |
| Secret scan | failure | [45232233655](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233655/job/137894537859), [45232220424](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220424/job/137894489617) |
| Database security | failure | [45232233655](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233655/job/137894537687), [45232220424](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220424/job/137894489846) |
| Production image supply chain | failure | [45232233655](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233655/job/137894537952), [45232220424](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220424/job/137894489510) |
| Release gate | failure | [45232233655](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232233655/job/137901994514), [45232220424](https://github.com/mysticalsin/aria-sourcing/actions/runs/45232220424/job/137901421460) |

The pull request body says dependency audit, secret scan, database security, the production image scan, and the release gate fail the same way on `main`, and that this pull request does not change those policies. This record does not re-run those jobs.

## Merge

PR 287 is open and unmerged. This record does not merge it.
