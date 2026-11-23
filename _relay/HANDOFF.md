---
project: MSourcing / ARIA
shift: 3
agent: cursor
updated: 2026-11-23 18:22
status: premerge-held
---

# Handoff — PR 287 exact-head premerge

## Current state
- This shift verified live PR https://github.com/mysticalsin/aria-sourcing/pull/287 and left it unmerged.
- Tip `7eb1fa9c9e79766e9ab498ec5a7389f315d71750`, tree `5c11bb25617445b196fd48beb3f5a0c7bbc3f9dd`, body SHA-256 `a8c294eb96843dae7344e59ecece029b55f62f12114f30019327de4c2d0a6116` (UTF-8 GitHub `body`, 5164 bytes).
- Recheck at `2026-11-23T18:22:08Z`: tip and body unchanged, `updated_at` still `2026-11-23T17:53:04Z`, state open, `mergeable_state` blocked.
- Evidence file: `PREMERGE-aria-287-7eb1fa9c.md` on branch `cursor/premerge-aria-287-7eb1fa9c-8818` (base `vercel-demo` `f2d0d3d0`). That branch does not move the PR head.
- Substitute suite: `npm test` twice on a detached worktree of the tip, both exit 0 (18:14:51Z–18:17:58Z and 18:17:58Z–18:20:59Z). Node v22.23.4, `npm ci`, `flyctl` v0.5.15, `FLY_API_TOKEN=local-validate-only`.
- GitHub Quality on the tip succeeded. Dependency audit, secret scan, database security, production image supply chain, and the release gate failed on the tip.

## Done this shift
- Confirmed Jarvis freeze against the live pull request (tip, tree, body).
- Ran the application manifest suite twice on the exact tree. Both runs exit 0 and share result digest `baf9d93da74e85181d19abfd0e815e6a0614aeb132bb5f0506c17c3b2574a149`.
- Wrote `PREMERGE-aria-287-7eb1fa9c.md`. Did not merge PR 287 and did not push to `cursor/sourcing-through-hired-bfd1`.

## Blockers
- PR 287 `mergeable_state` is `blocked`. Release gate is failure because dependency audit, secret scan, database security, and production image supply chain failed on `7eb1fa9c9e79766e9ab498ec5a7389f315d71750`.

## Next steps (in order)
1. Read `PREMERGE-aria-287-7eb1fa9c.md` before any merge decision.
2. If the live tip is not `7eb1fa9c9e79766e9ab498ec5a7389f315d71750` or the body SHA-256 is not `a8c294eb96843dae7344e59ecece029b55f62f12114f30019327de4c2d0a6116`, treat this record as stale and stop.
3. Leave PR 287 unmerged until a human merge decision. Do not push onto `cursor/sourcing-through-hired-bfd1`.

## Decisions made (don't relitigate)
- Merge into goal-2026-07-08-aria-enterprise-ready; deadline 2026-07-31.
- SANA = Sonnet. Flowise = sidecar + proxy (API key server-side only). deer-flow = TS-native port, no LangGraph.js, DB-row resume.
- Autopilot GATED: per-spec opt-in, canary re-armed on every activation, commitments always queued, email+WhatsApp auto-send only inside guardrails, LinkedIn always draft-gated.
- SMS is fully disabled (both at the approval-rule layer and the dispatcher layer) until it gets its own consent/opt-out/suppression policy — do not re-enable by just removing the block, build the policy first.
- Human-likeness: agent narration lives in agent_events (no send path); only 'candidate_reply'/'approved_template' types reach wire; gate is block-only at send.
- Browser tool is read-only research only — no stealth, no private-network access, no page-content mutation, no arbitrary eval. Do not re-add those without a fresh security review.
- Official WhatsApp API only. Out of scope: candidate PII in tests, native mobile, billing.
- Untracked floor3d/linkedin-policy(old copy)/trend-spark files predate shift 2 and remain unimported by that shift's HEAD — left untracked, not that session's concern.
- Confirmed 2026-07-09: this project is worked concurrently by Codex CLI in the same worktree. Division of labor is in `AGENTS.md`.
- 2026-11-23: PR 287 premerge evidence is exact-head only. The frozen tip stays `7eb1fa9c9e79766e9ab498ec5a7389f315d71750` until a new record replaces this one. This shift does not merge it.

## Watch out
- A push to `cursor/sourcing-through-hired-bfd1`, or any edit of the PR body, invalidates `PREMERGE-aria-287-7eb1fa9c.md`.
- `vercel-demo` at `f2d0d3d0` is not the PR head. The suite ran in `/tmp/aria-287-exact` at the frozen commit.
- Release-gate failures on this tip are the four jobs named above. Quality itself succeeded.
