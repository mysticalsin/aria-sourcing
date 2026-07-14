---
project: MSourcing / ARIA
shift: 2
agent: claude-code
updated: 2026-07-09 22:40
status: in-progress
---

# Handoff — ARIA enterprise-ready (sourcing agents + Flowise Studio)

## Current state (as of 2026-07-10 merge)
- **`main` merged up to `vercel-demo` via PR #1 (merge commit `6c471f0`), pushed to origin.** main is now the latest, fully-tested code — 67/67 test suites, tsc clean, isolated prod build passes. The merge auto-triggered a Vercel production build (git integration confirmed live). OPEN: Tony verifies the new build reaches READY and that Vercel's production branch is set to `main`.

## Prior state
- Branch `vercel-demo`, HEAD `c53127f`, pushed to origin (push confirmed this shift).
- Full gate green: `npx tsc --noEmit` clean, `npm test` 55/55 suites, 0 failures (was 42-45/45 at last handoff; +10 suites landed this shift: approval-persistence, providers, email-unsubscribe, linkedin-policy, flowise-policy, dispatch-outbound expanded, motion-foundation, login-page, aria-live, aria-command-console-state, compliance-suppression).
- **A second, concurrent process was writing to this same worktree live during this shift** (not me — files appeared/changed mid-session: whatsapp-policy.ts, outreach-approval.ts, email-unsubscribe.ts, linkedin-policy.ts, flowise-policy.ts, browser-tools.ts stealth removal, store.ts suppression flow, UX/motion files). I absorbed and committed all of it in 8 reviewed, tested, atomic commits rather than one blob. If you're the next session and see more uncommitted drift, the same process may still be running — re-survey `git status` fresh before trusting any plan, mine included.
- Goal state: `_agent_state/mantu-goal/goal-2026-07-08-aria-enterprise-ready.json` — m1-m3, m5 DONE; m6/m7 code-complete pending env + external services (unchanged this shift, not re-verified).

## Done this shift (8 commits, oldest to newest)
1. `14df41e` — Outreach approval lifecycle + WhatsApp delivery hardening: `outreach-approval.ts` (revocable approval-hash persistence), `whatsapp-policy.ts` (phone consent/DNC as a real invariant), `dispatch-outbound.ts` extended to enforce consent + template-vs-free-form-window + live seat + atomic claim, `autopilot.ts` now separates delivery/read receipts from inbound text. Migrations 0008-0011. New `/api/outreach/revoke`.
2. `5479439` — `rules.ts`: hard-block SMS (no consent policy exists yet for that channel), require candidate phone for WhatsApp.
3. `bca0f92` — CAN-SPAM/GDPR one-click email unsubscribe: `email-unsubscribe.ts`, `/api/unsubscribe/[token]` + `/unsubscribe` page (public, no-store/no-referrer/noindex), `providers.ts` now hard-requires `unsubscribeUrl` before any live send. Migration 0012.
4. `4e6f619` — LinkedIn policy (`linkedin-policy.ts`, rate/cadence guardrails, always draft-gated) + Flowise proxy hardening (API key never reaches the browser; `agents/specs` route no longer echoes `FLOWISE_PUBLIC_URL`).
5. `870e58a` — Browser tool: removed `--features stealth`/`--allow-private-network` and the `type`/`fill`/`press_key`/`select_option`/`evaluate` actions entirely. Read-only research verbs only (click/scroll/wait/back/forward). Honest bot UA.
6. `4146f2f` — Negative-reply auto-suppression: `applyReplyAction` persists DNC across email+phone server-side and revokes in-flight approvals for that candidate before marking them suppressed client-side.
7. `3ccb766` — Wire `compliance-suppression.mts` into the test gate; fix a Rules-of-Hooks violation in `GlassBoxPanel` (useState after an early return).
8. `c53127f` — Premium UX pass: `use-prefers-reduced-motion.ts` + shared motion foundation for `ui/{button,card,progress,tabs}`; `aria-command-console-state.ts` + `aria-live-policy.ts` extract demo state out of component bodies.

Also fixed this shift (pre-dating the commits above): OneDrive File Provider jammed on 11 files → `ETIMEDOUT` on every read, crashed `security-audit.mts`. Fix: `killall OneDrive` + reopen; all content recovered intact, nothing lost.

## Blockers
- none currently open. If `ETIMEDOUT` reads reappear on any file, restart OneDrive first before assuming a code bug.

## Next steps (in order)
1. **Verify Vercel deployment of `c53127f` reaches READY** — a push just completed at handoff time; status not yet confirmed by a human or a re-run of this session. Read the Vercel build log if it fails.
2. Apply migrations 0007-0012 to the production Supabase project (none of tonight's 0008-0012 have been applied anywhere yet — code-complete, not deployed-complete).
3. Set the new required Vercel env vars: `CRON_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `OUTREACH_UNSUBSCRIBE_BASE_URL`, `DATA_ENCRYPTION_KEY`, `FLOWISE_URL`, `FLOWISE_API_KEY` (see `.env.production.example`, updated this shift with generation instructions for each).
4. Deploy Flowise sidecar (Railway/Fly Docker, 2vCPU/4GB, dedicated Postgres schema) — code-side proxy is ready and hardened, nothing is provisioned yet.
5. WhatsApp Business: submit outreach templates for approval early; subscribe the webhook URL in the Meta App dashboard.
6. m8 per-user isolation E2E, m9 admin dashboard real metrics, m12 acceptance run per outcome_criterion — none started this shift.
7. Run `production-readiness/DEPLOYMENT_RUNBOOK.md`'s unsubscribe + approval smoke tests against a real deploy before any live send volume.

## Decisions made (don't relitigate)
- Merge into goal-2026-07-08-aria-enterprise-ready; deadline 2026-07-31.
- SANA = Sonnet. Flowise = sidecar + proxy (API key server-side only). deer-flow = TS-native port, no LangGraph.js, DB-row resume.
- Autopilot GATED: per-spec opt-in, canary re-armed on every activation, commitments always queued, email+WhatsApp auto-send only inside guardrails, LinkedIn always draft-gated.
- SMS is fully disabled (both at the approval-rule layer and the dispatcher layer) until it gets its own consent/opt-out/suppression policy — do not re-enable by just removing the block, build the policy first.
- Human-likeness: agent narration lives in agent_events (no send path); only 'candidate_reply'/'approved_template' types reach wire; gate is block-only at send.
- Browser tool is read-only research only — no stealth, no private-network access, no page-content mutation, no arbitrary eval. Do not re-add those without a fresh security review.
- Official WhatsApp API only. Out of scope: candidate PII in tests, native mobile, billing.
- Untracked floor3d/linkedin-policy(old copy)/trend-spark files predate this shift and remain unimported by HEAD — left untracked, not this session's concern.
- **Confirmed 2026-07-09: this project is worked concurrently by Codex CLI in the same worktree** (identified from live uncommitted file drift during shift 2, confirmed by Tony). Division of labor now formalized in `AGENTS.md`: Claude Code builds/integrates/tests/commits/deploys; Codex audits and may also write code — findings go to `_relay/codex-findings.md`. Full autopilot both sides, no permission-asking for normal iteration.

## Watch out
- OneDrive eviction can break ANY local tooling mid-run; `killall OneDrive` + reopen fixed it once tonight, may recur.
- **A concurrent writer touched this worktree throughout this shift.** Re-run `git status` and `npm test` fresh before trusting any stale plan — including the one in this file — the instant you suspect drift.
- `claim_and_record` RPC: dispatcher passes spec_id as `p_campaign_id` — intentional.
- Gate is deliberately block-only in send route; drafts are humanized at compose time. Don't "fix" by mutating approved text.
- `.claude/scheduled_tasks.lock` changes every session (PID/session-id lock) — deliberately left uncommitted, don't fold it into feature commits.
