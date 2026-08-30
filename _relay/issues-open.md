# Open issues / blockers — ARIA Enterprise Autopilot

Living list. Update status in place; archive resolved rows to `_relay/archive/`.
No secrets.

| ID | Severity | Area | Issue | Status | Owner |
|---|---|---|---|---|---|
| CI-BUDGET | info | CI | GitHub Actions budget exhausted — **not a Fly production gate** | open | Tony (optional) |
| CI-DUP | med | CI | Feature-branch push+PR was double-running CI/CodeQL; narrowed push triggers + concurrency cancel (2026-08-25) | fixed (pending budget to verify) | eng |
| UX-OUTLOOK | done (code) | Intake | Outlook pull-open-needs panel + setup guide; needs live Graph mailbox | open (enablement) | admin |
| UX-LLM | done (code) | Settings | Recruitment LLM picker (sourcing/intake/outreach/classification) | fixed | eng |
| UX-OBS | done (code) | Settings | Observability tab (event spark bars + activity + Floor links) | fixed | eng |
| P-1 | blocker | DB | Migrations `0053`–`0056` not yet proven on real Postgres in this cloud sandbox (no Docker socket) | open | eng on Docker host |
| P-2 | med | Fly | Full gate green locally; Fly golive + `test:database` on Docker host still required before loop kill switch | open | eng on Docker host |
| P-3 | high | CI | Bind CI + CodeQL to release SHA with zero high/critical | open | eng |
| P-4 | high | DB | Dump-diff review of `0054` LinkedIn functions after apply | open | eng |
| P-7 | blocker | Tenant | Verified delivery provider + domain not installed | open | Tony |
| P-8 | med | Ops | Restore drill receipt for this SHA | open | eng |
| P-9 | med | Ops | Alerting destination + on-call binding | open | Tony + eng |
| P-10 | med | Privacy | Erasure carve-out for agent JSON/memory documented in STATUS; extension still open | open | eng + legal |
| P-12 | done | Docs | STATUS.md re-reviewed and re-dated 2026-08-25 | fixed | eng |
| P-11 | done | Hygiene | Orphan `Floor3DScene.tsx` deleted | fixed | eng |
| E-2 | blocker | Auth | Entra SSO still off (`NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false`) | open | Tony |
| E-7 | done (code) | MCP | Production allowlist path shipped (`0056` + `/api/admin/mcp/allowlist`); needs live allowlist rows | open (enablement) | admin |
| E-11 | high | Security | Dependabot high alerts on default branch — triage | open | eng |
| A-8 | done (code) | Loop | Event-driven reply: email-inbound webhook enqueues `inbound_classify`; positive intent → draft for entitled autopilot; no idle LLM | fixed | eng |
| A-1 | blocked | Loop | Do not set `ARIA_LOOP_KILL_SWITCH=false` until P-1/P-2 green | open | Tony after eng |
| A-7 | done (code) | Loop | `scripts/ignite-sourcing-loop-scheduler.mjs` shipped; needs cron install | open (ops) | eng |
| L-2 | blocker | LinkedIn | Vendor URL/KEY not contracted; vendor-api stays fail-closed; assisted-manual E2E works via Settings | open | Tony |
| L-5 | done (code) | LinkedIn | `/api/webhooks/linkedin` + route_key (0058); needs vendor + secret to go live | open (enablement) | Tony |

## Decision log (2026-08-25)

- Autopilot who: admin toggles `profiles.autopilot_enabled` via `set_member_autopilot` / Settings → Roles.
- Outreach autonomy: template + audience approval; instances use `approval_source=template_bound`.
- Shortlist: entitled auto-approve when score ≥ `auto_shortlist_min_score` (default 70).
- MCP: production only with allowlist match; no env-only bypass.
- LinkedIn policy boundary unchanged (no scrape/session fleets).
- Candidate replies: webhook-first (`/api/webhooks/email-inbound` → enqueue classify). Idle loop ticks never burn classify tokens.
