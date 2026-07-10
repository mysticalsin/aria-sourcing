# ARIA Enterprise Production Design

**Status:** Accepted for autonomous execution under Tony's standing full-autopilot instruction.

**Source of truth:** `_agent_state/mantu-goal/goal-2026-07-08-aria-enterprise-ready.json`, `_relay/HANDOFF.md`, current code at `14f76f1`, and the 2026-07-09 Codex audit.

## Problem

ARIA has a broad, polished product surface and substantial safety code, but the current evidence does not support an enterprise-production claim. Local compile, test, lint, build, and high-severity dependency gates pass. The remaining gap is the chain from a signed-in user's authority, through normalized tenant data and guarded side effects, to a deployed and monitored release with recoverable data.

The design must prevent four false-success states:

1. A public demo identity gaining a real production side effect.
2. A browser-only state change claiming to be enforced by the server.
3. A workspace-wide object being presented as per-user isolation.
4. Local green checks being presented as deployed production proof.

## Chosen approach

Use a release-gate-first hardening sequence.

- ARIA stays the control plane for identity, tenant membership, roles, agent definitions, approvals, audit events, and every provider call.
- Supabase tables and database functions are the authority for data that changes security or delivery outcomes.
- Browser workspace state remains a presentation and demo surface. It cannot grant roles, create live sender identities, update enforcement lists, or mark provider delivery.
- Public demo mode remains synthetic and dry-run. It may spend only explicitly budgeted demo AI features behind its signed demo session.
- Flowise stays a private authoring sidecar. It cannot own ARIA identity, tenant data, approvals, provider credentials, or the final send decision.
- A release is approved only from an exact commit with green CI, applied migrations, environment attestation, browser and database isolation proof, live provider smoke evidence, monitoring, rollback, and restore evidence.

## Alternatives considered

### Feature-first

Finish Flowise, admin dashboards, and UI polish before authority and operations work. This gives more visible features quickly, but it increases the number of surfaces built on unproven tenancy and side-effect boundaries. Rejected.

### UI-first redesign

Rework the information architecture and visual system before backend closure. The current UI is already broad and polished enough for targeted repair. A redesign would delay higher-severity work. Rejected.

### Release-gate-first

Close authority, DNC, dispatcher, migration, CI, and recovery gaps first. Then connect Agent Studio, real metrics, Flowise, and final UX. Selected because every later feature inherits a safer execution path.

## System boundaries

### Identity and authority

- Supabase Auth establishes identity.
- `profiles.role` establishes server and UI authority.
- `workspace_state.currentRole` is removed as an authority source in live mode.
- Agent ownership is explicit. Admins may inspect workspace activity; regular users may read and change only their own agent definitions and runs unless a separate sharing grant exists.

### Agent execution

- A live run starts from a stored `agent_specs` row.
- The server loads the role brief, channels, provider binding, owner, and guardrails from that row.
- Client-supplied campaign data may add bounded run inputs, but it cannot replace stored ownership or policy.
- Every state transition is persisted or the request reports failure. Silent stateless fallback is demo-only.

### Outbound communication

- All live delivery originates from a server-owned durable outbox.
- Public demo mode cannot produce live email, WhatsApp, SMS, LinkedIn, calendar, or mailbox mutations.
- Manual suppressions are acknowledged only after the enforcement table confirms the write.
- WhatsApp remains official-API-only, with consent, DNC, template or reply-window, sender, approval, content, frequency, idempotency, and reconciliation checks.
- SMS stays unavailable until an equivalent consent and opt-out policy exists.
- LinkedIn stays assisted and draft-only unless a separately approved official integration is added.

### Operations and evidence

- `/api/health` remains liveness. A separate authenticated readiness check covers database, schema version, queue, and provider configuration without exposing secrets.
- CI, CodeQL, secret scanning, dependency gates, build, browser smoke, and migration checks bind evidence to the exact release SHA.
- Backup proof requires a restore with zero swallowed errors and validation of named required tables, policies, and row counts.
- Observability covers request failures, provider failures, queue age, blocked sends, webhook signature failures, migration version, auth anomalies, and cost-bearing endpoints.

## Primary user journeys

### Sourcing operator

When a sourcing operator receives a role brief, they want to create and run one guarded sourcing agent so they can review candidates and approved drafts without code intervention.

### Workspace admin

When an admin operates several sourcing users, they want real activity, efficiency, policy, and failure metrics so they can manage output and risk from evidence.

### Candidate

When a candidate is contacted or applies, they want accurate information, a working opt-out, predictable privacy handling, and no repeated or machine-status messages.

## Failure behavior

- Missing auth, service role, encryption key, required migration, or workspace returns an explicit non-2xx response.
- Live backend load failure shows a blocking degraded state. It never seeds synthetic data into a live session.
- Provider ambiguity is not marked skipped or retried automatically. It enters reconciliation.
- Database persistence failure makes the agent run fail or pause with a recoverable identifier.
- Monitoring and CI unavailable means release blocked, even when local checks pass.

## Verification model

The final acceptance run uses two isolated users, one admin and one regular user, two agent specs, concurrent runs, a real email round trip, a real WhatsApp round trip to Tony-controlled endpoints, an out-of-policy approval queue, real admin metrics, and negative tenant access attempts. Evidence is stored by exact commit and environment.

