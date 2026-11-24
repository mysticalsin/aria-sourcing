# Decide on agent working-state folders (_relay/, _agent_state/)

Status: wontfix

`_relay/` (handoff baton, 65 archived shifts, old plans and audits) and
`_agent_state/` were kept because AGENTS.md says "never delete archive/". They
are not product documentation. Owner to decide: keep, prune old plans/audits
only, or move them out of the repository. AGENTS.md must be updated in the same
change if the rule changes.

## Resolution (2026-10-26)

Owner has no preference: `_relay/` and `_agent_state/` stay as they are.

## Update (2026-11-03)

Owner asked for a documentation clean-up. Old plans and audits were pruned by
moving them, not deleting them: the July 2026 `_relay/` plans, audits,
research, artifacts and incident records, and the July markdown notes from
`_agent_state/`, are now in `_relay/archive/2026-07/`; closed Codex findings
are in `_relay/archive/codex-findings-closed-2026-11-03.md`. The
"never delete archive/" rule is unchanged.
