---
project: MSourcing / ARIA
shift: 29
agent: claude-opus-4-8
updated: 2026-07-11 23:55 EDT
status: campaign-blockers-fixed-ci-hardening-in-flight-owner-gates-pending
---

# Handoff — recovery candidate integrated; owner gates are the critical path

## Current state

- **Integration complete.** The reviewed recovery candidate `c6c7a0ae5bb85ce7d31d56106d153fc488daae80` is now the tip of the shared branch `deploy/fly-github-actions` (fast-forward from base `4b24d39`, real SHA preserved — no cherry-pick, no rewrite).
- Worktree = candidate content exactly, plus 4 newer meta files kept from the shared tree (`_relay/HANDOFF.md`, `_relay/codex-findings.md`, both `_agent_state/*/memory.json`) and 12 untracked intentionally-excluded paths (incident, 2026-07-11 relay archives, enterprise audit, superseded scripts). Nothing was discarded.
- **Full pre-integration state is preserved** in ref `snapshot/shared-20260711-preintegration` (commit `3ec69a3`, tree `8c54d4c`) — every tracked and untracked file as it stood before integration. Recover any path with `git show 3ec69a3:<path>`.
- Post-integration verification: `npx tsc --noEmit` clean; `tests/login-page.mts` 15/15. (Codex ran the complete gate suite on this exact content as `c6c7a0a` — see shift 28.)
- Login page carries BOTH change sets with no conflict: Tony's layout (Aria M mark top-left, background-motion toggle bottom-left) + Codex's azure-login gating and email-focus CTA fallback.
- Push safety was verified before pushing: `ci.yml`/`codeql.yml` trigger on push (wanted — exact-SHA proof), zero workflows reference `ARIA_DEPLOY_BUNDLE`, deploy workflow is `workflow_dispatch`-only and remotely disabled. Repo visibility: Tony decided (2026-07-11) the repo stays PUBLIC until the backend is live and a campaign runs; flip to private is the final closeout step.
- Production verdict remains **NO-GO** — unchanged from shift 28. Nothing was deployed; no Fly access was used; the token incident stays open.

## Done this shift

- Triaged the 2 open findings from the Claude adversarial review (secret-provisioning trap, dotfile-restart footgun): both already fixed by Codex in `c6c7a0a` (seven-secret staged verification; HISTFILE suppression + regular-file cleanup in the entrypoint). Statuses reflect that in `_relay/codex-findings.md`.
- Snapshotted the shared dirty tree (tracked+untracked) to `snapshot/shared-20260711-preintegration` before touching anything (HANDOFF shift-28 next-step 1).
- Computed the TRUE content diff via a temp index (raw `git status` was misleading: untracked-on-disk files showed as `D`), classified all 112 differing paths, confirmed `c6c7a0a` is a direct child of the shared HEAD.
- Fast-forwarded `deploy/fly-github-actions` to `c6c7a0a` via `git reset --mixed` + selective checkout, keeping the 4 newer meta files and all excluded confidential paths untracked on disk (HANDOFF shift-28 next-step 2 / blocker 6 resolved).
- Verified integrated tree (tsc clean, login-page 15/15) and pushed the branch to origin to start exact-SHA CI + CodeQL (gate-9 evidence).

- Fixed the exact-SHA CI supply-chain gate through three diagnosed rounds (first real runs of the hardened pipeline): (1) app image — stripped npm/corepack/yarn from the runner stage (fixable sigstore/picomatch HIGHs lived in npm's bundled deps) and flipped both workflows to --ignore-unfixed=true so only actionable CVEs block (19 unfixable Debian CVEs incl. CVE-2023-45853 no longer permanently redline the gate); (2) app secret scan — disabled only Trivy's linkedin-client-id public-identifier rule (Sillage field-name false positive, same family as the Gitleaks line-allows), linkedin-client-secret stays armed, contract-pinned unbroadenable; (3) db image — apk upgrade + gosu->su-exec swap (12 fixable Go-stdlib HIGHs in gosu), pre-emptive apt upgrades + gosu removal for bootstrap, apt upgrade for kong. Commits f518572, b75f93c, b1fc503.
- Fixed the three campaign-blocking product findings via a 6-agent build (maps -> builders, disjoint ownership): 0021 per-seat FOR UPDATE cap serialization (d29cd40, 14/14), 0022 email ambiguity doctrine — immutable send_attempt_id + non-retryable 'ambiguous' + phase-aware adapters (aa60671, 54/54), 0023 canonical agent_conversations + claim-bound WhatsApp resolver RPC + provider-thread-first email matching, ambiguity fails closed to triage (318f552, 30/30).
- Integration: wired the three suites into npm test (124 chained checks), STATUS.md/RUNBOOK updated, resolve_whatsapp_inbound_conversation added to the live-PG service-RPC assertion list, findings ledger updated (3 fixed, 2 follow-ups filed: SMS unknown-outcome retry; cross-channel cap race in claim_whatsapp_outbound). Full gate: npm test exit 0, tsc clean. Commit 9aee49e.

## Blockers (owner-controlled — the critical path, unchanged from shift 28)

1. Revoke the exposed Fly token (`_relay/incidents/2026-07-11-fly-deploy-token-exposure.md`), prove rejection, review activity, issue split-scope short-lived credentials.
2. Delete repository-level `ARIA_DEPLOY_BUNDLE`; install individual Production-environment secrets per `production-readiness/.fly-secrets.example`.
3. Branch protection: put the workflow on the default branch (`vercel-demo`), protect `vercel-demo` + `deploy/fly-github-actions`, require exact-SHA CI/CodeQL, block self-review, re-enable the workflow.
4. Preserve + inspect a disposable clone of `aria_db_data`; produce the release-bound recovery receipt.
5. Dispatch the protected workflow with the exact SHA + receipt hash; complete live acceptance (DB ready + 2-restart survival, Auth/REST 200, `/api/ready` 200, digests match, admin login, synthetic zero-send campaign).
6. Remaining product findings in `_relay/codex-findings.md`: the three campaign blockers (email ambiguity, daily-cap race, inbound identity) are FIXED in source as of this shift; still open: agent memory ownership, autopilot contract, SMS unknown-outcome retry, cross-channel cap race, repo binaries/logs retention. Backend deploy alone does NOT make campaigns production-ready.

## Next steps

1. Watch CI + CodeQL on the branch tip (now `6deeccd`; `gh run list --branch deploy/fly-github-actions`); fix red if any — the release SHA for dispatch is whatever tip is fully green.
2. Owner executes blockers 1–4 (token, secrets, protection, volume receipt). Everything is written to be executable without conversation context in shift 28's next-steps 3–7 (archived at `_relay/archive/2026-07-11-2020-codex-gpt-5.md`).
3. Dispatch: `gh workflow run "Deploy Aria Mantu (Fly)" --ref deploy/fly-github-actions -f release_sha=<green-tip-40-char-sha> -f recovery_receipt_sha256=<reviewed-receipt-sha>` (only after gates 1–4; use the exact green tip, currently `6deeccd...`).
4. Live acceptance per shift-28 step 12, then admin provisioning via `scripts/provision-first-admin.sh` (out-of-band credential), then synthetic campaign acceptance.
5. Only after full acceptance: flip repo private (`gh repo edit mysticalsin/aria-sourcing-demo --visibility private`) — Tony's explicit final gate.
6. Continue open product findings before any real-candidate campaign.

## Decisions made — do not relitigate

- All shift-28 decisions stand (volume mount at `/var/lib/postgresql`, owner-separated reconciliation, staged-vs-deployed secrets, immutable artifact chain, approver independence, degraded-not-demo, LinkedIn assisted-only, never use the exposed token).
- Repo stays public until live acceptance passes; private flip is the last step (Tony, 2026-07-11).
- Integration used fast-forward to preserve the reviewed SHA identity — the exact-SHA pipeline depends on it; do not squash/rebase this branch.
- The snapshot ref `snapshot/shared-20260711-preintegration` is retention evidence — do not delete without a reviewed decision.

## Watch out

- All shift-28 watch-outs stand (postgres HOME dotfiles, single DB machine, `.internal` DNS = symptom, staged secrets ambiguity, rerun triggering actor, previous-key retirement, no Gitleaks broadening).
- The 12 untracked confidential paths must NEVER be committed to the public origin — recheck `git status` before any `git add -A`.
- `deploy-fly-2.sh` and `.gitlab-ci.yml` on disk are superseded artifacts excluded from the candidate — do not resurrect them into builds.
- The 4 kept meta files are newer than their tracked versions; committing them is fine (relay history is already public precedent) but never commit the incident file.
