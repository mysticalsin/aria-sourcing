# ADR 0002 - An agents runner service, and agent-queued LinkedIn sends (POC)

Date: 2026-11-09
Status: accepted (owner, 2026-11-09)
Amends: ADR 0001 ("Do not add [...] a separate AI server, or worker
orchestration for this slice")
Study: `.scratch/autonomous-agents/spec.md`

## Context

The owner wants autonomous tasks: nightly sourcing of active campaigns, then
the three best eligible candidates contacted on LinkedIn from the campaign
owner's account, then (later) an email to the campaign's managers, and (later)
campaigns drafted from managers' mailboxes.

Today every mission (`src/lib/agents/*`) runs in the browser on top of the
store, and closing the tab stops it. The LinkedIn bridge lets a message leave
only after a human click (`tests/linkedin-bridge.mts`). LinkedIn's User
Agreement forbids automated messaging.

## Decision

1. **New long-running service `agents`** in the Compose stack, built from the
   app image with its own entrypoint. It schedules and runs missions. It holds
   the Anthropic key and an agent token, and **no database credential**. Every
   read and write goes through narrow app routes (`/api/agent/*`), which keep
   the existing authority, quota, suppression, confidentiality, budget and
   idempotency checks.
2. **Agents act on behalf of a user.** A user grants a revocable delegation
   (scopes: source, draft, queue LinkedIn, send email). Every action records
   `actor = agent`, `on_behalf_of`, `mission_id`. The sender of a campaign's
   LinkedIn outreach is the **campaign owner**, from the LinkedIn account they
   paired. Each platform user pairs their own LinkedIn (unchanged:
   one pairing per workspace and user).
3. **Agent-queued LinkedIn sends are allowed, as a proof of concept.** Under a
   standing approval signed by the campaign owner for one campaign (approved
   template, score threshold, max per day), the agent may queue invitations or
   messages into that owner's outbox. The bridge's pacing and caps
   (`LINKEDIN_BRIDGE_*`) still apply and are not raised. The invariant test in
   `tests/linkedin-bridge.mts` becomes: only the LinkedIn components, and the
   agent route holding a valid delegation and standing approval, can queue.
4. **Bridge host VM (POC).** Sends may run from a VM that hosts a real,
   visible Chrome with the ARIA extension, one Chrome profile per user. Each
   user signs in to LinkedIn there themselves (remote desktop). No cookie is
   copied from a laptop. The owner's 2026-11-03 decision still holds: no
   proxies, no fingerprint changes, no randomised "human" delays. Both rules re-confirmed by the owner on
   2026-11-09 for the POC.
5. **Budget.** The owner accepts a higher AI budget for agents. Agents get
   their own daily and monthly caps, separate from the interactive ones.

## Consequences

- The goal of the POC is a yes/no answer: can autonomous sends from a synced
  session on a VM work, and how long does the account last. It is not a
  production go-ahead. The owner accepted the risk to the LinkedIn accounts
  used.
- The agent kill switch: revoking the delegation or the standing approval
  stops new queueing at once, and messages already queued can be cancelled
  from the outbox.
- Lawful basis for contacts decided by an algorithm (GDPR art. 14 notice,
  processing register) is still to be validated with Amaris' DPO before use on
  real candidates beyond the POC.
- The ADR 0001 rule that no agent platform or Kubernetes is needed still
  holds: one more Compose service, same image.
