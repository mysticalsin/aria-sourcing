---
project: MSourcing / ARIA
shift: 3
agent: cursor-qa
updated: 2026-11-25 16:33 -03
status: in-progress
---

# Handoff — PR 305 sweep harness QA

## Current state
- Branch `cursor/a13-sweep-e2e-stress-2aad`. Draft PR https://github.com/mysticalsin/aria-sourcing/pull/305 stays draft. Not merged. Base is `vercel-demo`.
- Previous tip `04ef74eef235824b4cdefa025b440a0e89020d91`, tree `44dd4ff26e5864c2eb5c4cf96fbf656ae54a6b3e`.
- This shift fixes the copied sweep harness so it matches this compose file. `npx tsc --noEmit` exit 0. `npm test` exit 0, including `tests/sweep-harness.mts` (6 passed).
- Inherited CI on the previous tip: Typecheck / Lint / Test / Build failed at `npm audit --audit-level=high` after the obscura tests (9 passed). Those audit, image, release-gate, flyctl, gitleaks, and database-security checks were not changed.

## Done this shift
- Overlay memory caps name `kong` (96m) instead of an imageless `gateway`, and cap `obscura` at 1024m. Merged caps stay under 6 GiB.
- `scripts/integration-e2e.sh` lowercases the compose project with `tr`, so the Mac entrypoint does not die on bash 3.2 `${STAMP,,}`.
- The sandbox path no longer runs `iptables-legacy -P FORWARD ACCEPT`. The 172.16.0.0/12 bridge rule is unchanged and still gated by `scripts/sandbox-bridge.sh`.
- Journey send and `APP_URL` / `ODOO_URL` checks use the URL host (`e2e/integration/loopback-url.mjs`). Lookalike hosts and query-string loopback text are refused.
- `stress/sql/daily-cap.sql` no longer claims its body is `supabase/migrations/0013_exact_body_hash.sql`. That file is not on this branch. The disposable function is not `0013_outreach_approval_race_safety.sql`.

## Blockers
- `tests/container-runtime.mts` still imports megabranch modules that are not in this checkout (`scripts/container-runtime.mjs`, `supabaseConnectSources`, `isLoopbackHttpOrigin`, `odoo_addons/aria_recruitment/`, `services/ingest/Dockerfile`). It is not on `npm test`.
- `stress/run.sh` still symlinks into `services/channels` and `services/internal/recruit` and runs the token channel. Those trees are not on `vercel-demo`. The runner was not pointed at a live host.

## Next steps
1. Leave PR 305 draft. Do not merge it.
2. Do not merge `integration/aria-all`.
3. When the Go services and token channel exist on this base, run `bash stress/run.sh` with `STRESS_SOAK_SECONDS` set below 1800 for a smoke, and confirm A1–A8 against that code.

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
- A13 coverage stays off `npm test` except `tests/sweep-harness.mts`. `e2e` stays excluded from `tsconfig.json`. Do not merge `integration/aria-all`.

## Watch out
- `CURSOR_AGENT`, `CI=true`, `GITHUB_ACTIONS=true`, or `ARIA_SANDBOX=1` still makes `scripts/sandbox-bridge.sh` print `apply`. The integration script will then insert the 172.16.0.0/12 FORWARD accept rule. It does not change the default policy. Darwin still skips. Do not run `scripts/integration-e2e.sh` on a shared host unless that rule is intended.
- OneDrive eviction can break local tooling mid-run.
- `claim_and_record` RPC: dispatcher passes spec_id as `p_campaign_id` — intentional.
- Gate is deliberately block-only in send route; drafts are humanized at compose time. Don't "fix" by mutating approved text.
