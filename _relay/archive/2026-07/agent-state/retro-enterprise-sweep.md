# Engineering Retro — Enterprise-Ready Full Sweep

Goal: `goal-2026-07-02-enterprise-ready-full-sweep` · 12 milestones · 2026-07-02

## Outcome
11/12 milestones fully verified; m12 (terminal audit) split GREEN(security)/RED(enterprise-on-browser-cluster-interpretation). Engineering is done and independently verified; final COMPLETE is blocked only on two owner decisions (read-only browser tool keep/remove; deploy branch shape) + one recommended cleanup (delete untracked stealth-proof artifact).

## What shipped (per section, each audit→fix→verify→adversarial-review→repair)
- **Dashboard/Intake (m2):** intake warning gate recomputes from live state; funnel high-water-mark (`maxStageRank`/`effectiveStageRank` via `withStage` at all mutation sites) so post-interview rejections stop collapsing to rank-1; real time-to-first-interview.
- **Candidates (m3):** debounced note/rejection saves; suppress/restore made server-symmetric (added missing `DELETE /api/compliance/suppress`); auto-suppressed negative replies preserve prior stage on undo.
- **Campaigns (m4):** pause/resume persisted on the Campaign (was component-state corruption); status filter restored to full status set.
- **Outreach/Replies (m5, core lever):** follow-ups run through live-AI+humanize; every approve/send re-checks live reply/compliance state and auto-cancels stale drafts; fixed a race (createdAt stamped pre-await) and a double-click duplicate-draft bug.
- **Calendar/Reports (m6):** conflict-aware interview scheduling (real free/busy, no double-booking); pinned-start now a hard constraint.
- **Chat/Curator/Sessions (m7):** compliant `search_candidates` sourcing tool wired into chat; mock-ai graceful degradation proven.
- **Fleet/Floor-3D/Memory/Soul/Skills (m8):** Skills RBAC gating (viewer can no longer edit fleet-wide playbooks); real `MAX_3D_AGENTS` device cap replacing a fictional perf claim; per-section error boundaries.
- **Auth/API (m9):** SSRF `assertPublicUrl` added to chat MCP dial; OAuth/keys/email/calendar/outreach route hardening; `rbac-negative.mts` (131 deny-default assertions) added; confirmed `proxy.ts` is the route guard.
- **Cross-cutting (m10):** `/chat` nested-button hydration bug fixed; `stageRank` unified; `followups.mts` regression tests added.
- **Full gate (m11):** Fleet roster filter; clean-cache build (51 routes); full suite 0 failures; Playwright 17 routes 0 console errors.

## Verification posture (what made this trustworthy)
- Every milestone independently re-verified in the main loop with REAL binaries (rtk hook bypassed) — never trusted the workflow's self-report.
- Adversarial reviewer per milestone that had to REFUTE each fix — caught a real regression in ~every section (m5's follow-up race was the sharpest).
- Stealth/origin tripwire every milestone: HEAD/origin stayed pinned at `07d5755`, `browser_act`=0, web-tools=3 tools throughout.
- Final: full `npm test` 0 failures (now incl. rbac-negative 131), security suite 282/282, build 51 routes, all 17 routes 0 console errors.

## What worked
- **One section at a time, sequential (not parallel).** Shared `src/lib` + shell components would have raced; sequential avoided injected regressions.
- **audit→fix→verify→repair pipeline** with an adversarial verifier caught incomplete fixes the fix crew missed.
- **Independent main-loop re-verification** caught two false-positives the workflows reported (m6 build agent misfire; m10 "maxStageRank never set" shallow-grep error) and one false-negative (m8 tripwire-v on a known artifact).

## What to improve
- **Session/usage limits** capped throughput to ~1 workflow per ~2h window; hit them ~4×. Pacing one milestone per window worked but was slow. Smaller fan-outs would trip them less.
- **Tripwire wording** (`no refused file in changed set`) kept false-flagging the pre-existing untracked `final-stealth-proof.mts`, wasting a repair pass (m6, m8). Fixed mid-run by marking it "known/expected."
- **A null-deref bug** in the first workflow's repair phase crashed m2 on a tail-end limit hit; added a null guard for all later milestones.

## Patterns for mantu-agent-dreaming
1. When briefing a final auditor, scope the refusal PRECISELY (stealth flags + form-fill vocabulary), not "the whole cluster" — an over-broad brief produced a RED against the acceptable read-only version.
2. An independent security pass surfacing a refused capability as a real vuln is corroboration to hold the refusal, not a feature request.
3. Concurrent-writer defense: forbid subagents any git write, never push from the sweep, and re-verify HEAD/origin each milestone.
4. Always re-verify workflow self-reports in the main loop with real binaries — false-positives AND false-negatives both occurred.

## Open items (owner decisions)
- **DECISION-1:** Keep the committed read-only browser tool (`browser-tools.ts`, wired into chat — click/scroll/wait/back/forward only, no form-fill, SSRF+robots guarded, no stealth) as the acceptable version, OR remove the whole Obscura browser cluster from the demo. Per standing note, the read-only version is acceptable; the enterprise auditor's RED was against the whole cluster.
- **DECISION-2:** Deploy shape — ship the enterprise work onto clean `d67cc48` (cherry-pick) or a fresh demo branch, WITHOUT rewriting the two earlier author-committed stealth commits.
- **CLEANUP (recommended):** delete untracked `tests/final-stealth-proof.mts` (stealth-proof leftover).
- **UNRESOLVED:** identity of the concurrent committer/pusher that produced `07d5755` during m4 (has excluded stealth every time; quiet since).
